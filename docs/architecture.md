# Architecture

How the plugin attaches to the Harness, and why each part of the contract looks
the way it does.

## The extension point

The Harness dispatches every tool call through a pipeline that ends in
`finalizeScheduledExecution`. Just before a result is finalized, it emits a
waterfall:

```ts
'tools/post-execute': (
  exec: ToolExecution,
  result: Readonly<ToolExecutionResult>,
  next: () => Promise<PostToolDecision>,
) => Promise<PostToolDecision>
```

A waterfall means each listener either returns `next()` to pass control on, or
returns its own decision to settle the chain. This plugin listens here because it
is the last point at which the text is still data rather than rendered output.

### Why not a renderer or a client hook

A renderer-side fix would be per-surface: the terminal card and the conversation
transcript would each need their own. It would also leave the model reading the
unnormalized text, so the agent would keep reasoning about `鏋勫缓鎴愬姛`. Fixing it
at `post-execute` corrects both surfaces at once and corrects what the model sees.

## The decision contract

`PostToolDecision` has three shapes:

```ts
{ kind: 'accept', content?: ContentBlock[] }   // replace the text
{ kind: 'accept', value: JsonValue }           // replace the structured result
{ kind: 'block', feedback: string }            // refuse the result
```

This plugin returns only the first, with `content` and nothing else:

```js
return { kind: 'accept', content };
```

Three consequences, each of which a naive implementation gets wrong.

### `value` must be absent

The runtime merges an `accept` decision by spreading the original result and
replacing the fields the decision carries:

```js
{ ...result, ...decision }   // conceptually
```

Before that it guards against a decision carrying both fields, because replacing
`content` and `value` together is ambiguous — it cannot tell whether the decision
means "new text, same structure" or "new structure entirely". The guard uses
`Object.hasOwn`, so even a spread copy of the result is rejected:

```js
return { kind: 'accept', ...result, content };   // throws TypeError
```

Leaving `value` out keeps the structured result intact. That matters beyond
tidiness: `presentResult` for `pwsh` splits the rendered text with
`parseExitStatus` to build the terminal card, and structured consumers read
`exitCode`, `stdout`, and `sandbox` from `value`. All of them keep working.

### No change means `next()`

```js
const content = normalizeContent(result?.content, options);
if (content === undefined) return next();
```

`normalizeContent` returns `undefined` — not the original array — when nothing
changed. Returning an identical copy would still be correct, but it would force a
rebuild of the result for every piece of clean output, which is the common case.
`test/plugin.test.mjs` asserts `nextCalls === 1` for every no-op path.

### `{ content: undefined }` is a silent no-op

The runtime treats an explicit `undefined` as "no replacement", so a bug that
returns `{ kind: 'accept', content: undefined }` fails quietly rather than loudly.
The `=== undefined` check above exists to make that path explicit and testable.

## Block handling

```js
function normalizeContent(content, options) {
  if (!Array.isArray(content) || content.length === 0) return undefined;
  let changed = false;
  const blocks = content.map((block) => {
    if (block === null || typeof block !== 'object') return block;
    if (block.type !== 'text' || typeof block.text !== 'string') return block;
    if (block.text.length > options.maxTextLength) return block;
    const text = normalizeTerminalText(block.text, options);
    if (text === block.text) return block;
    changed = true;
    return { ...block, text };
  });
  return changed ? blocks : undefined;
}
```

Every guard is deliberate:

- **Non-array or empty** — nothing to do, fall through.
- **`block === null || typeof block !== 'object'`** — defensive against a
  malformed result; never throw inside a waterfall.
- **`block.type !== 'text'`** — images, attachments, and future block types pass
  through by reference, so this plugin can never corrupt structured content.
- **`typeof block.text !== 'string'`** — a text block without text is malformed;
  leave it to whatever validates results.
- **`text.length > maxTextLength`** — bounds the work per result. A multi-megabyte
  build log should not be transcoded inline.
- **`{ ...block, text }`** — preserves any additional fields a block may carry
  (metadata, cache markers) while replacing only the text.

## Module layout

```text
index.js               thin façade; re-exports apply, Config, name, transforms
src/config.js          DEFAULT_CONFIG, Config schema, resolveSettings
src/plugin.js          apply(), normalizeContent()
src/normalize.js       pure transforms; zero imports
```

The façade exists because the Loader reads `Config`, `apply`, and `name` from the
module `exports["."]` resolves to. Keeping `index.js` to re-exports means the
public surface is declared in one place while the implementation stays testable in
pieces.

### Why `src/normalize.js` has no imports

Two reasons, both practical:

1. **Testability.** The suites import it directly with no Harness runtime, no
   mocks, and no dependency installation.
2. **Safety on the hot path.** No I/O, no dynamic import, no third-party code in
   the function that touches every tool result. See [SECURITY.md](../SECURITY.md).

## Configuration

`resolveSettings` merges the row config over `DEFAULT_CONFIG` with asymmetric
boolean handling:

```js
stripAnsi: merged.stripAnsi !== false,      // opt-out: default on
foldFullwidth: merged.foldFullwidth === true, // opt-in: default off
```

A stray non-boolean in a hand-written patch file therefore cannot silently flip
behavior in the surprising direction. `foldFullwidth: 'yes'` leaves the transform
off rather than on; `stripAnsi: 0` leaves it on rather than off. Both cases are
tested.

### Why the schema is optional

`@deepseek-ai/schemastery` is a real dependency, so a normal install resolves it
and the settings form renders. It is still loaded through a `try`/`catch`:

```js
async function loadSchemaLibrary() {
  try {
    const mod = await import('@deepseek-ai/schemastery');
    return mod.default ?? mod;
  } catch {
    return undefined;
  }
}
```

A bundle is commonly installed as a *link* into a profile, which means the runtime
resolves the plugin's imports from the repository. A user who skipped the
dependency step would otherwise lose the entire plugin to a load-time
`ERR_MODULE_NOT_FOUND`. Without the library `Config` is `undefined`, the settings
form is simply absent, and every transform still runs on the declared defaults —
which are the same values the schema declares, so behavior does not change.

## Bundle mechanics

A DSH bundle is a package whose `package.json` points `dsh.bundle.patch` at a YAML
file:

```json
{ "dsh": { "bundle": { "patch": "./cordis.patch.yml" } } }
```

The patch uses `insert` to add one entry to the composition:

```yaml
- insert:
    - id: dsh-transcode-tty
      name: dsh-transcode-tty
      config:
        enabled: true
        # ...
```

- `id` is what a user targets when overriding the entry in their own profile
  patch layer, so it is stable and independent of the package name.
- `name` must be the exact package name so the Loader can resolve the module.
- `config` is written out in full, so a fresh install starts from a complete,
  inspectable configuration rather than relying on schema defaults.

### Installing

Installing a bundle means three things, which the scripts in `scripts/` do in
this order:

1. The package is a dependency of the profile (`link:` for a checkout).
2. The package name is listed in `dsh.profile.bundles`.
3. The profile is reconciled with pnpm so `node_modules` contains the link.

The in-app plugin manager does the same three steps; `scripts/install.mjs` exists
so they can be scripted and inspected.

## Cost

Per result, the plugin does:

- One array walk over the content blocks.
- One pass per enabled transform over each text block.
- One lazy, cached build of the GBK reverse map (on the first non-ASCII block).

A 416,000-character block normalizes in about 6 ms on the reference machine, which
is dominated by the mojibake scorer's per-character loop. The `maxTextLength`
guard skips anything larger. Pure-ASCII output takes the fast path in every
transform, so a clean `npm run build` log costs almost nothing.

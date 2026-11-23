# dsh-transcode-tty

[![test](https://github.com/Hagkiest/dsh-transcode-tty/actions/workflows/test.yml/badge.svg)](https://github.com/Hagkiest/dsh-transcode-tty/actions/workflows/test.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4B6BFB.svg)](https://github.com/deepseek-ai/deepseek-harness)

**English** · [简体中文](README.zh-CN.md)

A DeepSeek Harness plugin that transcodes shell tool output into text the terminal view can actually display.

---

## The problem

The Harness renders command output as plain text, in the tool card and in the conversation transcript. That text frequently carries artifacts the renderer does not interpret, so instead of the command's real output you see mojibake:

| What the command emitted | What you see |
| --- | --- |
| `ESC[1;31m` before `ERROR` | literal `[1;31mERROR` |
| A spinner redrawing one line 40 times | 40 frames stacked into one unreadable line |
| `构建成功` written by a CP936 console | `鏋勫缓鎴愬姛` |
| The same text read as ISO-8859-1 | `æå»ºæå` |
| A byte the wrong charset already dropped | `���` runs |
| A zero-width space or bidi mark | text that looks right but copies wrong |
| An ideographic space | columns that do not line up |

None of these are the command's fault, and none of them are the model's fault. They are transcoding failures at the boundary between a byte stream and a text view, and they can be fixed automatically at exactly that boundary.

## What it does

`dsh-transcode-tty` hooks the Host `tools/post-execute` waterfall. For every tool on its allow-list — `pwsh`, `bash`, and `job_output` by default — it rewrites each text content block before the result is rendered:

```js
ctx.on('tools/post-execute', async (exec, result, next) => {
  if (!enabled || !tools.has(exec.name)) return next();
  const content = normalizeContent(result?.content, options);
  if (content === undefined) return next();
  return { kind: 'accept', content };
});
```

Three properties of that snippet are deliberate and load-bearing:

- **Only `content` is replaced.** The runtime merges an `accept` decision by spreading the original result, so the structured `value` — exit code, stdout/stderr, sandbox metadata — stays intact for every downstream consumer. A decision that carried both `content` and `value` would throw.
- **No change means `next()`.** A result that needs no rewrite falls through instead of being replaced with an identical copy, so untouched output costs nothing.
- **Nothing else is touched.** Image blocks, attachments, and unknown block types pass through by reference.

## Transforms

Order matters, and it is not arbitrary.

```text
raw output
   │
   ├─ stripAnsi                   ESC[1;31m  →  (removed)
   ├─ collapseCarriageReturns     10%\r50%\r100%  →  100%
   ├─ repairMojibake              鏋勫缓鎴愬姛  →  构建成功
   ├─ stripControlChars           a\u200Bb  →  ab
   ├─ normalizeSpaces             a\u00A0b  →  a b
   ├─ foldFullwidth       (opt-in) Ａ１  →  A1
   ├─ collapseReplacementRuns (opt-in)  ���  →  �
   └─ trimTrailingWhitespace  (opt-in)
```

ANSI goes first so escape parameters cannot look like text. **Mojibake repair runs before control-character stripping**, because UTF-8-read-as-Latin-1 corruption uses C1 control bytes (`U+0080`–`U+009F`) as its payload — stripping first would destroy the evidence and leave an unrepairable fragment.

### How the repair avoids corrupting correct text

The dangerous failure mode is not "fails to repair" but "repairs something that was never broken". Two rules prevent it.

**1. A candidate must be an exact inverse.** Re-encoding the candidate with the charset that supposedly produced the mojibake has to reproduce the input byte for byte. Anything else is discarded, so text that merely looks unusual is left alone.

**2. The GBK direction needs a stronger discriminator.** GBK is not UTF-8, so a lossy decode produces no `U+FFFD` to detect. The signal is a statistical one:

- A UTF-8-read-as-GBK mis-decode lands mostly in the GBK **second level** (`0xD8A1`–`0xF7FE`, rare Hanzi used in personal names) or outside both levels entirely.
- Genuine Chinese prose is dominated by GBK **level 1** (`0xB0A1`–`0xD7FE`, the 3755 common characters).

The scorer compares those distributions, so `张燚 李鑫 王淼` and `編譯成功` and `ビルドが成功しました` all survive untouched while `鏋勫缓鎴愬姛` is repaired.

### When recovery is impossible

If the wrong charset already dropped a byte, the original byte is gone. The plugin restores the readable part and leaves **one `U+FFFD` per lost character**:

```text
文件未找到  →  (GBK mis-decode, odd byte count)
鏂囦欢鏈壘鍒  →  文件未找�
```

That is honest and renders cleanly. The alternative — guessing at plausible Hanzi — produces confident-looking wrong text, which is worse than a visible marker. The repair is also idempotent: running it again changes nothing.

> **Implementation note.** CP936 is a variable-length encoding. The lone byte `0x80` decodes to `€`, and the pair `A2 E3` decodes to the same character. A reverse map built only from pairs inverts the lone byte into two, which desynchronizes the byte stream and fails the round-trip check. `src/normalize.js` enumerates single-byte forms first so they win that ambiguity.

## Install

Requires **Node.js 20 or newer** and a DeepSeek Harness profile.

### Windows (PowerShell)

```powershell
git clone https://github.com/Hagkiest/dsh-transcode-tty.git
cd dsh-transcode-tty
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

### macOS / Linux

```sh
git clone https://github.com/Hagkiest/dsh-transcode-tty.git
cd dsh-transcode-tty
chmod +x install.sh && ./install.sh
```

### Cross-platform

```sh
npm install
npm run install:plugin
```

All three do the same five things:

1. Resolve the profile directory (`--profile-dir`, then `DSH_PROFILE_DIR`, then `~/.dsh/profiles/<profile>`).
2. Install the plugin's own dependencies, which is what makes the settings form render.
3. Register the package as a `link:` dependency of the profile and add it to `dsh.profile.bundles`.
4. Reconcile the profile with pnpm.
5. Verify that the linked package contains `index.js` and `cordis.patch.yml`.

Then **restart DeepSeek Harness** so the Loader picks up the new composition. Shell output is normalized from that point on; nothing else is required.

> Prefer the GUI? The Harness plugin manager can install a bundle by directory. Point it at the repository root.

### Uninstall

```powershell
node scripts/uninstall.mjs          # or: .\uninstall.ps1
```

This removes the entry, reconciles the profile, and restores the `package.json` backup the installer took — but only when nothing else changed in the meantime, so an unrelated edit is never discarded.

### Verify

```powershell
npm run verify
```

One command to run when the plugin "does not seem to do anything". It checks the manifest, the dependency, the entry point, each transform, the test suite, and whether the live profile actually contains the entry.

### See it work

```powershell
npm run demo
```

Reproduces every corruption the plugin fixes — GBK and Latin-1 mis-decodes, ANSI escapes, progress redraws, invisible characters — and prints three lines per case: the corrupted input, the plugin's expected result, and the live result. Run it from inside the Harness and the live line is rewritten by the installed plugin before it renders, so it should read as clean text while the input line shows the damage.

## Configuration

Every transform has a switch. Defaults favor **not changing correct output**: the three risky transforms stay off.

| Option | Default | Why |
| --- | --- | --- |
| `enabled` | `true` | Master switch; leaves your other settings intact. |
| `tools` | `["pwsh","bash","job_output"]` | Tools rendered as terminal text. |
| `stripAnsi` | `true` | An uninterpreted escape sequence is never useful. |
| `collapseCarriageReturns` | `true` | A terminal would show only the final segment. |
| `repairMojibake` | `true` | Master switch for the three directions below. |
| `repairUtf8AsGbk` | `true` | The usual CP936 console case. |
| `repairUtf8AsLatin1` | `true` | UTF-8 read as ISO-8859-1. |
| `repairGbkAsLatin1` | `true` | GBK read as ISO-8859-1. |
| `stripControlChars` | `true` | Invisible characters break alignment and copy-paste. |
| `normalizeSpaces` | `true` | Space variants misalign columns. |
| `foldFullwidth` | `false` | Can change intended CJK layout. |
| `collapseReplacementRuns` | `false` | Hides how much data was lost. |
| `trimTrailingWhitespace` | `false` | Hides detail; diff output may need it. |
| `maxTextLength` | `262144` | Skips larger blocks to bound per-result cost. |

Configure it in **Settings → Plugins → Terminal Text Transcoder**, or override the row in your profile's `cordis.patch.yml`:

```yaml
- id: dsh-transcode-tty
  config:
    foldFullwidth: true
    tools:
      - pwsh
```

## Architecture

```text
index.js               thin façade: re-exports the public surface
src/config.js          declared defaults, schema, config resolution
src/plugin.js          the tools/post-execute listener
src/normalize.js       pure string → string transforms, zero imports
cordis.patch.yml       the bundle patch the Loader applies
locale/{en,zh}.json    plugin metadata for the settings UI
scripts/               install, uninstall, verify, shared helpers
test/                  three suites, no framework dependency
```

`src/normalize.js` has **no imports at all** — no Node built-ins, no dependencies. Every function is a pure `string → string`, which is what makes the whole surface testable without a Harness runtime, and what makes the hot path safe.

## Development

```sh
npm install
npm test          # 117 assertions across 3 suites
npm run verify    # end-to-end install health check
```

```text
test/normalize.test.mjs    each transform in isolation       41 checks
test/realworld.test.mjs    realistic console artifacts       52 checks
test/plugin.test.mjs       wiring against a fake context     24 checks
```

There is no test framework on purpose: the transforms are pure functions, so `node:assert` plus a small harness covers the surface while keeping `npm test` runnable from a bare checkout.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the invariants a change must preserve, and [docs/architecture.md](docs/architecture.md) for the runtime contract in detail.

## Documentation

- [Architecture](docs/architecture.md) — the Cordis extension point and the decision contract
- [Transforms](docs/transforms.md) — each transform, with before/after examples
- [Mojibake](docs/mojibake.md) — how the three corruption directions are detected and reversed
- [Configuration](docs/configuration.md) — every option, its default, and why
- [Troubleshooting](docs/troubleshooting.md) — when output is still wrong

## Scope

This plugin fixes **display** of already-produced text. It does not:

- Re-run commands under a different code page (set `chcp 65001` or the equivalent instead).
- Change how the model sees tool output beyond the text block.
- Touch output from tools outside the allow-list.

If a command's *output* is wrong at the source — a legacy tool writing GBK to a UTF-8 pipe — the right fix is at the source. This plugin is for the cases where you cannot change the tool.

## License

[MIT](LICENSE)

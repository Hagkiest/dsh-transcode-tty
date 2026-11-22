# Troubleshooting

## First: run the self-check

```sh
npm run verify
```

It checks the manifest, the dependency, the entry point, each transform, the test
suite, and whether the live profile actually contains the entry. Most problems
show up here by name.

## The plugin has no effect at all

Work down this list — it is ordered by how often each is the cause.

### 1. The Harness has not been restarted

The Loader reads the profile composition at startup. After installing, **restart
DeepSeek Harness**. Editing `cordis.patch.yml` has the same requirement.

Confirm the entry is registered:

```powershell
node -e "const p=require('$env:USERPROFILE/.dsh/profiles/desktop/package.json'); console.log(p.dsh.profile.bundles)"
```

`dsh-transcode-tty` should be in the output.

### 2. The tool is not on the allow-list

Only tools in the `tools` config are normalized. If you are running commands
through a tool other than `pwsh`, `bash`, or `job_output` — an MCP shell tool, for
example — it is not covered by default.

Check the tool name in the tool card header, then add it:

```yaml
- id: dsh-transcode-tty
  config:
    tools:
      - pwsh
      - bash
      - job_output
      - your-mcp-shell-tool
```

### 3. The plugin is disabled

```yaml
- id: dsh-transcode-tty
  config:
    enabled: false     # remove this line
```

Or toggle it in **Settings → Plugins**.

### 4. The output is not a text block

The plugin only rewrites `type: 'text'` content blocks. Image blocks, attachments,
and anything else pass through by reference. A tool that returns its output inside
a structured `value` only — with no text block — is not affected, by design.

### 5. The block is larger than `maxTextLength`

Blocks longer than 262,144 characters are skipped to bound per-result cost. If you
are debugging a multi-megabyte dump, raise the limit temporarily:

```yaml
- id: dsh-transcode-tty
  config:
    maxTextLength: 4194304
```

## Output is still mojibake

### Identify the direction first

The repair handles three specific directions. Others exist and are out of scope.

| What you see | Direction | Covered |
| --- | --- | --- |
| `鏋勫缓鎴愬姛` — dense rare Hanzi | UTF-8 read as GBK | Yes |
| `æå»ºæç«` — Latin with `â`/`ã` | UTF-8 read as ISO-8859-1 | Yes |
| `ÖÐÎÄ` — uppercase Latin with `Ð`/`Î` | GBK read as ISO-8859-1 | Yes |
| `√Ω√†√≥` | UTF-8 read as Mac Roman | No |
| `?????` | Charset dropped every byte | Unrecoverable |
| `����` | Already-lost bytes | Partial, markers only |

### Check whether a byte was already lost

If the output contains `U+FFFD` **before** the plugin sees it, the byte is gone and
the repair can only restore the readable part. That is expected behavior, not a
bug. See [mojibake.md](mojibake.md#partial-recovery).

### Check the console code page

On Windows, the code page at the moment the command runs determines the bytes:

```powershell
chcp                    # 936 = GBK, 65001 = UTF-8
```

If the program writes UTF-8 while the page is 936, you get the first direction. The
plugin fixes the display, but the durable fix is at the source:

```powershell
chcp 65001
$OutputEncoding = [System.Text.Encoding]::UTF8
```

### Reproduce it outside the plugin

```powershell
node -e "
const { normalizeTerminalText } = require('D:/bcxm/dsh-transcode-tty/index.js');
" 2>$null
```

Use ESM instead — the package is `type: module`:

```powershell
node --input-type=module -e "
import { normalizeTerminalText } from 'file:///D:/bcxm/dsh-transcode-tty/index.js';
const input = 'paste the mojibake here';
console.log(JSON.stringify(normalizeTerminalText(input)));
"
```

If the standalone call repairs it but the Harness still shows garbage, the plugin
is not being reached — go back to "The plugin has no effect at all".

If the standalone call also leaves it alone, the direction is not one of the three
covered. The most useful thing to attach to an issue is the **raw bytes**:

```powershell
your-command | Format-Hex
```

## Correct text is being changed

This is a bug, and a serious one. The repair is validated as an exact inverse, so
it should be impossible — which means a counterexample is valuable.

Capture three things:

1. The exact input text (raw bytes if possible).
2. What the plugin produced.
3. Which transform is responsible — bisect by disabling them one at a time:

```yaml
- id: dsh-transcode-tty
  config:
    repairMojibake: false
```

If disabling `repairMojibake` fixes it, the scoring is wrong. If disabling
`foldFullwidth` fixes it, that transform was on when it should have been off.

Then report it with the guard test that should have caught it — that is how the
`café → caf茅` and `編譯成功` regressions were found.

## Escape sequences still visible

If you see literal `[1;31m` or `[2K`:

1. Confirm `stripAnsi` is not disabled.
2. Check whether the escape uses a form the stripper does not cover. OSC, CSI,
   charset selection, and bare ESC are all handled. An application-private
   sequence might not be.

A quick check:

```powershell
node --input-type=module -e "
import { stripAnsi } from 'file:///D:/bcxm/dsh-transcode-tty/index.js';
const esc = String.fromCharCode(27);
console.log(JSON.stringify(stripAnsi(esc + '[1;31mred' + esc + '[0m')));
"
```

Expect `"red"`. If you get something else, report the sequence's exact bytes.

## A progress bar is still stacked

`collapseCarriageReturns` keeps the last non-empty segment of a `\r`-separated
line. If the tool redraws with cursor-up escapes and no `\r`, the frames are
separate lines and this transform does not apply — the ANSI stripper removes the
cursor movement, but the frames remain.

If that is what you are seeing, the fix belongs in the tool (use `\r`, or detect a
non-TTY and disable the animation).

## The settings form does not appear

`Config` is `undefined` because `@deepseek-ai/schemastery` is not resolvable from
the plugin:

```powershell
Test-Path 'D:\bcxm\dsh-transcode-tty\node_modules\@deepseek-ai\schemastery'
```

If that is `False`:

```sh
cd D:\bcxm\dsh-transcode-tty
npm install
```

Then restart the Harness. Every transform still works without the schema — it runs
on the declared defaults — so this affects only the settings UI.

## Install fails

### "Could not find pnpm, corepack, or npx"

The installer needs a package manager to reconcile the profile. Install pnpm:

```sh
corepack enable pnpm
```

or use `npm install -g pnpm`, then re-run the installer.

### "No package.json in <path>"

The profile directory is wrong. Pass it explicitly:

```powershell
node scripts/install.mjs --profile-dir "$env:USERPROFILE\.dsh\profiles\desktop"
```

### "does not contain index.js"

The `link:` was not created. Check that the path in the profile's `package.json`
resolves, then reconcile:

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm install
```

### `ERR_UNSUPPORTED_ESM_URL_SCHEME`

You are running an older copy of a script that imported a bare Windows path. On
Windows, `import('D:\...')` is parsed as a URL with the scheme `d:`. Use
`pathToFileURL(...)` — the current scripts do. Update your checkout.

### `DEP0190` deprecation warning

An older copy of the installer passed an argument array with `shell: true`. The
current `scripts/lib.mjs` runs Windows shims through `cmd.exe /c` with a proper
argv instead. Update your checkout.

## Uninstall leaves something behind

`scripts/uninstall.mjs` restores the `package.json` backup only when the
dependencies and bundles are otherwise unchanged since install. If you added
another plugin in the meantime, it keeps your current file — correctly, since
restoring would drop that addition.

Check the result:

```powershell
Get-Content "$env:USERPROFILE\.dsh\profiles\desktop\package.json"
```

If `dsh-transcode-tty` is still listed, remove the entry and the dependency
manually, then reconcile with `pnpm install`.

## Performance

The plugin costs about 6 ms for a 416,000-character block, and near zero for pure
ASCII. If you suspect it:

- Lower `maxTextLength` so large blocks are skipped.
- Disable `repairMojibake` — it is the only per-character loop.
- Compare `npm test` timing before and after a change; the real-world suite prints
  its own duration.

## Still stuck

Open an issue with:

- Your OS, `chcp` output, Node version, and Harness version.
- The command and the tool it ran through.
- The output as displayed, and the raw bytes if the problem is mojibake.
- The output of `npm run verify`.

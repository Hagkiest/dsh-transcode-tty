# Configuration

Every option, its default, and the reason for that default.

## Where configuration lives

Three layers, applied in order — later layers win:

1. **`DEFAULT_CONFIG`** in `src/config.js` — the values the code falls back to.
2. **`cordis.patch.yml`** in this repository — the values a fresh install writes.
3. **Your profile's patch layer** — your overrides.

Layers 1 and 2 declare the same values, so a fresh install starts from a complete,
inspectable configuration rather than relying on schema defaults.

## How to change a value

### Settings UI

**Settings → Plugins → Terminal Text Transcoder.** The form is generated from the
`Config` schema in `src/config.js`, and each field carries the description shown in
the table below.

### Profile patch

Override the entry by `id` in your profile's `cordis.patch.yml`:

```yaml
- id: dsh-transcode-tty
  config:
    foldFullwidth: true
    tools:
      - pwsh
      - bash
```

Only the keys you list are overridden; everything else keeps its default. Restart
the Harness afterwards.

## Options

### `enabled`

| | |
| --- | --- |
| Type | boolean |
| Default | `true` |

Master switch. Turning it off leaves every other field in place, so you can disable
the plugin without losing your tuned settings. When `false`, the listener calls
`next()` immediately and costs one boolean comparison per tool result.

```yaml
enabled: false
```

### `tools`

| | |
| --- | --- |
| Type | string[] |
| Default | `["pwsh", "bash", "job_output"]` |

Which tools' output is normalized.

- `pwsh` — the PowerShell tool. Its results render as a terminal card, so escape
  sequences and mojibake both appear here.
- `bash` — the POSIX shell tool. Same rendering path.
- `job_output` — returns a background job's stream. Long-running builds are the
  most likely place to find ANSI color and progress redraws.

Add a tool when you know its output is rendered as terminal text:

```yaml
tools:
  - pwsh
  - bash
  - job_output
  - my-mcp-shell
```

**Do not** add `read` or `write`. They return file contents, and rewriting file
content would be wrong: the plugin is for terminal output, not for text on disk.

### `stripAnsi`

| | |
| --- | --- |
| Type | boolean |
| Default | `true` |

Remove escape sequences rather than displaying them as literal text. An
uninterpreted escape sequence is never useful, so this is on by default and rarely
worth turning off.

Turning it off also keeps the `ESC` byte through `stripControlChars` — the two
switches are independent, so disabling this one does not silently delete the
escapes anyway.

### `collapseCarriageReturns`

| | |
| --- | --- |
| Type | boolean |
| Default | `true` |

For a line containing `\r`, keep only the last non-empty segment — what a terminal
would leave visible. `\r\n` is first converted to `\n`, so Windows line endings are
not treated as overwrites.

```text
10%\r50%\r100% done   →   100% done
```

### `repairMojibake`

| | |
| --- | --- |
| Type | boolean |
| Default | `true` |

Master switch for the three repair directions. Set to `false` to diagnose which
transform is responsible for a change you did not expect.

### `repairUtf8AsGbk`

| | |
| --- | --- |
| Type | boolean |
| Default | `true` |

Repair UTF-8 text that was decoded as GBK/CP936 — the usual Windows console case.
Requires full ICU data in Node (standard in official builds).

### `repairUtf8AsLatin1`

| | |
| --- | --- |
| Type | boolean |
| Default | `true` |

Repair UTF-8 text decoded as ISO-8859-1. Detected structurally, so it is safe to
leave on.

### `repairGbkAsLatin1`

| | |
| --- | --- |
| Type | boolean |
| Default | `true` |

Repair GBK text decoded as ISO-8859-1. This direction carries a scoring penalty
because it is byte-ambiguous with genuine accented Latin text; disable it if you
work with a lot of real Latin-1 output.

### `stripControlChars`

| | |
| --- | --- |
| Type | boolean |
| Default | `true` |

Remove control and formatting characters that carry no visible meaning: C0 controls
except `\n` and `\t`, all C1 controls, zero-width characters (`U+200B`–`U+200F`),
bidi overrides (`U+202A`–`U+202E`), word joiners (`U+2060`–`U+2064`), and `U+FEFF`.

Runs **after** the mojibake repair, because that repair needs the C1 bytes this
transform deletes.

### `normalizeSpaces`

| | |
| --- | --- |
| Type | boolean |
| Default | `true` |

Replace space variants with `U+0020`: no-break space, ogham space mark, en/em/thin/
hair spaces, narrow no-break space, medium mathematical space, and ideographic
space. A terminal advances one column per `U+0020` and these are not that, which is
why aligned columns drift.

### `foldFullwidth`

| | |
| --- | --- |
| Type | boolean |
| Default | `false` |

Map fullwidth ASCII presentation forms to ASCII: `Ａ` → `A`, `１` → `1`, `，` → `,`.

Off by default because fullwidth characters are sometimes deliberate — in
CJK-typography output they align a Latin token to a two-column cell, and folding
changes that layout. Enable it when a legacy Windows tool emits fullwidth text by
accident.

### `collapseReplacementRuns`

| | |
| --- | --- |
| Type | boolean |
| Default | `false` |

Collapse a run of `U+FFFD` into a single marker.

Off by default because the run length is information: 40 replacement characters
means 40 lost characters, and hiding that makes a truncation look like a single
glitch.

### `trimTrailingWhitespace`

| | |
| --- | --- |
| Type | boolean |
| Default | `false` |

Strip trailing spaces and tabs from each line.

Off by default because trailing whitespace is occasionally meaningful: a
whitespace-sensitive diff, a Markdown hard line break, an aligned table built from
trailing spaces.

### `maxTextLength`

| | |
| --- | --- |
| Type | number |
| Default | `262144` (256 KiB) |

Text blocks longer than this are skipped, bounding the work per result. Checked
first in the pipeline, so an oversized block costs one comparison.

```yaml
maxTextLength: 1048576
```

A non-positive or non-numeric value falls back to the default rather than disabling
the guard.

## Interaction between options

| Setting A | Setting B | Result |
| --- | --- | --- |
| `stripAnsi: false` | `stripControlChars: true` | Escapes survive; `ESC` is retained through the control strip. |
| `repairMojibake: false` | any `repair*` direction | Directions are irrelevant; the master switch wins. |
| `stripControlChars: false` | `stripAnsi: true` | ANSI is still removed; other controls survive. |
| `maxTextLength: 0` | anything | Falls back to the default, so the guard stays active. |

## Type handling

`resolveSettings` merges your config over the defaults with asymmetric boolean
handling:

```js
stripAnsi: merged.stripAnsi !== false,        // opt-out: default on
foldFullwidth: merged.foldFullwidth === true, // opt-in: default off
```

A stray non-boolean in a hand-written patch file therefore cannot silently flip
behavior in the surprising direction. `foldFullwidth: 'yes'` leaves the transform
off; `stripAnsi: 0` leaves it on. Both are tested.

## Verifying a configuration

```powershell
node --input-type=module -e "
import { resolveSettings } from 'file:///D:/bcxm/dsh-transcode-tty/src/config.js';
const s = resolveSettings({ foldFullwidth: true });
console.log([...s.tools]);
console.log(s.options);
"
```

`resolveSettings` is exported so you can check the effective configuration without
restarting the Harness.

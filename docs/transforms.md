# Transforms

Each transform in `src/normalize.js`, with the input that motivates it and the
output it produces.

The pipeline order is fixed and explained at the end. Individual transforms are
pure `string → string`; none of them touches the filesystem, the network, or any
global state.

---

## `stripAnsi` — remove escape sequences

The renderer shows escape sequences as literal text, so a colored `ERROR` arrives
as `ESC[1;31mERROR`.

```text
ESC[1;31mERRORESC[0m: bad        →  ERROR: bad
ESC[2KESC[1Ghello               →  hello
ESC]0;my titleBELtext           →  text
ESC]8;;https://x.testBELlabel…   →  label
ESC(Babc                        →  abc
```

Five sequence families are handled:

| Family | Shape | What it is |
| --- | --- | --- |
| OSC | `ESC ] … BEL` or `ESC ] … ESC \` | Window titles, hyperlinks, clipboard |
| CSI (7-bit) | `ESC [ params intermediates final` | Colors, cursor movement, erase |
| CSI (8-bit) | `U+009B params intermediates final` | The same, using the C1 introducer |
| Charset | `ESC ( B`, `ESC # 8` | Character-set and line-attribute selection |
| Bare ESC | `ESC <final>` | Keypad modes, single-character sequences |

> **Why the C1 pattern has no `[`.** A CSI sequence is introducer + parameters +
> intermediates + final byte. With the 7-bit form the introducer is the two
> characters `ESC [`. With the 8-bit form the introducer is the single control
> character `U+009B` — the control *is* the bracket. Writing `/\u009B\[…/` matches
> nothing, which is a bug this project shipped once and now tests for.

A bare `ESC` is removed last, so an unrecognized sequence cannot leave a stray
control byte behind.

---

## `collapseCarriageReturns` — keep the final visible segment

A progress bar or spinner rewrites one line many times with `\r`. A terminal shows
only the last write; a text view shows all of them concatenated.

```text
10%\r50%\r100% done             →  100% done
⠋ loading\r⠙ loading\r✓ done    →  ✓ done
spinner\r                       →  spinner
```

`\r\n` is first converted to `\n`, so Windows line endings are not treated as
overwrites. For a line containing `\r`, the last **non-empty** segment wins — an
output that ends with `\r` (very common) keeps its content instead of becoming
blank.

---

## `repairMojibake` — undo encoding mis-decodes

Three directions, each validated as an exact inverse. Full detail is in
[mojibake.md](mojibake.md).

```text
UTF-8 read as GBK       鏋勫缓鎴愬姛       →  构建成功
UTF-8 read as Latin-1   æå»ºæç«            →  构建成功
GBK read as Latin-1     ÖÐÎÄ              →  中文
truncated              鏂囦欢鏈壘鍒       →  文件未找�   (one byte was lost)
```

---

## `stripControlChars` — remove invisible characters

Control and formatting characters that carry no visible meaning, but that break
alignment or make copied text wrong.

```text
a\u0000b\u0007c\nd\te           →  abc\nd\te     (NUL and BEL gone; LF and TAB kept)
a\u200Bb\uFEFFc                 →  abc           (zero-width space, BOM)
a\u202Eb                        →  ab            (bidi override)
a\u0090b                        →  ab            (C1 control)
```

Removed: C0 controls except `\n` and `\t`, all C1 controls, `U+200B`–`U+200F`,
`U+202A`–`U+202E`, `U+2060`–`U+2064`, and `U+FEFF`.

Preserved: `\n` and `\t`, because they define layout.

### The `keepEscape` option

```js
stripControlChars(text, { keepEscape: true })
```

Retains `U+001B` so a caller that disabled `stripAnsi` still sees the original
escape bytes. Without this, `stripAnsi: false` would be a lie: the escape would
survive the ANSI step only to be deleted as a control character. The two switches
are independent, and a test asserts it.

### Why it runs after the repair

UTF-8-read-as-Latin-1 corruption uses C1 bytes (`U+0080`–`U+009F`) as its payload.
Stripping controls first would delete the evidence and leave an unrepairable
fragment. Order is load-bearing, not cosmetic.

---

## `normalizeSpaces` — fold space variants

A terminal advances one column per space. These characters are not that.

```text
a\u00A0b\u3000c                 →  a b c
a\u2002b\u2003c                 →  a b c
a\u202Fb                        →  a b
```

Replaced with `U+0020`: no-break space, ogham space mark, en/em/thin/hair spaces,
narrow no-break space, medium mathematical space, and ideographic space.

Not replaced: zero-width space (`U+200B`) — it is invisible, so it belongs to
`stripControlChars`, and mapping it to a visible space would insert a gap the user
never had.

---

## `foldFullwidth` — opt-in, default **off**

Maps fullwidth ASCII presentation forms to ASCII, mirroring the safe part of NFKC.

```text
Ａ１，                          →  A1,
中文。                          →  中文。        (CJK punctuation untouched)
```

Off by default because fullwidth characters are sometimes deliberate: in
CJK-typography output they align a Latin token to a two-column cell. Folding them
changes the intended layout. Turn it on when a tool emits fullwidth text by
accident, which is common with legacy Windows tooling.

---

## `collapseReplacementRuns` — opt-in, default **off**

```text
a\uFFFD\uFFFD\uFFFDb           →  a\uFFFDb
```

Collapses a run of `U+FFFD` into one marker. Off by default because the run length
is information: 40 replacement characters means 40 lost characters, and hiding
that makes a truncation look like a single glitch.

---

## `trimTrailingWhitespace` — opt-in, default **off**

Strips trailing spaces and tabs from each line.

Off by default because trailing whitespace is occasionally meaningful — a
whitespace-sensitive diff, a Markdown hard line break, an aligned table built from
trailing spaces. Turn it on when a tool pads every line and the padding is noise.

---

## `normalizeTerminalText` — the pipeline

```js
export function normalizeTerminalText(text, options = {}) {
  if (typeof text !== 'string' || text.length === 0) return text;
  let out = text;
  if (options.maxTextLength !== undefined && out.length > options.maxTextLength) {
    return out;
  }
  if (options.stripAnsi !== false) out = stripAnsi(out);
  if (options.collapseCarriageReturns !== false) out = collapseCarriageReturns(out);
  if (options.repairMojibake !== false) {
    out = repairMojibake(out, {
      utf8AsGbk: options.repairUtf8AsGbk !== false,
      utf8AsLatin1: options.repairUtf8AsLatin1 !== false,
      gbkAsLatin1: options.repairGbkAsLatin1 !== false,
    });
  }
  if (options.stripControlChars !== false) {
    out = stripControlChars(out, { keepEscape: options.stripAnsi === false });
  }
  if (options.normalizeSpaces !== false) out = normalizeSpaces(out);
  if (options.foldFullwidth === true) out = foldFullwidth(out);
  if (options.collapseReplacementRuns === true) out = collapseReplacementRuns(out);
  if (options.trimTrailingWhitespace === true) {
    out = out.split('\n').map((line) => line.replace(/[ \t]+$/g, '')).join('\n');
  }
  return out;
}
```

### Why this order

| Step | Must come here because |
| --- | --- |
| `stripAnsi` | Escape parameters are digits and punctuation; leaving them in makes them look like text to the mojibake scorer. |
| `collapseCarriageReturns` | A spinner's frames would otherwise be scored and possibly repaired as one long corrupted run. |
| `repairMojibake` | Needs the C1 bytes that `stripControlChars` would delete. |
| `stripControlChars` | After the repair, so the payload survives long enough to be used. |
| `normalizeSpaces` | After the repair, so a space variant cannot be mistaken for a corrupted byte. |
| `foldFullwidth` | Last, because folding changes characters the repair may need to inspect. |
| `collapseReplacementRuns` | After the repair, so a repair's own honest markers are collapsed rather than being hidden from it. |
| `trimTrailingWhitespace` | Truly last: it is pure cosmetics and depends on the final line set. |

### The `maxTextLength` guard

```js
if (options.maxTextLength !== undefined && out.length > options.maxTextLength) {
  return out;
}
```

Checked first, so an oversized block costs one comparison rather than a full pass.
The same guard is repeated in `normalizeContent` in `src/plugin.js`, which is where
a real tool result is measured; the pipeline guard keeps the function safe when
called directly.

### Fast paths

Every transform returns early when its trigger character is absent:

```js
if (!text.includes('\u001B') && !text.includes('\u009B')) return text;  // stripAnsi
if (typeof text !== 'string' || !text.includes('\r')) return text;      // collapseCarriageReturns
if (!text.includes(REPLACEMENT)) return text;                           // collapseReplacementRuns
```

For a clean `npm run build` log — pure ASCII, no escapes — the whole pipeline is
five `includes` scans and no allocation. That is why the plugin can run on every
tool result without a measurable cost.

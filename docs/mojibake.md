# Mojibake

Why terminal output arrives as garbage, how each corruption direction is detected,
and why the repair cannot be allowed to guess.

## What mojibake actually is

Every text file, pipe, and console stream is bytes. A *charset* maps those bytes
to characters. Mojibake happens when the bytes were written with one charset and
read with another: the reader assigns characters to bytes that were never meant to
be those characters.

Three directions appear in real terminal output. Each is distinguishable, and each
is reversible — as long as no byte was dropped.

| Written as | Read as | Example | Looks like |
| --- | --- | --- | --- |
| UTF-8 | GBK (CP936) | `构建成功` → `鏋勫缓鎴愬姛` | Dense rare Hanzi |
| UTF-8 | ISO-8859-1 | `构建成功` → `æå»ºæç«` | Latin letters with accents and `â`/`ã` |
| GBK | ISO-8859-1 | `中文` → `ÖÐÎÄ` | Uppercase Latin plus `Ð`/`Î` |

The first is by far the most common on Windows: a program writes UTF-8, but the
console code page is 936, so the terminal decodes it as GBK.

## The repair loop

Every candidate goes through the same validation, and a candidate that fails is
discarded:

```text
input text
   │
   ├─ can every character be encoded back to bytes with charset B?
   │     no  → discard this direction
   │
   ├─ do those bytes decode as UTF-8?
   │     no  → try a lossy decode, if allowed
   │
   ├─ is the result better than the input, by the signal score?
   │     no  → discard
   │
   └─ accept
```

The re-encode step is the safety property: **a candidate must be an exact inverse
of the corruption**. Text that merely looks unusual re-encodes to something other
than the input, so it is never touched.

## Direction 1: UTF-8 read as GBK

### Detection

GBK is not a UTF-8 superset and has no replacement-character mechanism for this
case, so there is no `U+FFFD` to look for. A well-formed GBK decode of UTF-8 bytes
produces valid-looking Hanzi, which is exactly why this is the most confusing case.

The discriminator is statistical. GBK defines two levels:

| Level | Range | Contents | Count |
| --- | --- | --- | --- |
| 1 | `0xB0A1`–`0xD7FE` | Common characters, sorted by pinyin | 3,755 |
| 2 | `0xD8A1`–`0xF7FE` | Rare characters: names, classical, dialect | 3,008 |

A UTF-8-read-as-GBK mis-decode lands mostly in **level 2** or outside both levels,
because it is essentially a uniform distribution over byte pairs, and level 1 is
only a third of the space. Genuine Chinese prose is overwhelmingly **level 1**.

```text
鏋勫缓鎴愬姛      4 of 5 in level 2   → score high, repair
构建成功          5 of 5 in level 1   → score low, leave alone
张燚 李鑫 王淼     3 rare Hanzi         → still level 1 dominant overall
```

### What survives untouched

The level distribution is not a perfect classifier, so the guard tests cover the
cases that could plausibly fool it:

```text
构建成功            简体中文，常见字
編譯成功            繁體中文
ビルドが成功しました  日本語
빌드 성공           한국어
张燚 李鑫 王淼       生僻字姓名
café résumé naïve   带重音拉丁字母
┌──────────┐       制表符框线
🎉 ✅ 🚀            表情符号
```

Each of these is either not encodable as GBK at all (so no direction applies), or
scores low on the level distribution. Both paths are tested.

### Partial recovery

UTF-8 is variable-length. If the byte stream was truncated — a pipe closed early, a
buffer cut at 4095 bytes — the last character is incomplete, and the GBK decode of
the surviving bytes may consume one byte of it into a pair. One character is gone.

`U+FFFD` has no GBK form, so encoding the input fails outright. The repair:

1. Count the holes (`U+FFFD` occurrences).
2. Remove them.
3. Encode and repair the surviving bytes.
4. Re-append one `U+FFFD` per hole.

```text
文件未找到   →  GBK mis-decode, truncated
鏂囦欢鏈壘鍒  →  文件未找�
```

One visible marker for one lost character. This is deliberate: the alternative is
to guess plausible Hanzi, which produces text that reads correctly and is wrong.
A visible marker is honest, renders cleanly, and cannot mislead.

The acceptance threshold for this lossy branch is tight:

```js
lost <= Math.max(1, Math.floor(bytes.length / 8))
```

A candidate that "recovers" a plausible string while discarding a large fraction of
the input is rejected, because at that point it is inventing text rather than
repairing it.

## Direction 2: UTF-8 read as ISO-8859-1

### Detection

This one has a **structural** signature, not a statistical one. UTF-8 encodes a
non-ASCII character as a lead byte in `0xC2`–`0xF4` followed by one to three
continuation bytes in `0x80`–`0xBF`. Read as ISO-8859-1, each becomes one Latin-1
character, so the mojibake contains:

- A lead character in `U+00C2`–`U+00F4` (`Â`, `Ã`, `Ä`, …, `ô`).
- The correct number of following characters in `U+0080`–`U+00BF`.

That is a shape genuine Latin-1 text essentially never has by accident. The scorer
adds `+8` per correctly shaped sequence, and the round-trip check confirms it.

```text
构建成功  →  e6 9e 84 e5 bb ba e6 88 90 e5 8a 9f
          →  æ  9e 84  å  bb ba  æ  88 90  å  8a 9f
          →  æå»ºæç«
```

### What survives untouched

```text
café résumé naïve     real accented Latin
Ã©                    a lone sequence; no surrounding structure
à la carte            no lead character in the UTF-8 range
```

The structural scan needs the *pattern*, not a single character, so a stray `Ã` in
a French sentence is not enough.

## Direction 3: GBK read as ISO-8859-1

The least common, and the one that needs a penalty to keep it from firing on
correct text.

### Detection

A GBK two-byte character has a lead in `0x81`–`0xFE` and a trail in `0x40`–`0xFE`.
Read as ISO-8859-1, both bytes become Latin-1 characters, so the mojibake is a
string of mostly uppercase and punctuation-range Latin-1:

```text
中文  →  d6 d0 ce c4  →  ÖÐÎÄ
```

`Ö` and `Ð` and `Î` are the tell — characters in `U+00C0`–`U+00FF` mixed with
`U+0040`–`U+007E` in a pattern that is not any real language.

### Why it needs a penalty

`ÖÐÎÄ` re-encodes and decodes plausibly in more than one direction, and a genuine
Latin-1 string such as `München` shares the `U+00C0`–`U+00FF` range. Without a
penalty, the scorer can prefer this direction over the correct one:

```js
const DIRECTION_PENALTY = {
  utf8AsGbk: 0,
  utf8AsLatin1: 0,
  gbkAsLatin1: 4,   // ambiguous; require a clearly better score to win
};
```

The `4` was chosen empirically against the guard set: high enough that `café` is
not turned into `caf茅`, low enough that real GBK-as-Latin-1 output is still
repaired. The `café → caf茅` regression is a test.

## Ambiguity inside CP936 itself

CP936 is a **variable-length** encoding, and one character has two encodings:

```text
0x80       →  €   (U+20AC, single byte)
A2 E3      →  €   (two bytes)
```

A reverse map built by sweeping only two-byte pairs inverts `€` into `A2 E3`. When
the original byte stream contained a lone `0x80`, that substitution desynchronizes
everything after it, the round-trip check fails, and the repair is discarded —
even though it was the right direction.

```text
所有测试通过
  → utf8AsGbk  →  鎵€鏈夋祴璇曢€氳繃
  → reverse map (pairs only)  →  … e6 89 a2 e3 …     ✗ round-trip fails
  → reverse map (single-byte first)  →  … e6 89 80 …  ✓ round-trip holds
```

The fix is ordering: enumerate single-byte forms before two-byte forms, so the
single byte wins the ambiguity. That is the correct inverse, because a mis-decoded
UTF-8 continuation byte genuinely arrived as one byte.

> This was the last bug found before 1.0.0, and it is the reason
> `test/realworld.test.mjs` includes a case whose repaired output contains `€`
> in its mojibake form.

## Why not simply try every charset

A brute-force "decode with everything, pick the most plausible" approach has no
ground truth to compare against, and it will happily convert correct text into
plausible-looking text in a different language. The round-trip requirement is what
makes this problem tractable: it is a *constraint*, not a heuristic. Only a
candidate that is the exact inverse of an actual encoding mistake can pass.

## Idempotence

Repairing already-repaired text must change nothing:

```js
repair(repair(x)) === repair(x)
```

This holds because the round-trip check rejects the second attempt: repaired text
either is not encodable as GBK (genuine characters outside the mis-decode
distribution) or re-encodes to bytes that decode as valid UTF-8 already, so no
candidate scores better than the input. Both suites assert idempotence on every
repair case.

## When it cannot help

The plugin cannot recover what was never there:

- A byte dropped before the text was written to the pipe.
- A charset that maps two different source bytes to the same character.
- Text that was already wrong when the program produced it.

In those cases the honest output is the partial repair with a visible marker, and
the real fix is at the source: `chcp 65001`, `LANG=C.UTF-8`, or a UTF-8-aware
replacement for the legacy tool.

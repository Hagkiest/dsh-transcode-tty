# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] — 2026-11-22

First release.

### Added

- Host plugin that normalizes shell tool output through the `tools/post-execute`
  waterfall, for `pwsh`, `bash`, and `job_output`.
- ANSI/VT escape stripping: OSC titles and hyperlinks, CSI colors and cursor
  movement, single-character ESC sequences, and the C1 `U+009B` introducer.
- Carriage-return collapsing, which reduces a spinner or progress bar to the
  segment a terminal would leave visible.
- Mojibake repair in three directions, each validated as an exact inverse of the
  corruption: UTF-8 read as GBK, UTF-8 read as ISO-8859-1, and GBK read as
  ISO-8859-1.
- Honest partial recovery: when the wrong charset already dropped a byte, the
  readable part is restored and the loss stays visible as one `U+FFFD` per lost
  character, rather than being replaced with plausible-looking wrong text.
- Control-character removal (C0/C1, zero-width, bidi marks), space-variant
  normalization, and three opt-in transforms: fullwidth folding, replacement-run
  collapsing, and trailing-whitespace trimming.
- Configuration schema rendered in the Harness settings UI, with a documented
  default for every field.
- `install.ps1`, `install.sh`, and `scripts/install.mjs` for a scripted install
  that mirrors what the in-app plugin manager does.
- `scripts/uninstall.mjs`, which restores the `package.json` backup only when
  nothing else changed in the meantime.
- `scripts/verify.mjs`, a single command that checks manifest, dependencies,
  entry point, transforms, tests, and the live profile composition.
- 117 assertions across three suites, with no test-framework dependency.

### Fixed

- CP936 single-byte forms were missing from the reverse map, so a lone `0x80`
  (which decodes to `€`) was inverted into two bytes, desynchronizing the byte
  stream and failing the round-trip check. Single-byte forms are now enumerated
  first and win the ambiguity.
- The C1 CSI pattern expected a literal `[` after `U+009B`, so C1-introduced
  sequences were never stripped. The control *is* the bracket.
- `stripAnsi: false` still removed the escape bytes, because control-character
  stripping ran afterwards with no knowledge of the setting. The two switches are
  now independent.
- Truncated GBK mis-decodes could not be repaired at all: `U+FFFD` has no GBK
  form, so encoding the input failed outright and the repair path was never
  reached. Holes are now removed before encoding and the loss is restored
  afterwards.
- A `U+FFFD` in a candidate was weighted so heavily that a correct repair could
  never beat its own input whenever a byte had already been lost.

[Unreleased]: https://github.com/Hagkiest/dsh-transcode-tty/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Hagkiest/dsh-transcode-tty/releases/tag/v1.0.0

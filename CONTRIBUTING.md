# Contributing to dsh-transcode-tty

Thanks for taking the time to contribute. This document covers the invariants a
change must preserve, because several of them are the difference between "fixes
mojibake" and "silently corrupts correct text".

## Getting started

```sh
git clone https://github.com/dsh-transcode-tty/dsh-transcode-tty.git
cd dsh-transcode-tty
npm install
npm test
```

`npm test` runs 117 assertions across three suites in under a second, with no
test-framework dependency. If it passes, you have a working baseline.

## Project layout

```text
index.js               thin façade; re-exports the public surface
src/config.js          defaults, schema, config resolution
src/plugin.js          the tools/post-execute listener
src/normalize.js       pure transforms; must stay import-free
cordis.patch.yml       the bundle patch the Loader applies
locale/                plugin metadata for the settings UI
scripts/               install, uninstall, verify, shared helpers
test/                  three suites plus shared harness and samples
docs/                  architecture, transforms, mojibake, troubleshooting
```

## Invariants

These are not style preferences. Breaking one is a bug even if the tests pass.

### 1. `src/normalize.js` imports nothing

No Node built-ins, no dependencies, no `import` statements at all. Every function
is a pure `string → string`. This is what makes the surface testable without a
Harness runtime and what makes the hot path safe. If you need a helper from
`src/config.js`, pass the value in as an argument.

### 2. A repair must be an exact inverse

Every candidate is validated by re-encoding it with the charset that supposedly
produced the mojibake and comparing to the input byte for byte. A candidate that
does not round-trip is discarded. Never relax this to "looks plausible" — the
failure mode is confident-looking wrong text.

### 3. Never invent content for lost bytes

When the wrong charset already dropped a byte, the byte is gone. Restore what is
readable and leave one `U+FFFD` per lost character. Do not guess.

### 4. Repairs must be idempotent

`repair(repair(x)) === repair(x)`. A second pass over repaired output must change
nothing. Both mojibake suites assert this.

### 5. Genuine text must survive

Every change to the scoring needs a guard test proving that ordinary Chinese,
traditional Chinese, Japanese, Korean, rare Hanzi, accented Latin, emoji, and box
drawing all pass through untouched. The `GENUINE` list in `test/samples.mjs` is
the canonical set.

### 6. The post-execute decision carries `content` and nothing else

The runtime rejects a decision that carries both `content` and `value`. Returning
`{ kind: 'accept', content }` replaces only the text block and leaves the
structured result intact for downstream consumers. Never spread `result` into the
decision.

### 7. No change means `next()`

A result that needs no rewrite must fall through, not be replaced with an
identical copy. `test/plugin.test.mjs` asserts `nextCalls === 1` for these paths.

### 8. Opt-in transforms default to off

`foldFullwidth`, `collapseReplacementRuns`, and `trimTrailingWhitespace` can
change intended layout or hide information. A new transform of that kind defaults
to `false` and is documented in the table in both READMEs.

## Making a change

1. **Reproduce it as a test first.** Add a case to the suite that matches the
   concern — `normalize.test.mjs` for one transform, `realworld.test.mjs` for a
   realistic artifact, `plugin.test.mjs` for wiring. Watch it fail.
2. **Fix the cause, not the symptom.** If the round-trip check rejects a correct
   repair, the bug is in the reverse map or the scoring, not in the check.
3. **Run the whole suite.** `npm test` then `npm run verify`.
4. **Update the docs.** A behavior change touches `README.md`,
   `README.zh-CN.md`, `CHANGELOG.md`, and the relevant file in `docs/`.

### Adding a transform

- Implement it in `src/normalize.js` as a pure function with a JSDoc block that
  says *why* it exists, not just what it does.
- Place it in the pipeline deliberately. ANSI first; mojibake before
  control-character stripping. Explain the position in the comment.
- Add a switch to `src/config.js` with a `.description()` the settings UI can
  render, plus a matching entry in `DEFAULT_CONFIG`.
- Add it to `cordis.patch.yml` so a fresh install writes the full config.
- Add a row to both README tables and a section to `docs/transforms.md`.

### Adding a mojibake direction

This is the highest-risk kind of change. It needs all of:

- A sample helper in `test/samples.mjs` that reproduces the corruption exactly.
- Round-trip validation in `tryRepair`.
- A signal in `mojibakeSignals` that distinguishes it from genuine text, plus a
  guard test proving genuine text in that script survives.
- A `DIRECTION_PENALTY` entry if it is byte-ambiguous with another direction.
- A section in `docs/mojibake.md` explaining the discriminator.

## Style

- Tabs for indentation, single quotes, semicolons. The existing files are
  consistent; match them.
- JSDoc on every exported symbol: `@param`, `@returns`, and a sentence on intent.
- Comments explain *why*. A comment restating the code is noise; a comment
  recording a non-obvious constraint (why this order, why this penalty, why this
  byte is ambiguous) is the most valuable thing in the file.
- No dependency may be added to `src/`. A new dependency in `scripts/` needs a
  justification in the pull request.

## Commit messages

Conventional Commits, imperative mood, lowercase subject:

```text
fix: enumerate CP936 single-byte forms in the reverse map
feat: add an option to trim trailing whitespace
docs: explain the GBK level-distribution discriminator
test: cover a truncated mis-decode with an odd byte count
```

The body should state the failure that motivated the change and the observable
difference after it. "Fixes the bug" is not a body.

## Reporting a bug

Include:

- The exact command, and the tool it ran through (`pwsh`, `bash`, `job_output`).
- The output as the Harness displayed it.
- What you expected.
- Your OS, console code page (`chcp` on Windows), and Node version.

If the output is mojibake, the raw bytes are the most useful thing you can
attach: `command | Format-Hex` on Windows, or `command | xxd` elsewhere.

## Pull requests

- One concern per pull request.
- `npm test` and `npm run verify` must pass.
- New behavior needs a test that fails without your change.
- Update `CHANGELOG.md` under `## [Unreleased]`.

## License

By contributing you agree that your contribution is licensed under the
[MIT License](LICENSE).

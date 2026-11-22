## What this changes

<!-- One paragraph. State the failure that motivated the change and the
     observable difference after it. "Fixes the bug" is not enough. -->

## Which part

- [ ] `src/normalize.js` — a transform
- [ ] `src/plugin.js` — the post-execute listener
- [ ] `src/config.js` — defaults or schema
- [ ] `cordis.patch.yml` — the bundle patch
- [ ] `scripts/` — install, uninstall, verify
- [ ] `test/` — the suites
- [ ] Documentation

## Invariants

<!--
These are not style preferences. Breaking one is a bug even if the tests pass.
See CONTRIBUTING.md for the full reasoning.
-->

- [ ] `src/normalize.js` still has no imports
- [ ] Any new repair is validated as an exact inverse (round-trip check)
- [ ] No content is invented for lost bytes — `U+FFFD` markers instead
- [ ] Repairs remain idempotent
- [ ] Genuine Chinese, traditional Chinese, Japanese, Korean, rare Hanzi, accented
      Latin, emoji, and box drawing still pass through untouched
- [ ] The post-execute decision carries `content` and nothing else
- [ ] No change still means `next()`
- [ ] A new risky transform defaults to `false`

## Tests

- [ ] `npm test` passes
- [ ] `npm run verify` passes
- [ ] A new test fails without this change

<!-- For a mojibake direction, also: a sample helper that reproduces the
     corruption exactly, a scoring signal, a guard test, and a docs section. -->

## Documentation

- [ ] `README.md` and `README.zh-CN.md` updated if behavior changed
- [ ] `CHANGELOG.md` updated under `## [Unreleased]`
- [ ] The relevant file in `docs/` updated

## Checklist

- [ ] One concern in this pull request
- [ ] No dependency added to `src/`
- [ ] Commits follow Conventional Commits
- [ ] I agree to license this contribution under the MIT License

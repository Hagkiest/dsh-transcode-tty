/**
 * Plugin entry point.
 *
 * The Cordis Loader reads `Config`, `apply`, and `name` from the module this
 * package's `exports["."]` resolves to, so this file stays a thin façade over
 * `src/`. Keeping the implementation in `src/` lets each concern be imported and
 * tested on its own:
 *
 * - `src/normalize.js` — pure string transforms, no imports at all.
 * - `src/config.js` — the runtime schema and default resolution.
 * - `src/plugin.js` — the `tools/post-execute` listener.
 *
 * @module dsh-transcode-tty
 */

export { apply, name } from './src/plugin.js';
export { Config, DEFAULT_CONFIG, DEFAULT_TOOLS } from './src/config.js';
export {
	collapseCarriageReturns,
	collapseReplacementRuns,
	foldFullwidth,
	normalizeSpaces,
	normalizeTerminalText,
	repairMojibake,
	stripAnsi,
	stripControlChars,
} from './src/normalize.js';

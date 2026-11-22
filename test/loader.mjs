/**
 * Test-only module-resolution hook.
 *
 * The plugin declares `@deepseek-ai/schemastery` as a dependency, so a normal
 * install makes it resolve. This hook exists so the suite also covers the
 * fallback path a linked install takes when that dependency was skipped: it maps
 * the specifier to a local stub, which lets the plugin build a schema without the
 * real library.
 *
 * Run with `node --import ./test/loader.mjs test/plugin.test.mjs`.
 *
 * @module dsh-transcode-tty/test/loader
 */

import { register } from 'node:module';

const stubUrl = new URL('./stub-schemastery.js', import.meta.url).href;

register(
	'data:text/javascript,' +
		encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
	if (specifier === '@deepseek-ai/schemastery') {
		return { shortCircuit: true, url: ${JSON.stringify(stubUrl)} };
	}
	return nextResolve(specifier, context);
}
`),
	import.meta.url,
);

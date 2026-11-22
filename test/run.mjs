/**
 * Suite runner: executes every test file in this directory in order.
 *
 * Each file is a standalone ES module that reports its own results and sets
 * `process.exitCode` on failure, so running them as child processes keeps their
 * module state isolated and lets the runner report a single verdict.
 *
 * @module dsh-transcode-tty/test/run
 */

import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Suites in execution order, with the arguments each needs.
 *
 * The loader is passed as a `file://` URL: `--import` goes through the ESM
 * resolver, and on Windows a bare absolute path such as `D:\...` is parsed as a
 * URL with the scheme `d:`, which the default loader rejects with
 * ERR_UNSUPPORTED_ESM_URL_SCHEME.
 */
const SUITES = [
	{ file: 'normalize.test.mjs', args: [], label: 'transforms' },
	{ file: 'realworld.test.mjs', args: [], label: 'real-world output' },
	{
		file: 'plugin.test.mjs',
		args: ['--import', pathToFileURL(join(here, 'loader.mjs')).href],
		label: 'plugin wiring',
	},
];

/**
 * Run one suite as a child process and stream its output.
 * @param {{ file: string, args: string[], label: string }} suite - the suite.
 * @returns {Promise<{ label: string, code: number }>} the exit status.
 */
function runSuite(suite) {
	return new Promise((resolve) => {
		const child = spawn(
			process.execPath,
			[...suite.args, join(here, suite.file)],
			{ stdio: 'inherit' },
		);
		child.on('close', (code) => resolve({ label: suite.label, code: code ?? 1 }));
		child.on('error', () => resolve({ label: suite.label, code: 1 }));
	});
}

const results = [];
for (const suite of SUITES) {
	results.push(await runSuite(suite));
}

console.log('\n' + '='.repeat(60));
let failed = 0;
for (const { label, code } of results) {
	const status = code === 0 ? 'PASS' : 'FAIL';
	if (code !== 0) failed += 1;
	console.log(`${status}  ${label}`);
}
console.log('='.repeat(60));
console.log(
	failed === 0
		? `All ${results.length} suites passed.`
		: `${failed} of ${results.length} suites failed.`,
);
if (failed > 0) process.exitCode = 1;

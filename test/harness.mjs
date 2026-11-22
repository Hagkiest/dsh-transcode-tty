/**
 * Minimal test harness shared by every suite in this directory.
 *
 * The project deliberately has no test framework dependency: the transforms are
 * pure functions, so a couple of counters and `node:assert` cover the whole
 * surface while keeping `npm test` installable from a bare checkout.
 *
 * @module dsh-transcode-tty/test/harness
 */

import assert from 'node:assert/strict';

/**
 * Create an isolated suite with its own pass/fail counters.
 * @param {string} title - suite name, printed as a heading.
 * @returns {{ check: (label: string, fn: () => void) => void, report: () => number }} the suite.
 */
export function suite(title) {
	let passed = 0;
	let failed = 0;
	const failures = [];
	console.log(`\n# ${title}`);

	/**
	 * Run one assertion group.
	 * @param {string} label - what the check proves.
	 * @param {() => void} fn - the assertions.
	 */
	function check(label, fn) {
		try {
			fn();
			passed += 1;
			console.log(`ok   ${label}`);
		} catch (error) {
			failed += 1;
			failures.push({ label, error });
			console.log(`FAIL ${label}`);
			console.log(`     ${error.message.split('\n')[0]}`);
		}
	}

	/**
	 * Print the summary and set the process exit code on failure.
	 * @returns {number} how many checks failed.
	 */
	function report() {
		console.log(`\n${passed} passed, ${failed} failed`);
		if (failed > 0) {
			for (const { label, error } of failures) {
				console.log(`\n--- ${label} ---\n${error.stack ?? error.message}`);
			}
			process.exitCode = 1;
		}
		return failed;
	}

	return { check, report };
}

export { assert };

/**
 * Assert that `text` survives the round trip unchanged.
 * @param {string} text - expected content.
 * @param {(input: string) => string} transform - the transform under test.
 * @param {string} [label] - context for a failure message.
 */
export function assertUnchanged(text, transform, label = '') {
	const actual = transform(text);
	assert.equal(
		actual,
		text,
		`${label} expected text to be preserved, got ${JSON.stringify(actual)}`,
	);
}

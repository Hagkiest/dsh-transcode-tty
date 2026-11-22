#!/usr/bin/env node
/**
 * Post-install verification.
 *
 * Checks the things that silently break a bundle install, in the order they break:
 * the manifest is well-formed, the entry point imports, the Config schema builds,
 * the transforms work, and — when a profile is reachable — the composition
 * actually contains this entry.
 *
 * `npm run verify` is meant to be the one command a user runs when the plugin
 * "does not seem to do anything".
 *
 * @module dsh-transcode-tty/scripts/verify
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

let failures = 0;
/** Print a passing check. */
const pass = (message) => console.log(`  PASS  ${message}`);
/** Print a failing check and count it. */
const fail = (message) => {
	failures += 1;
	console.log(`  FAIL  ${message}`);
};
/** Print a non-fatal note. */
const note = (message) => console.log(`  note  ${message}`);

/** Print a section heading. */
const section = (message) => console.log(`\n${message}`);

// --- manifest -----------------------------------------------------------
section('Manifest');
let pkg;
try {
	pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
	pass('package.json parses');
} catch (error) {
	fail(`package.json does not parse: ${error.message}`);
	process.exit(1);
}

if (pkg.dsh?.bundle?.patch === './cordis.patch.yml') {
	pass('dsh.bundle.patch points at ./cordis.patch.yml');
} else {
	fail(`dsh.bundle.patch is ${JSON.stringify(pkg.dsh?.bundle?.patch)}, expected "./cordis.patch.yml"`);
}

if (existsSync(join(repoRoot, 'cordis.patch.yml'))) {
	pass('cordis.patch.yml exists');
} else {
	fail('cordis.patch.yml is missing');
}

if (pkg.exports?.['.'] === './index.js') {
	pass('exports["."] points at ./index.js');
} else {
	fail(`exports["."] is ${JSON.stringify(pkg.exports?.['.'])}, expected "./index.js"`);
}

if (pkg.type === 'module') {
	pass('package is an ES module');
} else {
	fail('package.json must set "type": "module"');
}

const patchText = existsSync(join(repoRoot, 'cordis.patch.yml'))
	? readFileSync(join(repoRoot, 'cordis.patch.yml'), 'utf8')
	: '';
if (patchText.includes(`name: ${pkg.name}`)) {
	pass(`patch inserts the entry name ${pkg.name}`);
} else {
	fail(`cordis.patch.yml does not insert an entry named ${pkg.name}`);
}

// --- dependencies -------------------------------------------------------
section('Dependencies');
if (existsSync(join(repoRoot, 'node_modules', '@deepseek-ai', 'schemastery'))) {
	pass('@deepseek-ai/schemastery is installed');
} else {
	note('@deepseek-ai/schemastery is missing; the plugin runs on defaults without a settings form');
}

// --- entry point --------------------------------------------------------
section('Entry point');
let mod;
try {
	/*
	 * Import through a file:// URL. On Windows a bare absolute path such as
	 * `D:\...` is parsed as a URL whose scheme is the drive letter, and the ESM
	 * loader rejects that with ERR_UNSUPPORTED_ESM_URL_SCHEME.
	 */
	mod = await import(pathToFileURL(join(repoRoot, 'index.js')).href);
	pass('index.js imports');
} catch (error) {
	fail(`index.js failed to import: ${error.message}`);
}

if (mod !== undefined) {
	if (typeof mod.apply === 'function') pass('exports apply()');
	else fail('apply() is not exported as a function');

	if (typeof mod.name === 'string' && mod.name.length > 0) pass(`exports name "${mod.name}"`);
	else fail('name is not exported as a non-empty string');

	if (mod.Config !== undefined) pass('exports a Config schema');
	else note('Config is undefined; the settings form will not render');

	const normalized = mod.normalizeTerminalText('\u001B[31mred\u001B[0m');
	if (normalized === 'red') pass('a color escape is stripped');
	else fail(`stripAnsi produced ${JSON.stringify(normalized)}, expected "red"`);

	const mojibake = new TextDecoder('gbk').decode(Buffer.from('中文测试', 'utf8'));
	const repaired = mod.normalizeTerminalText(mojibake);
	if (repaired === '中文测试') pass('GBK mojibake is repaired');
	else fail(`repair produced ${JSON.stringify(repaired)}, expected "中文测试"`);

	const genuine = '构建成功：共 42 个文件';
	if (mod.normalizeTerminalText(genuine) === genuine) pass('genuine Chinese is left alone');
	else fail('genuine Chinese was modified');
}

// --- tests --------------------------------------------------------------
section('Test suite');
const tests = spawnSync(process.execPath, [join(repoRoot, 'test', 'run.mjs')], {
	stdio: 'ignore',
});
if (tests.status === 0) pass('all suites pass');
else fail('the test suite failed; run `npm test` for details');

// --- live composition ---------------------------------------------------
section('Live profile');
const profileDir =
	process.env.DSH_PROFILE_DIR ??
	join(homedir(), '.dsh', 'profiles', process.env.DSH_PROFILE ?? 'desktop');
const profilePkgPath = join(profileDir, 'package.json');
if (!existsSync(profilePkgPath)) {
	note(`no profile at ${profileDir}; skipping composition checks`);
} else {
	const profilePkg = JSON.parse(readFileSync(profilePkgPath, 'utf8'));
	const bundles = profilePkg.dsh?.profile?.bundles ?? [];
	if (bundles.includes(pkg.name)) pass(`${pkg.name} is in dsh.profile.bundles`);
	else fail(`${pkg.name} is not in dsh.profile.bundles; run the installer`);

	const installed = join(profileDir, 'node_modules', pkg.name);
	if (existsSync(join(installed, 'index.js'))) pass(`the profile links ${installed}`);
	else fail(`${installed} does not exist; run the installer`);

	if (existsSync(join(profileDir, 'package.json.dsh-transcode-tty.bak'))) {
		note('an install backup is present; it is removed on uninstall');
	}
}

console.log(
	failures === 0
		? '\nAll checks passed.\n'
		: `\n${failures} check(s) failed.\n`,
);
if (failures > 0) process.exitCode = 1;

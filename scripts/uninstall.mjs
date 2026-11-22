#!/usr/bin/env node
/**
 * Uninstall `dsh-transcode-tty` from a DeepSeek Harness profile.
 *
 * The reverse of `install.mjs`: remove the bundle from `dsh.profile.bundles`,
 * drop the dependency, reconcile the profile, and restore the `package.json`
 * backup the installer took — but only when nothing else changed in the
 * meantime, so an unrelated edit is never silently discarded.
 *
 * @module dsh-transcode-tty/scripts/uninstall
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPnpm, ok, resolveProfileDir, run, step } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const BACKUP = 'package.json.dsh-transcode-tty.bak';

const profileDir = resolveProfileDir();
const profilePkgPath = join(profileDir, 'package.json');
const backupPath = join(profileDir, BACKUP);

step(`Uninstalling ${pkg.name}`);
console.log(`    profile ${profileDir}`);

if (!existsSync(profilePkgPath)) {
	console.error(`\nNo package.json in ${profileDir}. Nothing to uninstall.`);
	process.exit(1);
}

const profilePkg = JSON.parse(readFileSync(profilePkgPath, 'utf8'));
let changed = false;

const bundles = profilePkg.dsh?.profile?.bundles;
if (Array.isArray(bundles) && bundles.includes(pkg.name)) {
	profilePkg.dsh.profile.bundles = bundles.filter((entry) => entry !== pkg.name);
	changed = true;
	ok(`removed ${pkg.name} from dsh.profile.bundles`);
}

if (profilePkg.dependencies?.[pkg.name] !== undefined) {
	delete profilePkg.dependencies[pkg.name];
	changed = true;
	ok(`removed the ${pkg.name} dependency`);
}

if (changed) {
	writeFileSync(profilePkgPath, `${JSON.stringify(profilePkg, null, 2)}\n`);
} else {
	ok('nothing to change; the plugin was not registered');
}

step('Reconciling the profile');
const pnpm = findPnpm();
if (pnpm === null) {
	console.error('\nCould not find pnpm, corepack, or npx. Reconcile the profile manually.');
	process.exit(1);
}
if (!run(pnpm.command, [...pnpm.args, 'install'], profileDir)) {
	console.error('\nThe profile package manager failed. See its output above.');
	process.exit(1);
}
ok('profile reconciled');

if (existsSync(backupPath)) {
	const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
	const current = JSON.parse(readFileSync(profilePkgPath, 'utf8'));
	/*
	 * Restore only when the two files now describe the same dependencies and
	 * bundles. If the user added something else since installing, the sets differ
	 * and overwriting would silently drop that edit, so the current file wins.
	 */
	const keysOf = (value) => JSON.stringify(Object.keys(value.dependencies ?? {}).sort());
	const bundlesOf = (value) => JSON.stringify([...(value.dsh?.profile?.bundles ?? [])].sort());
	if (keysOf(backup) === keysOf(current) && bundlesOf(backup) === bundlesOf(current)) {
		writeFileSync(profilePkgPath, `${JSON.stringify(backup, null, 2)}\n`);
		ok('restored the package.json backup');
	} else {
		ok('kept the current package.json (it changed since installing)');
	}
	try {
		rmSync(backupPath);
	} catch {
		// A leftover backup is harmless; the installer overwrites it next time.
	}
}

console.log(`
${pkg.name} is uninstalled.

Restart DeepSeek Harness so the Loader drops the entry. The plugin source in
${repoRoot}
was not touched.
`);

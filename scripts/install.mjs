#!/usr/bin/env node
/**
 * Install `dsh-transcode-tty` into a DeepSeek Harness profile.
 *
 * The script performs the same steps the in-app plugin manager does, but from a
 * terminal so it can be scripted and inspected:
 *
 * 1. Resolve the profile directory.
 * 2. Make the plugin's own dependencies resolvable, which is what makes the
 *    Config schema appear in the settings form.
 * 3. Register the package as a `link:` dependency of the profile.
 * 4. Add the package to `dsh.profile.bundles`, which is what makes the Loader
 *    read its `cordis.patch.yml`.
 * 5. Reconcile the profile with pnpm.
 * 6. Verify that the linked package contains the two files the Loader needs.
 *
 * Every step is idempotent. The profile's `package.json` is backed up before the
 * first modification so `uninstall.mjs` can restore it.
 *
 * @module dsh-transcode-tty/scripts/install
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPnpm, ok, resolveProfileDir, run, step, warn } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const BACKUP = 'package.json.dsh-transcode-tty.bak';

const profileDir = resolveProfileDir();

step(`Installing ${pkg.name}@${pkg.version}`);
console.log(`    repository ${repoRoot}`);
console.log(`    profile    ${profileDir}`);

if (!existsSync(join(profileDir, 'package.json'))) {
	console.error(
		`\nNo package.json in ${profileDir}.\n` +
			'Pass --profile-dir <path> pointing at a DSH profile directory, for example\n' +
			'  --profile-dir "%USERPROFILE%\\.dsh\\profiles\\desktop"',
	);
	process.exit(1);
}

// --- 1. plugin dependencies ---------------------------------------------
step('Installing the plugin dependencies');
if (existsSync(join(repoRoot, 'node_modules', '@deepseek-ai', 'schemastery'))) {
	ok('@deepseek-ai/schemastery already present');
} else {
	const installed = run(
		'npm',
		['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock'],
		repoRoot,
	);
	if (installed) {
		ok('@deepseek-ai/schemastery installed');
	} else {
		warn('npm install failed; the plugin still runs, but its settings form will not render');
	}
}

// --- 2. profile dependency ----------------------------------------------
step('Registering the package in the profile');
const profilePkgPath = join(profileDir, 'package.json');
const backupPath = join(profileDir, BACKUP);
if (!existsSync(backupPath)) {
	copyFileSync(profilePkgPath, backupPath);
	ok(`backed up package.json -> ${BACKUP}`);
}

const profilePkg = JSON.parse(readFileSync(profilePkgPath, 'utf8'));
profilePkg.dependencies ??= {};
profilePkg.dsh ??= {};
profilePkg.dsh.profile ??= {};
profilePkg.dsh.profile.bundles ??= [];

/*
 * `link:` keeps the profile pointing at this checkout, so editing the source and
 * restarting is enough to test a change. A published install would use a version
 * range instead, but a repository the user cloned is a working copy.
 */
const linkSpec = `link:${repoRoot.replace(/\\/g, '/')}`;
const dependencyChanged = profilePkg.dependencies[pkg.name] !== linkSpec;
profilePkg.dependencies[pkg.name] = linkSpec;

const bundleAdded = !profilePkg.dsh.profile.bundles.includes(pkg.name);
if (bundleAdded) profilePkg.dsh.profile.bundles.push(pkg.name);

writeFileSync(profilePkgPath, `${JSON.stringify(profilePkg, null, 2)}\n`);
ok(
	dependencyChanged
		? `dependency ${pkg.name} -> ${linkSpec}`
		: `dependency ${pkg.name} already registered`,
);
ok(
	bundleAdded
		? `bundle ${pkg.name} added to dsh.profile.bundles`
		: `bundle ${pkg.name} already listed`,
);

// --- 3. package manager -------------------------------------------------
step('Reconciling the profile');
const pnpm = findPnpm();
if (pnpm === null) {
	console.error(
		'\nCould not find pnpm, corepack, or npx.\n' +
			'Install pnpm (https://pnpm.io/installation) and re-run, or install the plugin\n' +
			'from the Harness plugin manager instead.',
	);
	process.exit(1);
}
if (!run(pnpm.command, [...pnpm.args, 'install'], profileDir)) {
	console.error('\nThe profile package manager failed. See its output above.');
	process.exit(1);
}
ok('profile reconciled');

// --- 4. verification ----------------------------------------------------
step('Verifying the bundle resolves');
const installedDir = join(profileDir, 'node_modules', pkg.name);
if (!existsSync(join(installedDir, 'index.js'))) {
	console.error(`\n${installedDir} does not contain index.js. The link was not created.`);
	process.exit(1);
}
ok(`${installedDir} -> ${repoRoot}`);

if (!existsSync(join(installedDir, 'cordis.patch.yml'))) {
	console.error(`\n${installedDir} has no cordis.patch.yml, so the Loader cannot insert the entry.`);
	process.exit(1);
}
ok('cordis.patch.yml present');

if (!existsSync(join(installedDir, 'node_modules', '@deepseek-ai', 'schemastery'))) {
	warn('the schema library is not reachable from the linked package; the settings form will be absent');
}

console.log(`
${pkg.name} is installed.

Next: restart DeepSeek Harness so the Loader picks up the new composition. The
plugin then appears in Settings -> Plugins, where every transform can be toggled.
Shell output is normalized automatically; nothing else is required.

Remove it again with:  node scripts/uninstall.mjs
`);

/**
 * Shared process and path helpers for the install scripts.
 *
 * @module dsh-transcode-tty/scripts/lib
 */

import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Whether this is a Windows host. */
export const isWindows = process.platform === 'win32';

/**
 * Read a `--flag value` pair from argv.
 * @param {string} flag - flag name without leading dashes.
 * @param {string} [fallback] - value returned when the flag is absent.
 * @returns {string | undefined} the value.
 */
export function arg(flag, fallback) {
	const index = process.argv.indexOf(`--${flag}`);
	if (index !== -1 && process.argv[index + 1] !== undefined) return process.argv[index + 1];
	return fallback;
}

/**
 * Locate the DSH profile directory.
 *
 * Resolution order mirrors the Harness: an explicit flag, then `DSH_PROFILE_DIR`
 * (which the app sets for child processes), then `~/.dsh/profiles/<profile>`.
 *
 * @returns {string} the absolute profile directory.
 */
export function resolveProfileDir() {
	const explicit = arg('profile-dir');
	if (explicit !== undefined) return resolve(explicit);
	const fromEnv = process.env.DSH_PROFILE_DIR;
	if (fromEnv !== undefined && fromEnv.length > 0) return resolve(fromEnv);
	const profile = arg('profile') ?? process.env.DSH_PROFILE ?? 'desktop';
	return join(homedir(), '.dsh', 'profiles', profile);
}

/**
 * Run a command, inheriting stdio so the user sees live progress.
 *
 * Windows cannot spawn a `.cmd` shim such as `npm.cmd` without a shell, and
 * `spawn` with `shell: true` *and* an argument array triggers DEP0190 because the
 * arguments are concatenated rather than escaped. Running the shim through
 * `cmd.exe /c` with an explicit argument array avoids both problems: the shell
 * is named as the program, and every argument stays a separate argv entry.
 *
 * @param {string} command - executable or `.cmd` shim.
 * @param {string[]} args - arguments.
 * @param {string} cwd - working directory.
 * @param {{ quiet?: boolean }} [options] - `quiet` discards output.
 * @returns {boolean} whether the command exited zero.
 */
export function run(command, args, cwd, options = {}) {
	const stdio = options.quiet === true ? 'ignore' : 'inherit';
	const result = isWindows
		? spawnSync('cmd.exe', ['/d', '/s', '/c', command, ...args], { cwd, stdio })
		: spawnSync(command, args, { cwd, stdio });
	return result.status === 0;
}

/**
 * Find a working pnpm invocation.
 *
 * The Harness manages profiles with pnpm, which a user may not have on PATH.
 * Corepack ships with Node and can provide it, and `npx` can always fetch it, so
 * each fallback is probed in turn.
 *
 * @returns {{ command: string, args: string[] } | null} a runnable invocation.
 */
export function findPnpm() {
	const candidates = [
		{ command: 'pnpm', args: [] },
		{ command: 'corepack', args: ['pnpm'] },
		{ command: 'npx', args: ['--yes', 'pnpm@11'] },
	];
	for (const candidate of candidates) {
		if (run(candidate.command, [...candidate.args, '--version'], process.cwd(), { quiet: true })) {
			return candidate;
		}
	}
	return null;
}

/**
 * Print one step heading.
 * @param {string} message - heading text.
 */
export const step = (message) => console.log(`\n==> ${message}`);

/**
 * Print a success line.
 * @param {string} message - detail text.
 */
export const ok = (message) => console.log(`    ok   ${message}`);

/**
 * Print a non-fatal warning.
 * @param {string} message - detail text.
 */
export const warn = (message) => console.log(`    warn ${message}`);

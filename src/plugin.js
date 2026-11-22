/**
 * The `tools/post-execute` listener.
 *
 * @module dsh-transcode-tty/plugin
 */

import { normalizeTerminalText } from './normalize.js';
import { resolveSettings } from './config.js';

/** Plugin name, reported by the Loader and by diagnostics. */
export const name = 'dsh-transcode-tty';

/**
 * Normalize one content-block list, returning `undefined` when nothing changed.
 *
 * Only `text` blocks are touched; images, attachments, and any future block type
 * pass through by reference so this plugin can never corrupt structured
 * content. Returning `undefined` rather than the original array is deliberate:
 * it lets the caller fall through to `next()` instead of replacing the result
 * with an identical copy.
 *
 * @param {readonly unknown[]} content - the tool result's content blocks.
 * @param {Record<string, unknown>} options - resolved transform options.
 * @returns {object[] | undefined} replacement blocks, or `undefined` when unchanged.
 */
export function normalizeContent(content, options) {
	if (!Array.isArray(content) || content.length === 0) return undefined;
	let changed = false;
	const blocks = content.map((block) => {
		if (block === null || typeof block !== 'object') return block;
		if (block.type !== 'text' || typeof block.text !== 'string') return block;
		if (block.text.length > options.maxTextLength) return block;
		const text = normalizeTerminalText(block.text, options);
		if (text === block.text) return block;
		changed = true;
		return { ...block, text };
	});
	return changed ? blocks : undefined;
}

/**
 * Register the post-execute normalization listener.
 *
 * The decision this returns is `{ kind: 'accept', content }` and nothing else.
 * The runtime merges an `accept` decision by spreading the original result and
 * replacing only the fields the decision carries, but it rejects a decision that
 * carries both `content` and `value` with a `TypeError`. Because `value` is left
 * out, the structured result (exit code, stdout/stderr, sandbox metadata) stays
 * intact for every downstream consumer, while the text the terminal card renders
 * is the normalized one.
 *
 * @param {object} ctx - the plugin context supplied by the runtime. It is typed
 *   structurally rather than through an import so this package keeps zero runtime
 *   dependency on Cordis: the context is passed in, never loaded.
 * @param {object} [config] - the validated row config.
 */
export function apply(ctx, config = {}) {
	const settings = resolveSettings(config);
	ctx.effect(() =>
		ctx.on('tools/post-execute', async (exec, result, next) => {
			if (!settings.enabled || !settings.tools.has(exec.name)) return next();
			const content = normalizeContent(result?.content, settings.options);
			if (content === undefined) return next();
			return { kind: 'accept', content };
		}),
	);
}

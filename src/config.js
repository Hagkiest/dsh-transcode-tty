/**
 * Plugin configuration: declared defaults, the runtime schema, and the merge
 * step that turns a raw Loader row config into the flat options object the
 * transforms expect.
 *
 * @module dsh-transcode-tty/config
 */

/**
 * Tools whose output is rendered as raw terminal text. `pwsh` and `bash` cover
 * foreground and background command results; `job_output` returns the streamed
 * output of a background job.
 * @type {readonly string[]}
 */
export const DEFAULT_TOOLS = Object.freeze(['pwsh', 'bash', 'job_output']);

/**
 * Declared defaults, mirrored by the schema below.
 *
 * They are applied explicitly at activation rather than relying on the schema,
 * for two reasons: a Loader row may omit `config` entirely, and the schema
 * library is an optional peer that may not resolve (see
 * {@link loadSchemaLibrary}). In both cases the plugin must still behave the
 * same way.
 * @type {Readonly<Record<string, unknown>>}
 */
export const DEFAULT_CONFIG = Object.freeze({
	enabled: true,
	tools: DEFAULT_TOOLS,
	stripAnsi: true,
	collapseCarriageReturns: true,
	repairMojibake: true,
	repairUtf8AsGbk: true,
	repairUtf8AsLatin1: true,
	repairGbkAsLatin1: true,
	stripControlChars: true,
	normalizeSpaces: true,
	foldFullwidth: false,
	collapseReplacementRuns: false,
	trimTrailingWhitespace: false,
	maxTextLength: 262144,
});

/**
 * Resolve the schema library, tolerating its absence.
 *
 * `@deepseek-ai/schemastery` is declared as a real dependency, so a normal
 * `npm install` inside this package makes the import resolve. It is still
 * loaded defensively because a bundle is commonly installed as a *link* into a
 * Harness profile: the runtime then resolves this package's imports from the
 * repository, and a user who skipped the dependency step would otherwise lose
 * the whole plugin to a load-time `ERR_MODULE_NOT_FOUND`. Without the library
 * `Config` is `undefined`, the settings form is simply not rendered, and every
 * transform still runs on the defaults above.
 *
 * @returns {Promise<unknown>} the library's default export, or `undefined`.
 */
async function loadSchemaLibrary() {
	try {
		const mod = await import('@deepseek-ai/schemastery');
		return mod.default ?? mod;
	} catch {
		return undefined;
	}
}

const z = await loadSchemaLibrary();

/**
 * Runtime configuration schema, or `undefined` when the library is unavailable.
 *
 * Field descriptions are user-facing: the Harness settings form renders them as
 * help text, so they explain the trade-off rather than restating the name.
 */
export const Config = z === undefined
	? undefined
	: z.object({
			enabled: z
				.boolean()
				.default(true)
				.description('Normalize terminal output at all. Turning this off disables every transform.'),
			tools: z
				.array(z.string())
				.default([...DEFAULT_TOOLS])
				.description(
					'Tool names whose text output is normalized. Results from any other tool pass through untouched.',
				),
			stripAnsi: z
				.boolean()
				.default(true)
				.description(
					'Remove ANSI/VT escape sequences instead of showing them as literal text such as ESC[1;31m.',
				),
			collapseCarriageReturns: z
				.boolean()
				.default(true)
				.description(
					'Reduce each line to the segment a terminal would leave visible after carriage returns, which removes spinner frames and progress-bar redraws.',
				),
			repairMojibake: z
				.boolean()
				.default(true)
				.description('Undo common encoding mis-decodes such as UTF-8 bytes read as GBK.'),
			repairUtf8AsGbk: z
				.boolean()
				.default(true)
				.description(
					'Repair UTF-8 text that was decoded as GBK. This is the usual CP936 console mojibake.',
				),
			repairUtf8AsLatin1: z
				.boolean()
				.default(true)
				.description('Repair UTF-8 text that was decoded as ISO-8859-1.'),
			repairGbkAsLatin1: z
				.boolean()
				.default(true)
				.description('Repair GBK bytes that were decoded as ISO-8859-1.'),
			stripControlChars: z
				.boolean()
				.default(true)
				.description(
					'Remove control, zero-width, and bidirectional formatting characters that break alignment or corrupt copied text.',
				),
			normalizeSpaces: z
				.boolean()
				.default(true)
				.description(
					'Replace no-break, en/em, and ideographic spaces with a plain space so columns line up.',
				),
			foldFullwidth: z
				.boolean()
				.default(false)
				.description(
					'Fold fullwidth ASCII forms to plain ASCII. Off by default because it can change intended CJK layout.',
				),
			collapseReplacementRuns: z
				.boolean()
				.default(false)
				.description('Collapse runs of U+FFFD into a single marker. Off by default; hides detail.'),
			trimTrailingWhitespace: z
				.boolean()
				.default(false)
				.description('Strip trailing spaces and tabs from every line. Off by default; hides detail.'),
			maxTextLength: z
				.number()
				.default(262144)
				.description(
					'Skip normalization for a text block longer than this many characters, to bound per-result cost.',
				),
	  });

/**
 * Merge a raw row config over the declared defaults.
 *
 * Only `true` enables an opt-in transform and only `false` disables an opt-out
 * one, so a stray non-boolean in a hand-written patch file cannot silently flip
 * behavior in the surprising direction.
 *
 * @param {object | undefined} config - raw Loader row config.
 * @returns {{ enabled: boolean, tools: Set<string>, options: Record<string, unknown> }} resolved settings.
 */
export function resolveSettings(config) {
	const merged = { ...DEFAULT_CONFIG, ...(config ?? {}) };
	const tools = Array.isArray(merged.tools) ? merged.tools : DEFAULT_TOOLS;
	const maxTextLength =
		typeof merged.maxTextLength === 'number' && merged.maxTextLength > 0
			? merged.maxTextLength
			: DEFAULT_CONFIG.maxTextLength;
	return {
		enabled: merged.enabled !== false,
		tools: new Set(tools.map((tool) => String(tool))),
		options: {
			stripAnsi: merged.stripAnsi !== false,
			collapseCarriageReturns: merged.collapseCarriageReturns !== false,
			repairMojibake: merged.repairMojibake !== false,
			repairUtf8AsGbk: merged.repairUtf8AsGbk !== false,
			repairUtf8AsLatin1: merged.repairUtf8AsLatin1 !== false,
			repairGbkAsLatin1: merged.repairGbkAsLatin1 !== false,
			stripControlChars: merged.stripControlChars !== false,
			normalizeSpaces: merged.normalizeSpaces !== false,
			foldFullwidth: merged.foldFullwidth === true,
			collapseReplacementRuns: merged.collapseReplacementRuns === true,
			trimTrailingWhitespace: merged.trimTrailingWhitespace === true,
			maxTextLength,
		},
	};
}

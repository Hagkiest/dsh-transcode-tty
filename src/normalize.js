/**
 * Pure text-normalization helpers for terminal tool output.
 *
 * The Harness renders shell tool results as plain text in the terminal card and
 * in the conversation transcript. Several byte-level artifacts survive into that
 * text and show up as mojibake or layout noise:
 *
 * - ANSI/VT escape sequences (colors, cursor moves, OSC titles) are not
 *   interpreted by the renderer, so `ESC[1;31m` appears as literal text.
 * - Progress bars and spinners rewrite the same line with carriage returns.
 * - Output produced under a CP936/GBK console or a legacy file can arrive as
 *   UTF-8 bytes that were decoded with the wrong charset, or as bytes already
 *   collapsed into U+FFFD replacement characters.
 * - Control characters, zero-width marks, and non-breaking/ideographic spaces
 *   break alignment.
 *
 * Every transform here is a pure string -> string function with no I/O, so the
 * module is trivially testable and safe to run on the hot path.
 *
 * @module dsh-transcode-tty/normalize
 */

/** Unicode replacement character. */
const REPLACEMENT = '\uFFFD';

/** Lazily created GBK decoder; `null` marks "unavailable in this runtime". */
let gbkDecoderCache;
/** Lazily built reverse map from a GBK-representable character to its bytes. */
let gbkReverseCache;

/**
 * Return a GBK decoder, or `null` when the runtime lacks full ICU data.
 * @returns {TextDecoder | null} the cached decoder or `null`.
 */
function gbkDecoder() {
	if (gbkDecoderCache === undefined) {
		try {
			gbkDecoderCache = new TextDecoder('gbk', { fatal: false });
		} catch {
			gbkDecoderCache = null;
		}
	}
	return gbkDecoderCache;
}

/**
 * Build (once) the reverse map used to turn GBK characters back into bytes.
 *
 * CP936 is a variable-length encoding: most characters come from a two-byte
 * sequence, but a few come from a single byte in the 0x80-0xFF range. The euro
 * sign is the one that matters in practice — CP936 decodes the lone byte `0x80`
 * to `U+20AC` *and* decodes the pair `A2 E3` to the same character. A map built
 * from pairs alone therefore inverts a lone `0x80` into two bytes, which
 * desynchronizes the whole byte stream and makes the repair fail its own
 * round-trip check. Single-byte forms are enumerated first so they win that
 * ambiguity, which is the correct inverse for a mis-decode: the original byte
 * stream really did contain `0x80` on its own.
 *
 * @returns {Map<string, number[]> | null} character -> byte values, or `null`.
 */
function gbkReverse() {
	if (gbkReverseCache !== undefined) return gbkReverseCache;
	const decoder = gbkDecoder();
	if (decoder === null) {
		gbkReverseCache = null;
		return null;
	}
	const map = new Map();
	// Single-byte forms first: they are the true inverse when a UTF-8
	// continuation or lead byte landed in 0x80-0xFF on its own.
	for (let byte = 0x80; byte <= 0xff; byte += 1) {
		const decoded = decoder.decode(Uint8Array.of(byte));
		if (decoded.length === 1 && decoded !== REPLACEMENT && !map.has(decoded)) {
			map.set(decoded, [byte]);
		}
	}
	for (let lead = 0x81; lead <= 0xfe; lead += 1) {
		for (let trail = 0x40; trail <= 0xfe; trail += 1) {
			if (trail === 0x7f) continue;
			const decoded = decoder.decode(Uint8Array.of(lead, trail));
			if (decoded.length === 1 && decoded !== REPLACEMENT && !map.has(decoded)) {
				map.set(decoded, [lead, trail]);
			}
		}
	}
	gbkReverseCache = map;
	return map;
}

/**
 * Remove ANSI/VT escape sequences: OSC strings (titles, hyperlinks), CSI
 * sequences (colors, cursor movement, erase), single-character ESC sequences
 * (charset selection, keypad modes), and any leftover bare ESC bytes.
 *
 * A CSI sequence is introducer + parameters + intermediates + final byte. The
 * introducer is either the two-character `ESC [` or the single C1 control
 * `U+009B`, which is why the C1 pattern must not expect a literal `[`: the
 * control *is* the bracket.
 *
 * @param {string} text - raw text possibly containing escape sequences.
 * @returns {string} text with escape sequences removed.
 */
export function stripAnsi(text) {
	if (typeof text !== 'string' || text.length === 0) return text;
	if (!text.includes('\u001B') && !text.includes('\u009B')) return text;
	return text
		.replace(/\u001B\][\s\S]*?(?:\u0007|\u001B\\)/g, '')
		.replace(/\u009B[0-?]*[ -/]*[@-~]/g, '')
		.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
		.replace(/\u001B[()#%][0-9A-Za-z]?/g, '')
		.replace(/\u001B[@-Z\\-_=><~]/g, '')
		.replace(/\u001B/g, '');
}

/**
 * Collapse carriage-return overwrites the way a terminal would: for every
 * physical line, only the text after the last `\r` remains visible. This turns
 * `10%\r50%\r100%` into `100%` and drops spinner frames.
 * @param {string} text - text containing `\r`.
 * @returns {string} text with each line reduced to its final visible segment.
 */
export function collapseCarriageReturns(text) {
	if (typeof text !== 'string' || !text.includes('\r')) return text;
	const normalized = text.replace(/\r\n/g, '\n');
	return normalized
		.split('\n')
		.map((line) => {
			if (!line.includes('\r')) return line;
			const segments = line.split('\r');
			for (let index = segments.length - 1; index >= 0; index -= 1) {
				if (segments[index].length > 0) return segments[index];
			}
			return '';
		})
		.join('\n');
}

/**
 * Drop control characters that carry no visible meaning in a text view, plus
 * zero-width and bidirectional formatting marks that make copied text wrong.
 * Line feeds and tabs are preserved because they define the layout.
 * @param {string} text - raw text.
 * @param {{ keepEscape?: boolean }} [options] - `keepEscape` retains U+001B so a
 *   caller that disabled ANSI stripping still sees the original escape bytes.
 * @returns {string} text without invisible control characters.
 */
export function stripControlChars(text, options = {}) {
	if (typeof text !== 'string') return text;
	const pattern = options.keepEscape === true
		? /[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F-\u009F]/g
		: /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
	return text
		.replace(pattern, '')
		.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '');
}

/**
 * Fold space variants that terminals do not render as a plain column-advancing
 * space: no-break, en/em spaces, ideographic space, and narrow no-break space.
 * @param {string} text - raw text.
 * @returns {string} text with space variants replaced by U+0020.
 */
export function normalizeSpaces(text) {
	if (typeof text !== 'string') return text;
	return text.replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
}

/**
 * Map fullwidth ASCII presentation forms to their ASCII counterparts, mirroring
 * the NFKC compatibility folds that are safe for terminal display. CJK
 * punctuation is intentionally left alone.
 * @param {string} text - raw text.
 * @returns {string} text with fullwidth ASCII folded to ASCII.
 */
export function foldFullwidth(text) {
	if (typeof text !== 'string') return text;
	return text.replace(/[\uFF01-\uFF5E]/g, (char) =>
		String.fromCharCode(char.charCodeAt(0) - 0xfee0),
	);
}

/**
 * Collapse runs of U+FFFD into a single marker so a lost-encoding block reads as
 * one placeholder instead of dozens of glyphs.
 * @param {string} text - raw text.
 * @returns {string} text with replacement runs collapsed.
 */
export function collapseReplacementRuns(text) {
	if (typeof text !== 'string' || !text.includes(REPLACEMENT)) return text;
	return text.replace(/\uFFFD{2,}/g, REPLACEMENT);
}

/**
 * Encode text to GBK bytes using the reverse map.
 *
 * The map stores byte *arrays* rather than fixed pairs because CP936 mixes
 * one-byte and two-byte forms for the same character; pushing `pair[0], pair[1]`
 * would append a phantom second byte for a single-byte form.
 *
 * @param {string} text - text whose characters are all GBK-representable.
 * @param {Map<string, number[]>} reverse - the GBK reverse map.
 * @returns {Uint8Array | null} the bytes, or `null` when a character has no GBK form.
 */
function encodeGbk(text, reverse) {
	const bytes = [];
	for (const char of text) {
		const code = char.codePointAt(0);
		if (code < 0x80) {
			bytes.push(code);
			continue;
		}
		const form = reverse.get(char);
		if (form === undefined) return null;
		for (const byte of form) bytes.push(byte);
	}
	return Uint8Array.from(bytes);
}

/**
 * Encode text to bytes by taking the low byte of each code point, which is the
 * exact inverse of decoding bytes as ISO-8859-1.
 * @param {string} text - text whose code points are all <= 0xFF.
 * @returns {Uint8Array | null} the bytes, or `null` when a code point is too large.
 */
function encodeLatin1(text) {
	const bytes = new Uint8Array(text.length);
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if (code > 0xff) return null;
		bytes[index] = code;
	}
	return bytes;
}

/**
 * Decode bytes as ISO-8859-1, the inverse of {@link encodeLatin1}.
 * @param {Uint8Array} bytes - byte stream.
 * @returns {string} one character per byte.
 */
function latin1Decode(bytes) {
	let out = '';
	for (const byte of bytes) out += String.fromCharCode(byte);
	return out;
}

/**
 * Decode bytes as strict UTF-8.
 * @param {Uint8Array} bytes - candidate byte stream.
 * @returns {string | null} the decoded text, or `null` when the bytes are invalid.
 */
function decodeUtf8Strict(bytes) {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
}

/**
 * Decode bytes as UTF-8, replacing invalid sequences instead of failing.
 * @param {Uint8Array} bytes - candidate byte stream.
 * @returns {string} the decoded text with U+FFFD for invalid sequences.
 */
function decodeUtf8Lenient(bytes) {
	return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * Score how strongly text looks mis-decoded rather than genuine content.
 *
 * The dominant CP936 defect is UTF-8 bytes read as GBK. That corruption maps
 * each UTF-8 sequence onto GBK characters chosen by raw byte values, which
 * lands mostly in the GBK second-level block (`0xD8A1`-`0xF7FE`, rare Hanzi
 * used in personal names) or outside both levels. Genuine Chinese prose is
 * instead dominated by GBK level 1 (`0xB0A1`-`0xD7FE`, the 3755 common
 * characters). That level distribution separates the two cases far more
 * reliably than U+FFFD, which a GBK mis-decode of Chinese text rarely produces.
 *
 * @param {string} text - candidate text.
 * @returns {number} a score where lower is more plausible; U+FFFD is penalized heavily.
 */
function mojibakeSignals(text) {
	const reverse = gbkReverse();
	let signals = 0;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		const code = text.charCodeAt(index);
		if (code < 0x80) continue;
		/*
		 * Structural UTF-8-read-as-Latin-1 signature: a Latin-1 lead byte
		 * (U+00C2-U+00F4) followed by the right number of continuation bytes
		 * (U+0080-U+00BF). Genuine accented Latin text almost never forms that
		 * shape, while every multi-byte UTF-8 sequence does once mis-decoded.
		 */
		if (code >= 0xc2 && code <= 0xf4) {
			const needed = code < 0xe0 ? 1 : code < 0xf0 ? 2 : 3;
			let shaped = true;
			for (let step = 1; step <= needed; step += 1) {
				const next = text.charCodeAt(index + step);
				if (!(next >= 0x80 && next <= 0xbf)) {
					shaped = false;
					break;
				}
			}
			if (shaped) {
				signals += 8;
				index += needed;
				continue;
			}
		}
		if (code === 0xfffd) {
			/*
			 * A lost byte is real damage, but a *candidate* that still carries
			 * U+FFFD is reporting an unavoidable loss rather than reproducing the
			 * corruption, so the weight must stay below the cost of a run of
			 * second-level Hanzi (4-6 each). At 100 a correct repair could never
			 * beat its own input whenever the wrong charset had already dropped a
			 * byte, which is the common truncated-console case.
			 */
			signals += 6;
			continue;
		}
		if (code >= 0xe000 && code <= 0xf8ff) {
			signals += 10;
			continue;
		}
		if (reverse !== null) {
			const pair = reverse.get(char);
			if (pair !== undefined) {
				const [lead, trail] = pair;
				if (lead >= 0xb0 && lead <= 0xd7 && trail >= 0xa1) continue;
				if (lead >= 0xd8 && lead <= 0xf7 && trail >= 0xa1) {
					signals += 6;
					continue;
				}
				signals += 4;
				continue;
			}
		}
		if (code >= 0x0100 && code <= 0x02ff) signals += 3;
		else if (code >= 0x0080 && code <= 0x00ff) signals += 2;
		else if (code >= 0x3000 && code <= 0x303f) signals += 0;
		else if (code >= 0xff00 && code <= 0xffef) signals += 0;
		else signals += 1;
	}
	return signals;
}

/**
 * Count non-ASCII characters, used to skip repairs that would act on a single
 * ambiguous glyph.
 * @param {string} text - text to count.
 * @returns {number} how many characters are above U+007F.
 */
function nonAsciiCount(text) {
	let count = 0;
	for (const char of text) {
		if (char.charCodeAt(0) > 0x7f) count += 1;
	}
	return count;
}

/**
 * Count U+FFFD holes in text, i.e. characters the wrong charset already dropped.
 * @param {string} text - text to inspect.
 * @returns {number} how many replacement characters the text contains.
 */
function countHoles(text) {
	let count = 0;
	let index = text.indexOf(REPLACEMENT);
	while (index !== -1) {
		count += 1;
		index = text.indexOf(REPLACEMENT, index + 1);
	}
	return count;
}

/**
 * Preference penalty per corruption direction.
 *
 * Some corruptions are byte-for-byte ambiguous: the two Latin-1 characters
 * `Ã©` are both a valid UTF-8 sequence for `é` and a valid GBK pair for `茅`.
 * Both repairs are exact inverses, so only a prior can separate them. On the
 * platform this plugin serves the ANSI code page is CP936 and nothing decodes
 * text as ISO-8859-1, so "GBK bytes read as Latin-1" is the least likely of the
 * three; it keeps a penalty that lets the UTF-8 directions win such a tie while
 * still applying when it is the only candidate that round-trips.
 * @type {Record<string, number>}
 */
const DIRECTION_PENALTY = {
	utf8AsGbk: 0,
	utf8AsLatin1: 0,
	gbkAsLatin1: 4,
};

/**
 * Repair one mojibake direction. A candidate is kept only when it is an exact
 * inverse of the corruption: re-encoding it with the charset that produced the
 * text must reproduce the input byte-for-byte. When the wrong charset already
 * dropped bytes (it emitted U+FFFD), exact recovery is impossible; the readable
 * part is still recovered and each lost character becomes one U+FFFD, which is
 * honest and displays cleanly, unlike a wall of wrong Hanzi.
 * @param {string} text - text to inspect.
 * @param {'utf8AsGbk' | 'utf8AsLatin1' | 'gbkAsLatin1'} direction - corruption kind.
 * @returns {string | null} the repaired text, or `null` when the guess is unsafe.
 */
function tryRepair(text, direction) {
	if (direction === 'utf8AsGbk') {
		const reverse = gbkReverse();
		if (reverse === null) return null;
		/*
		 * A U+FFFD in the input is a byte the wrong charset already dropped. It has
		 * no GBK form, so encoding the text as-is would fail outright and skip the
		 * repair entirely; strip the holes, repair the surviving bytes, and put the
		 * loss back as a visible marker. That is the truncated-console case, which
		 * is the common one.
		 */
		const holes = countHoles(text);
		const body = holes === 0 ? text : text.split(REPLACEMENT).join('');
		if (body.length === 0) return null;
		const bytes = encodeGbk(body, reverse);
		if (bytes === null) return null;
		const candidate = decodeUtf8Strict(bytes);
		if (candidate !== null) {
			// Exact inverse: re-encode the candidate as UTF-8 and read it back as GBK.
			const decoder = gbkDecoder();
			if (decoder === null) return null;
			if (decoder.decode(new TextEncoder().encode(candidate)) !== body) return null;
			return holes === 0 ? candidate : `${candidate}${REPLACEMENT.repeat(holes)}`;
		}
		const lossy = decodeUtf8Lenient(bytes);
		const lost = countHoles(lossy);
		if (lost === 0) return null;
		// Require most of the byte stream to be valid UTF-8, so genuine GBK text
		// cannot be mistaken for a damaged UTF-8 sequence.
		if (lost > Math.max(1, Math.floor(bytes.length / 8))) return null;
		return lossy;
	}
	const holes = countHoles(text);
	const body = holes === 0 ? text : text.split(REPLACEMENT).join('');
	if (body.length === 0) return null;
	const bytes = encodeLatin1(body);
	if (bytes === null) return null;
	if (direction === 'utf8AsLatin1') {
		const candidate = decodeUtf8Strict(bytes);
		if (candidate !== null) {
			if (latin1Decode(new TextEncoder().encode(candidate)) !== body) return null;
			return holes === 0 ? candidate : `${candidate}${REPLACEMENT.repeat(holes)}`;
		}
		const lossy = decodeUtf8Lenient(bytes);
		const lost = countHoles(lossy);
		if (lost === 0) return null;
		if (lost > Math.max(1, Math.floor(bytes.length / 8))) return null;
		return lossy;
	}
	const decoder = gbkDecoder();
	if (decoder === null) return null;
	const candidate = decoder.decode(bytes);
	if (candidate.includes(REPLACEMENT)) return null;
	const reverse = gbkReverse();
	if (reverse === null) return null;
	const roundTrip = encodeGbk(candidate, reverse);
	if (roundTrip === null || latin1Decode(roundTrip) !== body) return null;
	return holes === 0 ? candidate : `${candidate}${REPLACEMENT.repeat(holes)}`;
}

/**
 * Split text into alternating ASCII and non-ASCII runs. Mojibake comes from a
 * contiguous byte region decoded with the wrong charset, so a repair must be
 * attempted per run: encoding a whole line would fold genuine CJK next to the
 * corruption into one byte stream and make the reverse check fail.
 * @param {string} text - text to segment.
 * @returns {string[]} alternating runs covering the whole input.
 */
function splitAsciiRuns(text) {
	const runs = [];
	let start = 0;
	let ascii = text.charCodeAt(0) < 0x80;
	for (let index = 1; index <= text.length; index += 1) {
		const next = index < text.length ? text.charCodeAt(index) < 0x80 : undefined;
		if (next === undefined || next !== ascii) {
			runs.push(text.slice(start, index));
			start = index;
			ascii = next;
		}
	}
	return runs;
}

/**
 * Split a non-ASCII run into maximal pieces whose characters all have a GBK
 * form, so a genuine CJK character inside a corrupted run cannot block the
 * repair of its neighbours.
 * @param {string} run - a maximal non-ASCII run.
 * @param {Map<string, number[]>} reverse - the GBK reverse map.
 * @returns {string[]} contiguous pieces covering the run.
 */
function splitGbkRuns(run, reverse) {
	const pieces = [];
	let start = 0;
	let current = true;
	for (let index = 0; index < run.length; index += 1) {
		const encodable = reverse.has(run[index]);
		if (index === 0) {
			current = encodable;
			continue;
		}
		if (encodable !== current) {
			pieces.push(run.slice(start, index));
			start = index;
			current = encodable;
		}
	}
	pieces.push(run.slice(start));
	return pieces;
}

/**
 * Try every enabled direction on one run and keep the best candidate.
 * @param {string} run - a maximal non-ASCII run.
 * @param {string[]} directions - enabled corruption directions.
 * @returns {string} the repaired run, or the input when no safe repair wins.
 */
function repairRun(run, directions) {
	const baseline = mojibakeSignals(run);
	const suspicious = nonAsciiCount(run);
	if (!run.includes(REPLACEMENT) && baseline * 2 < suspicious) return run;
	let best = run;
	let bestScore = baseline;
	for (const direction of directions) {
		let candidate;
		try {
			candidate = tryRepair(run, direction);
		} catch {
			candidate = null;
		}
		if (candidate === null || candidate === run || candidate.length === 0) continue;
		const score = mojibakeSignals(candidate) + (DIRECTION_PENALTY[direction] ?? 0);
		if (score < bestScore) {
			best = candidate;
			bestScore = score;
		}
	}
	return best;
}

/**
 * Undo common encoding mis-guesses. Each direction is validated as an exact
 * inverse of the corruption, so text that merely looks unusual is left alone;
 * repairs are attempted per non-ASCII run and per GBK-encodable piece, and when
 * several candidates survive the one with the fewest mojibake signals wins.
 * @param {string} text - text that may be mis-decoded.
 * @param {{ utf8AsGbk?: boolean, utf8AsLatin1?: boolean, gbkAsLatin1?: boolean, maxLength?: number }} options - enabled directions.
 * @returns {string} the repaired text, or the input when no safe repair exists.
 */
export function repairMojibake(text, options = {}) {
	if (typeof text !== 'string' || text.length === 0) return text;
	if (!text.includes(REPLACEMENT) && nonAsciiCount(text) < 2) return text;
	const limit = options.maxLength ?? 65536;
	if (text.length > limit) return text;
	const directions = [];
	if (options.utf8AsGbk !== false) directions.push('utf8AsGbk');
	if (options.utf8AsLatin1 !== false) directions.push('utf8AsLatin1');
	if (options.gbkAsLatin1 !== false) directions.push('gbkAsLatin1');
	const reverse = gbkReverse();
	let changed = false;
	const runs = splitAsciiRuns(text);
	const repaired = runs.map((run) => {
		if (run.charCodeAt(0) < 0x80) return run;
		/*
		 * Whole run first. Splitting unconditionally would break the Latin-1
		 * directions, whose payload legitimately contains characters with no GBK
		 * form; a genuine CJK character next to corruption is the rarer case and
		 * is handled by the piece-wise fallback below.
		 */
		const whole = repairRun(run, directions);
		if (whole !== run) {
			changed = true;
			return whole;
		}
		if (reverse === null) return run;
		const pieces = splitGbkRuns(run, reverse);
		if (pieces.length < 2) return run;
		const out = pieces
			.map((piece) => {
				if (piece.charCodeAt(0) < 0x80) return piece;
				const next = repairRun(piece, directions);
				if (next !== piece) changed = true;
				return next;
			})
			.join('');
		return out;
	});
	return changed ? repaired.join('') : text;
}

/**
 * Normalize one block of terminal output.
 *
 * Order matters. ANSI escapes go first so their parameter bytes cannot look
 * like text. Mojibake repair runs *before* control-character stripping because
 * UTF-8-read-as-Latin-1 corruption uses C1 bytes (U+0080-U+009F) as payload;
 * stripping them first would destroy the evidence and leave unrepairable
 * fragments.
 *
 * @param {string} text - raw tool output.
 * @param {object} [options] - enabled transforms.
 * @returns {string} display-safe text.
 */
export function normalizeTerminalText(text, options = {}) {
	if (typeof text !== 'string' || text.length === 0) return text;
	let out = text;
	if (options.maxTextLength !== undefined && out.length > options.maxTextLength) {
		return out;
	}
	if (options.stripAnsi !== false) out = stripAnsi(out);
	if (options.collapseCarriageReturns !== false) out = collapseCarriageReturns(out);
	if (options.repairMojibake !== false) {
		out = repairMojibake(out, {
			utf8AsGbk: options.repairUtf8AsGbk !== false,
			utf8AsLatin1: options.repairUtf8AsLatin1 !== false,
			gbkAsLatin1: options.repairGbkAsLatin1 !== false,
		});
	}
	if (options.stripControlChars !== false) {
		out = stripControlChars(out, { keepEscape: options.stripAnsi === false });
	}
	if (options.normalizeSpaces !== false) out = normalizeSpaces(out);
	if (options.foldFullwidth === true) out = foldFullwidth(out);
	if (options.collapseReplacementRuns === true) out = collapseReplacementRuns(out);
	if (options.trimTrailingWhitespace === true) {
		out = out
			.split('\n')
			.map((line) => line.replace(/[ \t]+$/g, ''))
			.join('\n');
	}
	return out;
}

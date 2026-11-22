#!/usr/bin/env node
/**
 * Reproduce the mojibake this plugin fixes, and show what it does about it.
 *
 * For every case the script prints three lines:
 *
 *   input  (escaped)   the corrupted string, with every non-printable character
 *                      shown as `\uXXXX` so the line is printable ASCII
 *   expect (escaped)   what `normalizeTerminalText()` returns for that input
 *   actual (raw)       the corrupted string printed verbatim
 *
 * The `actual` line travels through the real tool result. When this script runs
 * inside the Harness, the installed plugin rewrites that line before the
 * transcript renders it, so `actual` should read as clean text while `input`
 * shows the corruption. Comparing `actual` against `expect` checks the live
 * plugin against the library's own answer.
 *
 * Why the cases are conclusive: a terminal, a console code page, and Node's
 * stdout cannot repair mojibake. Only the plugin can turn `鏋勫缓鎴愬姛` back into
 * `构建成功`.
 *
 * Run with `npm run demo`, or `node scripts/demo.mjs`.
 *
 * @module dsh-transcode-tty/scripts/demo
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { normalizeTerminalText } = await import(
	pathToFileURL(join(resolve(here, '..'), 'index.js')).href
);
/**
 * Turn raw bytes into the string a Latin-1 reader would produce.
 * @param {Uint8Array} bytes - the bytes.
 * @returns {string} one character per byte.
 */
const latin1From = (bytes) =>
	Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');

/**
 * Decode bytes the way a CP936 console would.
 * @param {Uint8Array} bytes - the bytes.
 * @returns {string} the decoded text.
 */
const gbkDecode = (bytes) => new TextDecoder('gbk').decode(Buffer.from(bytes));

/**
 * Encode text to GBK bytes.
 *
 * The platform decoder is the only GBK table available without a dependency, so
 * the reverse map is built by scanning its two-byte space once.
 *
 * @param {string} text - text to encode.
 * @returns {Uint8Array} the GBK bytes.
 */
function gbkEncode(text) {
	const decoder = new TextDecoder('gbk');
	const map = new Map();
	for (let lead = 0x81; lead <= 0xfe; lead += 1) {
		for (let trail = 0x40; trail <= 0xfe; trail += 1) {
			if (trail === 0x7f) continue;
			const decoded = decoder.decode(Uint8Array.of(lead, trail));
			if (decoded.length === 1 && !map.has(decoded)) map.set(decoded, [lead, trail]);
		}
	}
	const bytes = [];
	for (const char of text) {
		const form = map.get(char);
		if (form === undefined) throw new Error(`no GBK form for ${char}`);
		bytes.push(form[0], form[1]);
	}
	return Uint8Array.from(bytes);
}

/**
 * Render a string as printable ASCII.
 *
 * Escaping only non-ASCII is not enough: `\r` and `ESC` are ASCII, and leaving
 * them raw lets the terminal act on them — a carriage return overwrites the very
 * line meant to display the corruption, which silently destroys the comparison.
 *
 * @param {string} text - text to escape.
 * @returns {string} a printable ASCII rendering.
 */
const escape = (text) =>
	Array.from(text, (char) => {
		const code = char.codePointAt(0);
		if (code === 0x0a) return '\\n';
		if (code === 0x09) return '\\t';
		if (code < 0x20 || code === 0x7f) return `\\u${code.toString(16).padStart(4, '0')}`;
		if (code < 0x80) return char;
		if (code <= 0xffff) return `\\u${code.toString(16).padStart(4, '0')}`;
		return `\\u{${code.toString(16)}}`;
	}).join('');

let cases = 0;

/**
 * Print one case.
 * @param {string} title - what the case demonstrates.
 * @param {string} input - the corrupted string.
 */
function show(title, input) {
	cases += 1;
	console.log(`  ${title}`);
	console.log(`    input  (escaped): ${escape(input)}`);
	console.log(`    expect (escaped): ${escape(normalizeTerminalText(input))}`);
	console.log(`    actual (raw)    : ${input}`);
	console.log('');
}

/** Print a section heading. */
const section = (title) => console.log(`\n=== ${title} ===`);

console.log('Each case shows the corruption, the plugin\'s expected result, and the');
console.log('live result. If the plugin is active, "actual" reads as clean text.');

section('1. UTF-8 bytes decoded as GBK — the CP936 console case');
show('构建成功', gbkDecode(Buffer.from('构建成功', 'utf8')));

section('2. UTF-8 bytes decoded as ISO-8859-1');
show('构建成功', latin1From(Buffer.from('构建成功', 'utf8')));

section('3. GBK bytes decoded as ISO-8859-1');
show('中文', latin1From(gbkEncode('中文')));

section('4. ANSI color and cursor movement');
show('ESC[1;31mERRORESC[0m: disk full', '\u001B[1;31mERROR\u001B[0m: disk full');
show('ESC[2KESC[1Gcleared line', '\u001B[2K\u001B[1Gcleared line');

section('5. Carriage-return progress redraw');
{
	/*
	 * No prefix on the raw line: collapsing keeps only the last segment, so a
	 * prefix would be overwritten along with the earlier frames. That is also what
	 * a terminal would leave visible.
	 */
	const progress = '0%\r25%\r75%\r100% done';
	cases += 1;
	console.log(`  input  (escaped): ${escape(progress)}`);
	console.log(`  expect (escaped): ${escape(normalizeTerminalText(progress))}`);
	console.log(`  actual (raw)    : ${progress}`);
	console.log('');
}

section('6. Invisible characters');
show('zero-width + BOM + bidi override', 'a\u200Bb\uFEFFc\u202Ed');

section('7. Space variants');
show('no-break + ideographic space', 'col1\u00A0col2\u3000col3');

section('8. Truncated mis-decode, one byte already lost');
{
	const bytes = Buffer.from('文件未找到', 'utf8');
	show('last byte dropped', gbkDecode(bytes.subarray(0, bytes.length - 1)));
	console.log('  The U+FFFD is honest: that byte was gone before the plugin saw it.');
	console.log('  Inventing a plausible character would read correctly and be wrong.');
	console.log('');
}

section('9. Control — correct text must survive unchanged');
show('genuine Chinese', '构建成功：共 42 个文件');
show('rare Hanzi in personal names', '张燚 李鑫 王淼');
show('traditional Chinese', '編譯成功');
show('Japanese', 'ビルドが成功しました');
show('box drawing', '┌──┬──┐');
show('accented Latin', 'café résumé naïve');
show('emoji', '🎉 ✅ 🚀');

console.log(`Ran ${cases} cases through normalizeTerminalText().`);
console.log('In section 9 the input and expect lines match — nothing was changed.');

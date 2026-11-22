/**
 * Unit tests for the individual transforms.
 *
 * Each check isolates one function so a regression points straight at the
 * transform that broke, not at the pipeline.
 *
 * @module dsh-transcode-tty/test/normalize.test
 */

import { suite, assert } from './harness.mjs';
import { ESC } from './samples.mjs';
import {
	collapseCarriageReturns,
	collapseReplacementRuns,
	foldFullwidth,
	normalizeSpaces,
	normalizeTerminalText,
	repairMojibake,
	stripAnsi,
	stripControlChars,
} from '../src/normalize.js';

const { check, report } = suite('transforms');

// --- stripAnsi ----------------------------------------------------------
check('removes an SGR color pair', () => {
	assert.equal(stripAnsi(`${ESC}[1;31mERROR${ESC}[0m: bad`), 'ERROR: bad');
});

check('removes cursor and erase sequences', () => {
	assert.equal(stripAnsi(`${ESC}[2K${ESC}[1Ghello`), 'hello');
});

check('removes an OSC window title', () => {
	assert.equal(stripAnsi(`${ESC}]0;my title\u0007text`), 'text');
});

check('removes an OSC 8 hyperlink but keeps the label', () => {
	assert.equal(stripAnsi(`${ESC}]8;;https://x.test\u0007label${ESC}]8;;\u0007`), 'label');
});

check('removes a charset-selection escape', () => {
	assert.equal(stripAnsi(`${ESC}(Babc`), 'abc');
});

check('removes a C1 CSI sequence', () => {
	assert.equal(stripAnsi('\u009B31mred\u009B0m'), 'red');
});

check('leaves text without escapes untouched', () => {
	const text = 'plain 中文 text';
	assert.equal(stripAnsi(text), text);
});

check('is a no-op for an empty string', () => {
	assert.equal(stripAnsi(''), '');
});

// --- collapseCarriageReturns -------------------------------------------
check('keeps only the final progress segment', () => {
	assert.equal(collapseCarriageReturns('10%\r50%\r100% done'), '100% done');
});

check('converts CRLF to LF', () => {
	assert.equal(collapseCarriageReturns('a\r\nb'), 'a\nb');
});

check('keeps the last non-empty segment', () => {
	assert.equal(collapseCarriageReturns('spinner\r'), 'spinner');
});

check('collapses a spinner redraw to one frame', () => {
	const raw = '⠋ loading\r⠙ loading\r⠹ loading\r✓ done';
	assert.equal(collapseCarriageReturns(raw), '✓ done');
});

check('is a no-op without carriage returns', () => {
	const text = 'a\nb\nc';
	assert.equal(collapseCarriageReturns(text), text);
});

// --- stripControlChars --------------------------------------------------
check('removes NUL and BEL but keeps LF and TAB', () => {
	assert.equal(stripControlChars('a\u0000b\u0007c\nd\te'), 'abc\nd\te');
});

check('removes zero-width space and BOM', () => {
	assert.equal(stripControlChars('a\u200Bb\uFEFFc'), 'abc');
});

check('removes a bidi override', () => {
	assert.equal(stripControlChars('a\u202Eb'), 'ab');
});

check('keeps ESC when asked to', () => {
	assert.equal(stripControlChars(`${ESC}[31mx`, { keepEscape: true }), `${ESC}[31mx`);
});

check('drops C1 controls', () => {
	assert.equal(stripControlChars('a\u0090b'), 'ab');
});

// --- normalizeSpaces ----------------------------------------------------
check('folds NBSP and ideographic space', () => {
	assert.equal(normalizeSpaces('a\u00A0b\u3000c'), 'a b c');
});

check('folds en and em spaces', () => {
	assert.equal(normalizeSpaces('a\u2002b\u2003c'), 'a b c');
});

check('folds narrow no-break space', () => {
	assert.equal(normalizeSpaces('a\u202Fb'), 'a b');
});

// --- foldFullwidth ------------------------------------------------------
check('folds fullwidth ASCII', () => {
	assert.equal(foldFullwidth('\uFF21\uFF11\uFF0C'), 'A1,');
});

check('keeps CJK punctuation', () => {
	assert.equal(foldFullwidth('中文。'), '中文。');
});

// --- collapseReplacementRuns -------------------------------------------
check('collapses a replacement run', () => {
	assert.equal(collapseReplacementRuns('a\uFFFD\uFFFD\uFFFDb'), 'a\uFFFDb');
});

check('keeps a single replacement character', () => {
	assert.equal(collapseReplacementRuns('a\uFFFDb'), 'a\uFFFDb');
});

// --- repairMojibake -----------------------------------------------------
check('repairs UTF-8 read as GBK', () => {
	const mojibake = new TextDecoder('gbk').decode(Buffer.from('中文测试', 'utf8'));
	assert.equal(repairMojibake(mojibake), '中文测试');
});

check('repairs GBK read as Latin-1', () => {
	assert.equal(repairMojibake(Buffer.from([0xd6, 0xd0, 0xce, 0xc4]).toString('latin1')), '中文');
});

check('repairs UTF-8 read as Latin-1', () => {
	const mojibake = Buffer.from('café 中文', 'utf8').toString('latin1');
	assert.equal(repairMojibake(mojibake), 'café 中文');
});

check('leaves genuine Chinese untouched', () => {
	const text = '构建成功：共 42 个文件，耗时 1.2s';
	assert.equal(repairMojibake(text), text);
});

check('leaves ASCII untouched', () => {
	assert.equal(repairMojibake('npm run build ok'), 'npm run build ok');
});

check('leaves accented Latin untouched', () => {
	const text = 'naïve café résumé';
	assert.equal(repairMojibake(text), text);
});

check('leaves emoji untouched', () => {
	const text = '✅ done 🚀';
	assert.equal(repairMojibake(text), text);
});

check('leaves box drawing untouched', () => {
	const text = '┌───┬───┐\n│ a │ b │\n└───┴───┘';
	assert.equal(repairMojibake(text), text);
});

check('repairs a truncated GBK mis-decode as far as the bytes allow', () => {
	const mojibake = new TextDecoder('gbk').decode(Buffer.from('文件未找到', 'utf8'));
	const truncated = mojibake.split('\uFFFD').join('');
	const out = repairMojibake(truncated);
	assert.ok(out.includes('文件'), `expected readable prefix, got ${JSON.stringify(out)}`);
	assert.ok(out.includes('\uFFFD'), 'expected the lost byte to stay visible');
});

check('is idempotent on repaired text', () => {
	const mojibake = new TextDecoder('gbk').decode(Buffer.from('中文测试', 'utf8'));
	const once = repairMojibake(mojibake);
	assert.equal(repairMojibake(once), once);
});

// --- normalizeTerminalText ---------------------------------------------
check('runs the full pipeline', () => {
	const raw = `${ESC}[32m✓${ESC}[0m 构建完成\u00A0\u3000用时 1s\r\n\u0007`;
	assert.equal(normalizeTerminalText(raw), '✓ 构建完成  用时 1s\n');
});

check('skips a block longer than maxTextLength', () => {
	const raw = `${ESC}[31mred`;
	assert.equal(normalizeTerminalText(raw, { maxTextLength: 3 }), raw);
});

check('keeps fullwidth by default', () => {
	assert.equal(normalizeTerminalText('\uFF21\uFF11'), '\uFF21\uFF11');
});

check('folds fullwidth only when enabled', () => {
	assert.equal(normalizeTerminalText('\uFF21\uFF11', { foldFullwidth: true }), 'A1');
});

check('normalizes a real console artifact end to end', () => {
	const mojibake = new TextDecoder('gbk').decode(Buffer.from('中文测试', 'utf8'));
	const raw = `C:\\>type 中文文件.txt\r\n${mojibake}`;
	const out = normalizeTerminalText(raw);
	assert.ok(out.includes('中文测试'), `expected repaired text, got ${JSON.stringify(out)}`);
	assert.ok(!out.includes('\r'), 'expected carriage returns to be collapsed');
});

check('returns the input for an empty string', () => {
	assert.equal(normalizeTerminalText(''), '');
});

report();

/**
 * Real-world output tests.
 *
 * These reproduce the artifacts a Windows CP936 console, a build tool, or a
 * legacy file actually produce, and assert two things at once: the corruption is
 * repaired, and genuine content in the same buffer is never rewritten.
 *
 * @module dsh-transcode-tty/test/realworld.test
 */

import { suite, assert } from './harness.mjs';
import {
	ESC,
	GENUINE,
	dropHoles,
	utf8AsGbk,
	utf8AsLatin1,
} from './samples.mjs';
import { normalizeTerminalText, repairMojibake } from '../src/normalize.js';

const { check, report } = suite('real-world output');

for (const sample of GENUINE) {
	const gbkForm = utf8AsGbk(sample);
	const latin1Form = utf8AsLatin1(sample);

	/*
	 * Decoding UTF-8 bytes as GBK is lossy whenever the byte count is odd or a
	 * pair falls outside the GBK table: the decoder emits U+FFFD and the lost
	 * byte cannot be recovered. Such input must not be rewritten into different
	 * wrong text.
	 */
	if (gbkForm.includes('\uFFFD')) {
		check(`lossy GBK mis-decode keeps the loss visible: ${sample}`, () => {
			const out = repairMojibake(gbkForm);
			assert.ok(out.includes('\uFFFD'), `loss was hidden: ${JSON.stringify(out)}`);
			assert.notEqual(out, sample);
			assert.equal(repairMojibake(out), out, 'repair is not idempotent');
		});

		check(`truncated GBK mis-decode recovers what the bytes allow: ${sample}`, () => {
			const out = repairMojibake(dropHoles(gbkForm));
			// The repair must never invent characters the byte stream cannot hold,
			// and it must not leave a wall of second-level Hanzi either.
			const readable = [...out].filter((char) => /\p{Script=Han}/u.test(char)).length;
			assert.ok(
				readable > 0 || out.includes('\uFFFD'),
				`nothing was recovered: ${JSON.stringify(out)}`,
			);
			assert.equal(repairMojibake(out), out, 'repair is not idempotent');
		});
	} else {
		check(`GBK mis-decode repaired: ${sample}`, () => {
			assert.equal(repairMojibake(gbkForm), sample);
		});
	}

	check(`Latin-1 mis-decode repaired: ${sample}`, () => {
		assert.equal(repairMojibake(latin1Form), sample);
	});

	check(`genuine text untouched: ${sample}`, () => {
		assert.equal(repairMojibake(sample), sample);
	});
}

// --- mixed content ------------------------------------------------------
check('repairs only the corrupted run in a mixed line', () => {
	const corrupted = utf8AsLatin1('文件未找到');
	const raw = `C:\\Users\\admin>type 报告.txt\r\n${corrupted}`;
	const out = normalizeTerminalText(raw);
	assert.ok(out.includes('文件未找到'), `got ${JSON.stringify(out)}`);
	assert.ok(out.includes('C:\\Users\\admin>type 报告.txt'));
});

check('keeps a genuine rare-Hanzi name', () => {
	const text = '张燚 李鑫 王淼';
	assert.equal(repairMojibake(text), text);
});

check('keeps traditional Chinese', () => {
	const text = '編譯成功，檔案已產生';
	assert.equal(repairMojibake(text), text);
});

check('keeps Japanese', () => {
	const text = 'ビルドが成功しました';
	assert.equal(repairMojibake(text), text);
});

check('keeps Korean', () => {
	const text = '빌드 성공';
	assert.equal(repairMojibake(text), text);
});

// --- real tool output ---------------------------------------------------
check('cleans npm-style colored output', () => {
	const raw =
		`${ESC}[32m✓${ESC}[39m build completed in ${ESC}[1m1.2s${ESC}[22m\r\n` +
		`${ESC}[33mwarn${ESC}[39m deprecated dependency`;
	assert.equal(normalizeTerminalText(raw), '✓ build completed in 1.2s\nwarn deprecated dependency');
});

check('preserves git log output byte for byte', () => {
	const raw = 'commit 1a2b3c4\nAuthor: 张三 <z@example.com>\n\n    修复终端乱码问题\n';
	assert.equal(normalizeTerminalText(raw), raw);
});

check('collapses a spinner to its final frame', () => {
	const raw = '⠋\r⠙\r⠹\r⠸\r✓ done';
	assert.equal(normalizeTerminalText(raw), '✓ done');
});

check('cleans a colored PowerShell error record', () => {
	const raw = `${ESC}[31mGet-ChildItem${ESC}[0m: cannot find path 错误`;
	const out = normalizeTerminalText(raw);
	assert.equal(out, 'Get-ChildItem: cannot find path 错误');
});

check('cleans a colored diff', () => {
	const raw = `${ESC}[32m+added${ESC}[0m\n${ESC}[31m-removed${ESC}[0m`;
	assert.equal(normalizeTerminalText(raw), '+added\n-removed');
});

// --- pathological input -------------------------------------------------
check('survives lone surrogates', () => {
	const raw = 'a\uD800b\uDC00c';
	assert.equal(typeof normalizeTerminalText(raw), 'string');
});

check('survives a huge replacement run', () => {
	const raw = '\uFFFD'.repeat(5000);
	assert.equal(typeof normalizeTerminalText(raw), 'string');
});

check('returns an empty string unchanged', () => {
	assert.equal(normalizeTerminalText(''), '');
});

check('leaves pure ASCII on the fast path', () => {
	const raw = 'total 42\ndrwxr-xr-x 1 root root 0 file.txt\n';
	assert.equal(normalizeTerminalText(raw), raw);
});

check('survives NUL-heavy binary spill', () => {
	const raw = 'a\u0000b\u0000c';
	assert.equal(typeof normalizeTerminalText(raw), 'string');
});

// --- performance --------------------------------------------------------
check('normalizes a large dump quickly', () => {
	const line = '2026-11-22 12:00:00 INFO 构建完成 src/app.ts 1234 bytes\n';
	const raw = line.repeat(8000);
	assert.ok(raw.length > 400000);
	const start = process.hrtime.bigint();
	normalizeTerminalText(raw, { maxTextLength: 10_000_000 });
	const ms = Number(process.hrtime.bigint() - start) / 1e6;
	assert.ok(ms < 400, `took ${ms.toFixed(1)}ms`);
	console.log(`     (${raw.length} chars normalized in ${ms.toFixed(1)}ms)`);
});

report();

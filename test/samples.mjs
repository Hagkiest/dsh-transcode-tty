/**
 * Realistic mojibake samples shared by the suites.
 *
 * Each helper reproduces a corruption that actually happens in the field, so the
 * tests read as the bug report rather than as an encoding exercise.
 *
 * @module dsh-transcode-tty/test/samples
 */

/** Lazily created GBK decoder. */
let gbk;
/** Lazily built reverse map from a GBK character to its two bytes. */
let reverse;

/**
 * Decode bytes as GBK, failing loudly when the runtime lacks full ICU data.
 * @returns {TextDecoder} the decoder.
 */
function gbkDecoder() {
	if (gbk === undefined) gbk = new TextDecoder('gbk');
	return gbk;
}

/**
 * Build the GBK reverse map by decoding every valid two-byte sequence once.
 * @returns {Map<string, number[]>} character -> [lead, trail].
 */
function gbkReverse() {
	if (reverse !== undefined) return reverse;
	const decoder = gbkDecoder();
	const map = new Map();
	for (let lead = 0x81; lead <= 0xfe; lead += 1) {
		for (let trail = 0x40; trail <= 0xfe; trail += 1) {
			if (trail === 0x7f) continue;
			const decoded = decoder.decode(Uint8Array.of(lead, trail));
			if (decoded.length === 1 && decoded !== '\uFFFD' && !map.has(decoded)) {
				map.set(decoded, [lead, trail]);
			}
		}
	}
	reverse = map;
	return map;
}

/**
 * Encode text to GBK bytes.
 * @param {string} text - text to encode.
 * @returns {number[]} the GBK byte values.
 * @throws {Error} when a character has no GBK form.
 */
export function gbkBytes(text) {
	const map = gbkReverse();
	const bytes = [];
	for (const char of text) {
		const code = char.codePointAt(0);
		if (code < 0x80) {
			bytes.push(code);
			continue;
		}
		const pair = map.get(char);
		if (pair === undefined) throw new Error(`no GBK form for ${JSON.stringify(char)}`);
		bytes.push(pair[0], pair[1]);
	}
	return bytes;
}

/**
 * Reproduce "UTF-8 bytes read as GBK", the classic CP936 console artifact.
 * @param {string} text - the intended text.
 * @returns {string} the mojibake a GBK console would show.
 */
export function utf8AsGbk(text) {
	return gbkDecoder().decode(Buffer.from(text, 'utf8'));
}

/**
 * Reproduce "GBK bytes read as ISO-8859-1".
 * @param {string} text - Chinese text to corrupt.
 * @returns {string} the mojibake a Latin-1 reader would show.
 */
export function gbkAsLatin1(text) {
	return Buffer.from(gbkBytes(text)).toString('latin1');
}

/**
 * Reproduce "UTF-8 bytes read as ISO-8859-1".
 * @param {string} text - the intended text.
 * @returns {string} the mojibake a Latin-1 reader would show.
 */
export function utf8AsLatin1(text) {
	return Buffer.from(text, 'utf8').toString('latin1');
}

/**
 * Reproduce the loss the wrong charset inflicts when it hits an invalid byte:
 * it emits U+FFFD and the original byte is gone for good.
 * @param {string} mojibake - a {@link utf8AsGbk} result.
 * @returns {string} the same string with its replacement characters removed.
 */
export function dropHoles(mojibake) {
	return mojibake.split('\uFFFD').join('');
}

/** Escape sequences used across suites. */
export const ESC = '\u001B';

/** Chinese strings a Windows console or build tool really emits. */
export const GENUINE = Object.freeze([
	'构建成功',
	'文件未找到',
	'中文测试',
	'编译完成，耗时 1.2 秒',
	'错误：无法识别的选项',
	'正在下载依赖包……',
	'共 42 个文件已处理',
	'警告：路径包含非法字符',
	'任务已取消',
	'所有测试通过',
]);

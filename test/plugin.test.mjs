/**
 * Plugin wiring tests.
 *
 * The suite imports the real entry point with a stubbed schema library, mounts
 * it against a fake Cordis context, and drives the captured listener exactly the
 * way the runtime does. The assertions encode the runtime contract a naive
 * implementation breaks:
 *
 * 1. A decision must never carry both `content` and `value`; the runtime throws.
 * 2. A result that needs no change must fall through to `next()`, not return an
 *    empty replacement.
 * 3. A tool outside the allow-list must not be touched.
 *
 * @module dsh-transcode-tty/test/plugin.test
 */

import { suite, assert } from './harness.mjs';
import { ESC, dropHoles, utf8AsGbk } from './samples.mjs';
import { apply, name } from '../index.js';
import { Config, DEFAULT_CONFIG, DEFAULT_TOOLS, resolveSettings } from '../src/config.js';

const { check, report } = suite('plugin wiring');

check('exports the plugin name', () => {
	assert.equal(name, 'dsh-transcode-tty');
});

check('exposes the declared defaults', () => {
	assert.equal(DEFAULT_CONFIG.stripAnsi, true);
	assert.equal(DEFAULT_CONFIG.foldFullwidth, false);
	assert.deepEqual([...DEFAULT_TOOLS], ['pwsh', 'bash', 'job_output']);
});

/**
 * Mount the plugin against a fake context and capture its listener.
 * @param {object} [config] - row config to activate with.
 * @returns {{ listener: Function, disposers: Function[] }} the captured wiring.
 */
function mount(config) {
	let listener;
	const disposers = [];
	const ctx = {
		on(event, handler) {
			assert.equal(event, 'tools/post-execute');
			listener = handler;
			return () => {
				listener = undefined;
			};
		},
		effect(fn) {
			disposers.push(fn());
		},
	};
	apply(ctx, config);
	assert.equal(typeof listener, 'function', 'plugin registered no listener');
	return { listener, disposers };
}

/**
 * Call the listener the way the runtime does.
 * @param {Function} listener - the captured listener.
 * @param {string} toolName - the executing tool.
 * @param {unknown[]} content - result content blocks.
 * @param {object} [value] - structured result value.
 * @returns {Promise<{ decision: object, nextCalls: number }>} the outcome.
 */
async function run(listener, toolName, content, value = { kind: 'foreground' }) {
	let nextCalls = 0;
	const next = async () => {
		nextCalls += 1;
		return { kind: 'accept' };
	};
	const decision = await listener(
		{ name: toolName, arguments: {}, callId: 'c1' },
		{ isError: false, value, content },
		next,
	);
	return { decision, nextCalls };
}

/** Build a text content block. */
const textBlock = (text) => ({ type: 'text', text });

// --- decision shape -----------------------------------------------------
{
	const { listener } = mount({});
	const { decision, nextCalls } = await run(listener, 'pwsh', [
		textBlock(`${ESC}[31mred${ESC}[0m`),
	]);
	check('normalizes an allow-listed tool', () => {
		assert.equal(nextCalls, 0);
		assert.equal(decision.kind, 'accept');
		assert.equal(decision.content[0].text, 'red');
	});
	check('never carries both content and value', () => {
		assert.equal(Object.hasOwn(decision, 'value'), false);
	});
	check('carries no field besides kind and content', () => {
		assert.deepEqual(Object.keys(decision).sort(), ['content', 'kind']);
	});
}

{
	const { listener } = mount({});
	const { decision, nextCalls } = await run(listener, 'read', [
		textBlock(`${ESC}[31mred${ESC}[0m`),
	]);
	check('passes a tool outside the allow-list through', () => {
		assert.equal(nextCalls, 1);
		assert.equal(decision.content, undefined);
	});
}

{
	const { listener } = mount({ tools: ['bash'] });
	const bash = await run(listener, 'bash', [textBlock(`${ESC}[1mx${ESC}[0m`)]);
	const pwsh = await run(listener, 'pwsh', [textBlock(`${ESC}[1mx${ESC}[0m`)]);
	check('honours a configured allow-list', () => {
		assert.equal(bash.decision.content[0].text, 'x');
		assert.equal(pwsh.nextCalls, 1);
	});
}

// --- no-op paths --------------------------------------------------------
{
	const { listener } = mount({});
	const { decision, nextCalls } = await run(listener, 'pwsh', [textBlock('build ok\n')]);
	check('unchanged text falls through to next()', () => {
		assert.equal(nextCalls, 1);
		assert.equal(decision.content, undefined);
	});
}

{
	const { listener } = mount({});
	const { nextCalls } = await run(listener, 'pwsh', []);
	check('empty content falls through', () => {
		assert.equal(nextCalls, 1);
	});
}

{
	const { listener } = mount({});
	const { nextCalls } = await run(listener, 'pwsh', [{ type: 'image', data: 'abc' }]);
	check('non-text blocks are left alone', () => {
		assert.equal(nextCalls, 1);
	});
}

{
	const { listener } = mount({});
	const { nextCalls } = await run(listener, 'pwsh', [textBlock('x'), { type: 'image' }]);
	check('a mixed block list with no text change falls through', () => {
		assert.equal(nextCalls, 1);
	});
}

{
	const { listener } = mount({});
	const { decision } = await run(listener, 'pwsh', [textBlock('plain 中文\n')]);
	check('genuine Chinese passes through untouched', () => {
		assert.equal(decision.content, undefined);
	});
}

// --- disabled -----------------------------------------------------------
{
	const { listener } = mount({ enabled: false });
	const { nextCalls } = await run(listener, 'pwsh', [textBlock(`${ESC}[31mred${ESC}[0m`)]);
	check('disabled plugin does nothing', () => {
		assert.equal(nextCalls, 1);
	});
}

// --- per-transform switches --------------------------------------------
{
	const { listener } = mount({ stripAnsi: false });
	const { decision, nextCalls } = await run(listener, 'pwsh', [
		textBlock(`${ESC}[31mred${ESC}[0m`),
	]);
	check('stripAnsi:false keeps the escape bytes', () => {
		assert.equal(nextCalls, 1);
		assert.equal(decision.content, undefined);
	});
}

{
	const { listener } = mount({ foldFullwidth: true });
	const { decision } = await run(listener, 'pwsh', [textBlock('\uFF21\uFF11')]);
	check('foldFullwidth:true folds when enabled', () => {
		assert.equal(decision.content[0].text, 'A1');
	});
}

{
	const { listener } = mount({ repairMojibake: false });
	const mojibake = utf8AsGbk('中文测试');
	const { nextCalls } = await run(listener, 'pwsh', [textBlock(mojibake)]);
	check('repairMojibake:false leaves mojibake alone', () => {
		assert.equal(nextCalls, 1);
	});
}

// --- multiple blocks ----------------------------------------------------
{
	const { listener } = mount({});
	const { decision } = await run(listener, 'pwsh', [
		textBlock(`${ESC}[32mone${ESC}[0m`),
		textBlock('two'),
		textBlock(`${ESC}[33mthree${ESC}[0m`),
	]);
	check('rewrites only changed blocks and preserves order', () => {
		assert.equal(decision.content.length, 3);
		assert.equal(decision.content[0].text, 'one');
		assert.equal(decision.content[1].text, 'two');
		assert.equal(decision.content[2].text, 'three');
	});
}

// --- realistic ----------------------------------------------------------
{
	const { listener } = mount({});
	const raw = `PS C:\\> type log.txt\r\n${dropHoles(utf8AsGbk('文件未找到'))}\r\n`;
	const { decision } = await run(listener, 'pwsh', [textBlock(raw)]);
	check('repairs a realistic console line end to end', () => {
		const out = decision.content[0].text;
		assert.ok(out.includes('文件'), `got ${JSON.stringify(out)}`);
		assert.ok(!out.includes('\r'));
	});
}

{
	const { listener } = mount({});
	const value = { kind: 'foreground', exitCode: 0, stdout: { text: 'x' } };
	const { decision } = await run(listener, 'pwsh', [textBlock(`${ESC}[31mred${ESC}[0m`)], value);
	check('leaves the structured value for downstream consumers', () => {
		assert.equal(Object.hasOwn(decision, 'value'), false);
	});
}

// --- lifecycle ----------------------------------------------------------
{
	const { disposers } = mount({});
	check('registers exactly one disposable listener', () => {
		assert.equal(disposers.length, 1);
		assert.equal(typeof disposers[0], 'function');
	});
}

// --- config resolution --------------------------------------------------
check('resolveSettings applies defaults for an empty config', () => {
	const settings = resolveSettings({});
	assert.equal(settings.enabled, true);
	assert.equal(settings.tools.has('pwsh'), true);
	assert.equal(settings.options.foldFullwidth, false);
	assert.equal(settings.options.maxTextLength, 262144);
});

check('resolveSettings keeps an opt-in transform off for a non-boolean', () => {
	const settings = resolveSettings({ foldFullwidth: 'yes' });
	assert.equal(settings.options.foldFullwidth, false);
});

check('resolveSettings rejects a non-positive maxTextLength', () => {
	const settings = resolveSettings({ maxTextLength: -1 });
	assert.equal(settings.options.maxTextLength, 262144);
});

check('exposes a Config schema when the library is present', () => {
	assert.ok(Config !== undefined, 'Config is undefined');
	// The real library returns a callable schema; the stub returns a plain
	// object. Both are valid schema nodes, so assert on the shape they share.
	assert.equal(Config.kind ?? typeof Config, 'object');
});

report();

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as localTests from '../localTests';
import { renderLocalTests, renderLocalTestsToolbar } from '../localTestsView';
import { parseProblemBindData } from '../shortestpathOjProtocol';
import { bindPayload } from './fixtures';

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const helpers = { escape, text: escape, markdown: escape };
const snapshot = (): localTests.LocalTestsSnapshot => ({ sourcePath: '/A.cpp', status: 'idle', diagnostics: '', tests: [{ id: 1, input: '1\n', output: '1\n' }] });

test('local samples retain explanations, expose ordinary controls, and keep input outside the output comparison', () => {
	const state = snapshot();
	state.tests[0].origin = 'sample'; state.tests[0].sampleIndex = 0;
	state.tests[0].result = { id: 1, pass: false, stdout: '2\n', stderr: 'debug', code: 0, signal: null, time: 1.25, timeOut: false, diff: { summary: 'changed', lines: [{ lineNumber: 1, expected: '1', received: '2', type: 'changed' }] } };
	state.tests.push({ id: 2, input: 'custom', output: 'custom' });
	const html = renderLocalTests(state, parseProblemBindData(bindPayload), undefined, false, helpers);
	for (const command of ['localTestRun', 'localTestSave', 'localTestAdd', 'localTestDelete']) { assert.ok(html.includes(`data-command="${command}"`)); }
	const toolbar = renderLocalTestsToolbar(state, false, helpers.text);
	for (const command of ['localTestRunAll', 'localTestNew']) { assert.ok(toolbar.includes(`data-command="${command}"`)); }
	assert.doesNotMatch(html, /local-tests-toolbar/);
	assert.match(html, /<summary class="local-test-add-heading" title="添加用例" aria-label="添加用例"><svg/);
	assert.match(html, /样例 1/);
	assert.ok(html.includes(bindPayload.problem.samples[0].explanation));
	assert.ok(html.indexOf('复制样例输入') < html.indexOf('local-test-output-grid'));
	assert.match(html, /local-test-output-grid[\s\S]*期望输出[\s\S]*实际输出/);
	assert.doesNotMatch(html, /输出差异|编辑用例|local-test-diff|local-test-editor/);
	assert.match(html, /local-test-mismatch">1<\/span>/);
	assert.match(html, /local-test-mismatch">2<\/span>/);
	const official = html.slice(html.indexOf('data-persist-key="card:1"'), html.indexOf('data-persist-key="card:2"'));
	assert.doesNotMatch(official, /textarea|localTestDelete|localTestSave|点击编辑/);
	assert.match(html, /local-test-value[^>]*data-persist-key="input:2"/);
	assert.match(html, /localTestRun" title="运行" aria-label="运行"[^>]*><svg/);
	assert.match(html, /答案不符 · 1.3 ms/);
	assert.doesNotMatch(html, /CPH|stress-start|large-sample/);
});

test('compiler errors and arbitrary test content are escaped, with external text excluded from localization', () => {
	const state = snapshot();
	state.tests[0].input = '</textarea><script>alert(1)</script>';
	state.diagnostics = '<compiler failure>';
	state.error = 'compile-failed';
	const html = renderLocalTests(state, parseProblemBindData(bindPayload), undefined, false, helpers);
	assert.doesNotMatch(html, /<script>|<compiler failure>/);
	assert.match(html, /&lt;\/textarea&gt;&lt;script&gt;/);
	assert.match(html, /textarea[^>]*data-i18n-ignore/);
	assert.match(html, /compile-diagnostics" open/);
	assert.match(html, /编译失败/);
});

test('running tests allow stopping, disable mutations, and interactive problems expose their supplied reason', () => {
	const state = snapshot();
	state.status = 'compiling';
	const problem = parseProblemBindData(bindPayload);
	const html = renderLocalTestsToolbar(state, false, helpers.text);
	assert.match(html, /data-command="localTestRunAll"[^>]*disabled/);
	assert.match(html, /data-command="localTestStop"[^>]*><svg/);
	assert.match(html, /data-command="localTestNew"[^>]*disabled/);
	problem.localTest = { enabled: false, reason: 'external <reason>' };
	const disabled = renderLocalTests(state, problem, undefined, false, helpers);
	assert.match(disabled, /data-i18n-ignore>external &lt;reason&gt;/);
	assert.doesNotMatch(disabled, /data-command/);
});

test('local test snapshots reject malformed identities, test fields, and status', () => {
	assert.deepEqual(localTests.readLocalTestsSnapshot(snapshot()), snapshot());
	for (const value of [null, {}, { ...snapshot(), status: 'unknown' }, { ...snapshot(), tests: [{ id: '1', input: '', output: '' }] }, { ...snapshot(), tests: [{ id: 1, input: {}, output: '' }] }]) { assert.equal(localTests.readLocalTestsSnapshot(value), undefined); }
});

function panelFixture() {
	const compiled = fs.readFileSync(path.resolve(__dirname, '../extension.js'), 'utf8');
	const requests: localTests.LocalTestRequest[] = [];
	const posted: object[] = [];
	const context = vm.createContext({ console, setTimeout, clearTimeout, localTests_1: localTests,
		localization_1: { localize: (text: string) => text },
		vscode: { extensions: { getExtension: () => ({ activate: async () => undefined }) }, commands: { executeCommand: async (_name: string, request: localTests.LocalTestRequest) => { requests.push(structuredClone(request)); return { ...snapshot(), sourcePath: request.sourcePath }; } } },
		readLocalTestEdits: (value: unknown) => Array.isArray(value) ? value : undefined,
	});
	const start = compiled.indexOf('class ShortestPathOjProblemPanel');
	const end = compiled.indexOf('async function activate(', start);
	vm.runInContext(`${compiled.slice(start, end)}; globalThis.Panel = ShortestPathOjProblemPanel;`, context);
	const panel = new context.Panel({}, '', {}, new Set());
	panel.state = { problem: parseProblemBindData(bindPayload), sourcePath: '/A.cpp', connected: true };
	panel.panel = { webview: { postMessage: (message: object) => posted.push(structuredClone(message)) } };
	panel.render = () => { };
	panel.confirm = async () => true;
	return { panel, context, requests, posted };
}

test('panel actions bind requests to their own source and acknowledge persisted edits', async () => {
	const { panel, requests, posted } = panelFixture();
	panel.state.problem.samples = [];
	await panel.handleMessage({ command: 'localTestRunAll', edits: [{ id: 1, input: 'draft', output: 'expected' }] });
	await panel.handleMessage({ command: 'localTestSave', id: 1, input: 'saved', output: 'expected' });
	await panel.handleMessage({ command: 'localTestDelete', id: 1 });
	await panel.handleMessage({ command: 'localTestRun', id: 'invalid' });
	assert.deepEqual(requests.map(request => ({ source: request.sourcePath, action: request.action })), [{ source: '/A.cpp', action: 'runAll' }, { source: '/A.cpp', action: 'update' }, { source: '/A.cpp', action: 'delete' }]);
	assert.deepEqual(requests[0].edits, [{ id: 1, input: 'draft', output: 'expected' }]);
	assert.deepEqual(posted, [{ type: 'localTestSaved', action: 'update', id: 1 }]);
	panel.updateLocalTests({ ...snapshot(), sourcePath: '/B.cpp', diagnostics: 'other source' });
	assert.equal(panel.state.localTests.sourcePath, '/A.cpp');
});

test('official samples reject direct mutation and are excluded from run drafts', async () => {
	const { panel, requests } = panelFixture();
	panel.state.localTests = snapshot();
	panel.state.localTests.tests[0].origin = 'sample';
	await panel.handleMessage({ command: 'localTestSave', id: 1, input: 'changed', output: 'changed' });
	await panel.handleMessage({ command: 'localTestDelete', id: 1 });
	assert.equal(requests.length, 0);
	await panel.handleMessage({ command: 'localTestRunAll', edits: [{ id: 1, input: 'changed', output: 'changed' }] });
	assert.deepEqual(requests[0].edits, []);
	assert.equal(requests[0].action, 'runAll');
});

test('inline mismatch marking compares tokens and preserves original text', () => {
	const state = snapshot();
	state.tests[0].output = 'prefix 123 suffix\nunchanged\nextra';
	state.tests[0].result = { id: 1, pass: false, stdout: 'prefix 129 suffix\nunchanged\n', stderr: '', code: 0, signal: null, time: 1, timeOut: false };
	const html = renderLocalTests(state, parseProblemBindData(bindPayload), undefined, false, helpers);
	assert.match(html, /prefix <span class="local-test-mismatch">123<\/span> suffix\nunchanged/);
	assert.match(html, /prefix <span class="local-test-mismatch">129<\/span> suffix\nunchanged/);
	assert.match(html, /local-test-mismatch">extra<\/span>/);
	state.tests[0].output = '1 2 3 4 5';
	state.tests[0].result.stdout = '1 9 3 8 5';
	const separated = renderLocalTests(state, parseProblemBindData(bindPayload), undefined, false, helpers);
	assert.match(separated, /1 <span class="local-test-mismatch">2<\/span> 3 <span class="local-test-mismatch">4<\/span> 5/);
	state.tests[0].output = '1\t2\n3';
	state.tests[0].result.stdout = '1  2 3\n';
	assert.doesNotMatch(renderLocalTests(state, parseProblemBindData(bindPayload), undefined, false, helpers), /local-test-mismatch/);
	state.tests[0].result.pass = true;
	assert.doesNotMatch(renderLocalTests(state, parseProblemBindData(bindPayload), undefined, false, helpers), /local-test-mismatch/);
});

test('bulk results collapse passed cards, while individual results stay open', () => {
	const state = snapshot();
	state.runMode = 'all'; state.runId = 1;
	state.tests[0].result = { id: 1, pass: true, stdout: '1\n', stderr: '', code: 0, signal: null, time: 1, timeOut: false };
	let html = renderLocalTests(state, parseProblemBindData(bindPayload), undefined, false, helpers);
	assert.match(html, /data-persist-key="card:1"[^>]*data-auto-collapse-key="1:1:passed" class="sample local-test passed/);
	state.runMode = 'single'; state.runTestId = 1; state.runId = 2;
	html = renderLocalTests(state, parseProblemBindData(bindPayload), undefined, false, helpers);
	assert.match(html, /data-persist-key="card:1"[^>]*data-auto-collapse-key="" open class="sample local-test passed/);
	state.tests[0].result.pass = false;
	state.runMode = 'all';
	assert.match(renderLocalTests(state, parseProblemBindData(bindPayload), undefined, false, helpers), /data-persist-key="card:1"[^>]*data-auto-collapse-key="" open class="sample local-test failed/);
});

test('bulk collapse happens once, preserves manual expansion, and a subsequent single run opens the card', () => {
	const source = fs.readFileSync(path.resolve(__dirname, '../problemView.js'), 'utf8');
	const details = { open: true, dataset: { autoExpandKey: '1:1', autoCollapseKey: '' }, getAttribute: () => 'card:1' };
	const section = { querySelectorAll: (selector: string) => selector === 'details' ? [details] : [] };
	const context = vm.createContext({ document: { activeElement: undefined }, section });
	vm.runInContext(`${source.slice(source.indexOf('const snapshotSection ='), source.indexOf('const getActiveTabId ='))}; globalThis.capture = snapshotSection; globalThis.restore = restoreSection;`, context);
	let captured = context.capture(section);
	details.dataset.autoCollapseKey = '1:1:passed';
	context.restore(section, captured);
	assert.equal(details.open, false);
	details.open = true;
	captured = context.capture(section);
	context.restore(section, captured);
	assert.equal(details.open, true);
	details.open = false;
	captured = context.capture(section);
	details.dataset.autoCollapseKey = '';
	details.dataset.autoExpandKey = '2:1';
	context.restore(section, captured);
	assert.equal(details.open, true);
});

test('source identity is stable even when a custom case copies the official sample', () => {
	const state = snapshot();
	state.tests[0].origin = 'custom';
	let html = renderLocalTests(state, parseProblemBindData(bindPayload), undefined, false, helpers);
	assert.match(html, /localTestDelete/);
	assert.match(html, /点击编辑/);
	state.tests[0].origin = 'sample';
	state.tests[0].input = 'legacy edited content';
	html = renderLocalTests(state, parseProblemBindData(bindPayload), undefined, false, helpers);
	const card = html.slice(html.indexOf('data-persist-key="card:1"'), html.indexOf('<details class="local-test-add"'));
	assert.doesNotMatch(card, /localTestDelete|textarea/);
});

test('late local results and deletes awaiting backend activation cannot affect a replaced problem', async () => {
	const { panel, context, requests, posted } = panelFixture();
	let finish!: (value: localTests.LocalTestsSnapshot) => void;
	let started!: () => void;
	const dispatched = new Promise<void>(resolve => { started = resolve; });
	context.vscode.commands.executeCommand = () => new Promise(resolve => { finish = resolve; started(); });
	const request = panel.handleMessage({ command: 'localTestAdd', input: 'x', output: 'y' });
	await dispatched;
	panel.state = { problem: parseProblemBindData(bindPayload), sourcePath: '/B.cpp' };
	finish(snapshot());
	await request;
	assert.equal(panel.state.localTests, undefined);
	assert.deepEqual(posted, []);
	let activate!: () => void;
	context.vscode.extensions.getExtension = () => ({ activate: () => new Promise<void>(resolve => { activate = resolve; }) });
	const deletion = panel.handleMessage({ command: 'localTestDelete', id: 1 });
	panel.state = { problem: parseProblemBindData(bindPayload), sourcePath: '/C.cpp' };
	activate();
	await deletion;
	assert.deepEqual(requests, []);
});

test('deleting a custom test dispatches immediately without a confirmation', async () => {
	const { panel, requests } = panelFixture();
	panel.confirm = async () => { throw new Error('Deletion must not request confirmation.'); };
	await panel.handleMessage({ command: 'localTestDelete', id: 1 });
	assert.deepStrictEqual(requests.map(request => ({ action: request.action, id: request.id })), [{ action: 'delete', id: 1 }]);
});

test('sample heading actions preserve collapse and adding opens and focuses the new case', () => {
	const compiled = fs.readFileSync(path.resolve(__dirname, '../problemView.js'), 'utf8');
	const samples = { open: false };
	let focused = false;
	const form = { open: false, closest: () => samples, querySelector: () => ({ focus: () => { focused = true; } }) };
	let click!: (event: { target: Button; preventDefault(): void }) => void;
	let prevented = 0;
	const messages: object[] = [];
	class Button {
		disabled = false;
		constructor(readonly dataset: { command: string }) { }
		closest(selector: string): Button | null { return selector === 'button[data-command]' || selector === 'summary' ? this : null; }
	}
	vm.runInNewContext(compiled.slice(compiled.indexOf('/* ---- Click handler ---- */'), compiled.indexOf(`document.addEventListener('submit'`)), {
		Element: Button,
		document: {
			addEventListener: (name: string, listener: typeof click) => { if (name === 'click') { click = listener; } },
			querySelector: () => form,
			querySelectorAll: () => [],
		},
		vscode: { postMessage: (message: object) => messages.push(structuredClone(message)) },
	});
	const press = (command: string) => click({ target: new Button({ command }), preventDefault: () => { prevented++; } });
	press('localTestRunAll');
	assert.equal(samples.open, false);
	press('localTestNew');
	assert.deepStrictEqual({ prevented, open: samples.open, formOpen: form.open, focused, messages }, {
		prevented: 2, open: true, formOpen: true, focused: true, messages: [{ command: 'localTestRunAll', id: undefined, edits: [] }],
	});
});

test('first sample load waits for backend activation; a failed activation can be retried', async () => {
	const { panel, context, requests } = panelFixture();
	let activate!: () => void;
	context.vscode.extensions.getExtension = () => ({ activate: () => new Promise<void>(resolve => { activate = resolve; }) });
	const load = panel.handleMessage({ command: 'localTestLoad' });
	assert.equal(requests.length, 0);
	activate();
	await load;
	assert.equal(requests[0].action, 'load');
	context.vscode.extensions.getExtension = () => ({ activate: async () => { throw new Error('activation failed'); } });
	await panel.handleMessage({ command: 'localTestLoad' });
	assert.ok(panel.state.localTestsError);
	context.vscode.extensions.getExtension = () => ({ activate: async () => undefined });
	await panel.handleMessage({ command: 'localTestLoad' });
	assert.equal(panel.state.localTestsError, undefined);
	assert.equal(requests.length, 2);
});

test('replacing a statement repopulates its heading toolbar even when the controls are unchanged', () => {
	const { panel, context, posted } = panelFixture();
	context.problemViewSectionIds = { statement: 'oj-statement-content', localTestsToolbar: 'oj-local-tests-toolbar', localTests: 'oj-local-tests' };
	context.wrapTabSection = (_key: string, html: string) => html;
	panel.webviewReady = true;
	panel.sentSections = { connected: true, statement: 'previous statement', localTestsToolbar: 'controls', localTests: 'cases' };
	panel.pendingSections = { ...panel.sentSections, statement: 'updated statement' };
	panel.pendingTimer = {};
	panel.sentTimerJson = '{}';
	panel.flushPendingUpdate();
	assert.deepStrictEqual(posted, [{ type: 'update', sections: { 'oj-statement-content': 'updated statement', 'oj-local-tests-toolbar': 'controls', 'oj-local-tests': 'cases' }, connected: true, timer: {} }]);
});

test('connection changes reach a ready webview even when all cached sections and the timer are unchanged', () => {
	const { panel, context, posted } = panelFixture();
	context.problemViewSectionIds = { connectionGate: 'oj-connection-gate' };
	context.wrapTabSection = (_key: string, html: string) => html;
	panel.webviewReady = true;
	panel.sentSections = { connected: true, connectionGate: '' };
	panel.pendingSections = { connected: false, connectionGate: '' };
	panel.pendingTimer = {};
	panel.sentTimerJson = '{}';
	panel.flushPendingUpdate();
	panel.pendingSections = { connected: true, connectionGate: '' };
	panel.flushPendingUpdate();
	panel.flushPendingUpdate();
	assert.deepStrictEqual(posted, [
		{ type: 'update', connected: false, sections: {}, timer: {} },
		{ type: 'update', connected: true, sections: {}, timer: {} },
	]);
});

test('test drafts, expansion and cursor survive both local updates and replacement of their parent statement', () => {
	const compiled = fs.readFileSync(path.resolve(__dirname, '../problemView.js'), 'utf8');
	class Field {
		selectionStart = 3;
		constructor(readonly name: string, public value: string) { }
		focus() { document.activeElement = this; }
		setSelectionRange(start: number) { this.selectionStart = start; }
	}
	class Section {
		fields: Field[] = [new Field('local-input-1', 'server input'), new Field('local-new-input', '')];
		details = [{ open: false, dataset: {}, getAttribute: () => 'edit:1' }];
		querySelectorAll(selector: string) { return selector === 'details' ? this.details : this.fields; }
		set innerHTML(_html: string) { this.fields = new Section().fields; this.details = new Section().details; }
	}
	let local = new Section();
	local.fields[0].value = 'unsaved draft'; local.fields[1].value = 'pending new test'; local.details[0].open = true;
	const parent = { set innerHTML(_html: string) { local = new Section(); }, querySelectorAll: (selector: string) => local.querySelectorAll(selector) };
	const document = { activeElement: local.fields[0], getElementById: (id: string) => id === 'oj-local-tests' ? local : parent };
	const context = vm.createContext({ document, HTMLInputElement: Field, HTMLTextAreaElement: Field,
		message: { sections: { 'oj-statement-content': 'new statement', 'oj-local-tests': 'new tests' } },
		animateHeightChange: (_section: unknown, update: () => void) => update(),
	});
	const start = compiled.indexOf('const snapshotSection =');
	const end = compiled.indexOf('const getActiveTabId =', start);
	vm.runInContext(compiled.slice(start, end), context);
	const updateStart = compiled.indexOf('const hasCountdownUpdate =');
	const updateEnd = compiled.indexOf('syncRatingDialog();', updateStart);
	vm.runInContext(compiled.slice(updateStart, updateEnd), context);
	assert.deepEqual(local.fields.map(field => field.value), ['unsaved draft', 'pending new test']);
	assert.equal(local.details[0].open, true);
	assert.equal(document.activeElement, local.fields[0]);
	assert.equal(local.fields[0].selectionStart, 3);
});

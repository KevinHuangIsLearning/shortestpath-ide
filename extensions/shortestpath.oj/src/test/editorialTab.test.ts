/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import * as vm from 'node:vm';
import * as access from '../editorialAccess';
import * as protocol from '../shortestpathOjProtocol';
import { bindPayload } from './fixtures';

const editorial: Extract<protocol.EditorialResult, { state: 'available' }> = {
	state: 'available',
	simpleContent: { format: 'markdown', content: 'simple external text' },
	content: { format: 'markdown', content: 'detailed external text' },
	solutionCode: 'int main() { return 0; }',
	hints: [{ hintId: '123', seq: 1, question: { format: 'markdown', content: 'question' }, answer: { format: 'markdown', content: 'answer' }, questionLiked: false, answerLiked: false, questionLikeCount: 3, answerLikeCount: 1 }],
};

function createHarness() {
	const source = fs.readFileSync(path.resolve(__dirname, '../extension.js'), 'utf8');
	const posted: object[] = [];
	const created: { options: { modal?: boolean; modalCloseOnly?: boolean } }[] = [];
	const context = vm.createContext({
		console, setTimeout, clearTimeout,
		editorialAccess_1: access,
		shortestpathOjProtocol_1: protocol,
		localization_1: { localize: (text: string) => text, localizeWebviewHtml: (html: string) => html },
		vscode: { window: { createWebviewPanel: (_type: string, _title: string, _column: object, options: { modal?: boolean; modalCloseOnly?: boolean }) => {
			created.push({ options });
			return { webview: { onDidReceiveMessage() { }, postMessage(message: object) { posted.push(message); } }, onDidDispose() { } };
		} } },
		getEditorialPanelHtml: () => '<html>split report</html>',
		OutcomeUnknownError: class extends Error { },
	});
	const start = source.indexOf('class ShortestPathOjProblemPanel');
	const end = source.indexOf('async function activate(', start);
	vm.runInContext(`${source.slice(start, end)}; globalThis.Panel = ShortestPathOjProblemPanel;`, context);
	const panel = new context.Panel({}, '', {}, new Set());
	panel.state = {
		problem: protocol.parseProblemBindData(structuredClone(bindPayload)),
		connected: true, operationsInFlight: new Set(),
		editorialRemainingReceivedAtMs: Date.now(),
	};
	panel.panel = { dispose() { throw new Error('The problem panel must stay open.'); }, webview: { postMessage(message: object) { posted.push(message); } } };
	panel.render = () => { };
	panel.showOperationToast = () => { };
	panel.findBoundSourceEditorColumn = () => 1;
	panel.refreshHintModal = () => { throw new Error('Report likes must not open a hint modal.'); };
	return { panel, posted, created };
}

test('cached and newly loaded reports stay in the problem tab; only the explicit action opens a modal', async () => {
	const { panel, created } = createHarness();
	let requests = 0;
	panel.actions.editorial = async () => { requests++; return editorial; };
	panel.actions.saveEditorial = async () => { };
	await panel.handleMessage({ command: 'editorial' });
	assert.equal(panel.state.editorial, editorial);
	assert.equal(created.length, 0);
	panel.state.connected = false;
	await panel.handleMessage({ command: 'editorial' });
	assert.equal(requests, 1);
	await panel.handleMessage({ command: 'editorialModal' });
	assert.equal(created.length, 1);
	assert.equal(created[0].options.modal, true);
	assert.equal(created[0].options.modalCloseOnly, true);
});

test('cancelled, locked and disconnected reports do not open a modal or populate a cache', async () => {
	const { panel, created } = createHarness();
	let requests = 0;
	panel.actions.editorial = async () => { requests++; return undefined; };
	await panel.handleMessage({ command: 'editorial' });
	assert.equal(panel.editorialRequestInFlight, false);
	assert.equal(panel.state.cachedEditorial, undefined);
	panel.state.problem.state.editorial.remainingMs = 60_000;
	await panel.handleMessage({ command: 'editorial' });
	panel.state.connected = false;
	await panel.handleMessage({ command: 'editorial' });
	await panel.handleMessage({ command: 'editorialModal' });
	assert.equal(requests, 1);
	assert.equal(created.length, 0);
});

test('connected contest editorial requests recheck the website despite an unavailable capability snapshot', async () => {
	const { panel } = createHarness();
	panel.state.problem.target = { kind: 'contest', problemId: '1', contestId: '2', contestRef: 'e2e', contestProblemId: '3', problemLabel: 'A' };
	panel.state.problem.capabilities.editorial = false;
	let requests = 0;
	panel.actions.editorial = async () => { requests++; return editorial; };
	panel.actions.saveEditorial = async () => { };
	await panel.handleMessage({ command: 'editorial' });
	panel.state.editorial = undefined;
	await panel.handleMessage({ command: 'editorial' });
	assert.deepEqual({ requests, report: panel.state.editorial }, { requests: 1, report: editorial });
});

test('duplicate requests share one flight and stale responses cannot fill a different problem', async () => {
	const { panel } = createHarness();
	let finish!: (result: protocol.EditorialResult) => void;
	let requests = 0;
	let saves = 0;
	panel.actions.editorial = () => { requests++; return new Promise(resolve => { finish = resolve; }); };
	panel.actions.saveEditorial = async () => { saves++; };
	const request = panel.handleMessage({ command: 'editorial' });
	await panel.handleMessage({ command: 'editorial' });
	assert.equal(requests, 1);
	panel.state = { ...panel.state, editorial: undefined, cachedEditorial: undefined };
	panel.editorialRequestToken++;
	panel.editorialRequestInFlight = false;
	finish(editorial);
	await request;
	assert.equal(panel.state.editorial, undefined);
	assert.equal(saves, 0);
});

test('report likes update the report cache without opening a hint modal', async () => {
	const { panel } = createHarness();
	panel.state.editorial = editorial;
	panel.actions.like = async () => ({ hintId: '123', target: 'question', liked: true, questionLiked: true, answerLiked: false, questionLikeCount: 4, answerLikeCount: 1 });
	panel.actions.saveEditorial = async () => { };
	await panel.handleMessage({ command: 'editorialLike', hintId: '123', target: 'question', liked: true });
	assert.equal(panel.state.editorial.hints[0].questionLiked, true);
	assert.equal(panel.state.cachedEditorial.hints[0].questionLikeCount, 4);
	assert.equal(panel.state.operationsInFlight.size, 0);
});

test('editorial tab renders loading and lock states without an extra view button', () => {
	const source = fs.readFileSync(path.resolve(__dirname, '../extension.js'), 'utf8');
	const context = vm.createContext({
		localization_1: { localize: (text: string) => text }, editorialAccess_1: access,
		escapeHtml: (text: string) => text, formatDuration: () => '1 分钟',
	});
	const start = source.indexOf('function renderEditorialTab(');
	const end = source.indexOf('function renderEditorialContents(', start);
	vm.runInContext(`${source.slice(start, end)}; globalThis.render = renderEditorialTab;`, context);
	const problem = protocol.parseProblemBindData(structuredClone(bindPayload));
	problem.target = { kind: 'contest', problemId: '1', contestId: '2', contestRef: 'e2e', contestProblemId: '3', problemLabel: 'A' };
	problem.capabilities.editorial = false;
	problem.state.editorial.remainingMs = 0;
	const state = { problem, connected: true, editorialRemainingReceivedAtMs: Date.now() };
	assert.equal(context.render(state, false), '');
	assert.equal(context.render({ ...state, connected: false }, false), '');
	assert.match(context.render(state, true), /role="status">正在加载解题报告…/);
	problem.state.editorial.remainingMs = 60_000;
	const locked = context.render(state, false);
	assert.match(locked, /editorial-countdown/);
	assert.doesNotMatch(locked, /<button/);
});

test('streamed and modal reports render the same external contents in tips, solution, code order', () => {
	const source = fs.readFileSync(path.resolve(__dirname, '../extension.js'), 'utf8');
	const context = vm.createContext({
		localization_1: { localize: (text: string) => text },
		editorialAccess_1: access,
		escapeHtml: (text: string) => text, escapeAttribute: (text: string) => text,
		renderMarkdownContent: (content: { content: string }) => `<pre>${content.content}</pre>`,
		renderProblemMarkdown: (text: string) => text,
		renderLikeButton: (_id: string, _target: string, _likes: object, enabled: boolean, loading: boolean) => `<button${!enabled || loading ? ' disabled' : ''}></button>`,
	});
	const start = source.indexOf('function renderEditorialTab(');
	const end = source.indexOf('function getEditorialPanelHtml(', start);
	vm.runInContext(`${source.slice(start, end)}; globalThis.render = renderEditorialTab;`, context);
	const report = { ...editorial, subtaskSolutions: [{ title: 'external subtask title', kind: 'partial', appliesToSubtasks: ['1'], acceptedSubtasks: ['1'], solution: 'external subtask solution', acCode: '' }] };
	const html = context.render({ editorial: report, problem: bindPayload.problem, connected: false, operationsInFlight: new Set() }, false);
	assert.match(html, /data-command="editorialModal"/);
	assert.match(html, /title="弹框查看" aria-label="弹框查看"><svg/);
	assert.deepEqual([...html.matchAll(/<details[^>]*data-persist-key="([^"]+)"[^>]* open/g)].map(match => match[1]), ['editorial-hints', 'editorial-simple', 'editorial-detailed', 'editorial-subtask:0', 'editorial-code']);
	assert.match(html, /data-i18n-ignore open><summary><h2>external subtask title<\/h2><\/summary>/);
	assert.ok(html.indexOf('提示回顾') < html.indexOf('简化题解'));
	assert.ok(html.indexOf('详细题解') < html.indexOf('参考代码'));
	assert.match(html, /data-i18n-ignore>.*simple external text/);
	assert.match(html, /int main\(\) \{ return 0; \}/);
	assert.match(html, /<button disabled>/);
});

test('modal refresh restores collapsed sections and resizing preserves their state', () => {
	const source = fs.readFileSync(path.resolve(__dirname, '../extension.js'), 'utf8');
	const start = source.indexOf('const savedLayout = vscode.getState()');
	const end = source.indexOf('const updateEditorialLayout =', start);
	let saved = { editorialCodeWidth: 45, editorialSections: { 'editorial-hints': false, 'editorial-simple': true, 'editorial-detailed': false } };
	const sections = Object.keys(saved.editorialSections).map(key => ({ dataset: { persistKey: key }, open: true }));
	let toggle!: (event: { target: object }) => void;
	const context = vm.createContext({
		vscode: { getState: () => saved, setState: (state: typeof saved) => { saved = state; } },
		document: { querySelectorAll: () => sections, addEventListener: (_type: string, listener: typeof toggle) => { toggle = listener; } },
	});
	vm.runInContext(source.slice(start, end), context);
	assert.deepEqual(sections.map(section => section.open), [false, true, false]);
	sections[1].open = false;
	toggle({ target: sections[1] });
	vm.runInContext('editorialCodeWidth = 60; saveEditorialLayout();', context);
	assert.equal(JSON.stringify(saved), JSON.stringify({ editorialCodeWidth: 60, editorialSections: { 'editorial-hints': false, 'editorial-simple': false, 'editorial-detailed': false } }));
});

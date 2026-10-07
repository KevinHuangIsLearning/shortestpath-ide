/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as judgeDisplay from '../judgeDisplay';
import * as protocol from '../shortestpathOjProtocol';
import { bindPayload } from './fixtures';
import { validatePublicProblemContent } from '../publicProblemValidation';

const source = (): string => fs.readFileSync(path.resolve(__dirname, '../extension.js'), 'utf8');

test('statement sections and samples are independently collapsible without rewriting external content', () => {
	const compiled = source();
	const start = compiled.indexOf('function renderStatement(');
	const end = compiled.indexOf('function renderStatementVersionControl(', start);
	const context = vm.createContext({
		localization_1: { localize: (text: string) => text },
		getSelectedStatementProblem: (problem: object) => problem,
		renderPublicContent: () => '',
		renderMarkdownContent: (content: { content: string }) => content.content,
		renderProblemMarkdown: (text: string) => text,
		escapeHtml: (text: string) => text,
	});
	vm.runInContext(`${compiled.slice(start, end)}; globalThis.render = renderStatement;`, context);
	for (const integrated of [false, true]) {
		const html: string = context.render(bindPayload.problem, [], 0, integrated);
		assert.deepStrictEqual([...html.matchAll(/data-persist-key="([^"]+)" open><summary[^>]*><h2>([^<]+)<\/h2>/g)].map(match => [match[1], match[2]]), [
			['statement:description', '题目描述'], ['statement:input', '输入格式'], ['statement:output', '输出格式'], ['statement:constraints', '数据范围'], ['statement:samples', '样例'],
		]);
		assert.ok(html.includes(`<div data-i18n-ignore>${bindPayload.problem.statement.description.content}</div></details>`));
		assert.equal(html.includes('id="oj-local-tests"'), integrated);
		assert.equal(html.includes('<h2>样例</h2><div id="oj-local-tests-toolbar"></div></summary>'), integrated);
	}
});

function createPanel() {
	const compiled = source();
	const posted: object[] = [];
	const context = vm.createContext({
		console, setTimeout, clearTimeout,
		hintAnswerCache: new Map(), hintAnswerCacheKey: (ref: string, id: string) => `${ref}/${id}`,
		shortestpathOjProtocol_1: protocol,
		localization_1: { localize: (text: string) => text },
		OutcomeUnknownError: class extends Error { },
	});
	const start = compiled.indexOf('class ShortestPathOjProblemPanel');
	const end = compiled.indexOf('async function activate(', start);
	vm.runInContext(`${compiled.slice(start, end)}; globalThis.Panel = ShortestPathOjProblemPanel;`, context);
	const panel = new context.Panel({}, '', {}, new Set());
	panel.state = {
		problem: protocol.parseProblemBindData(structuredClone(bindPayload)), connected: true,
		answers: new Map(), hintMessages: new Map(), operationsInFlight: new Set(),
		disconnectedSubmissions: new Set(), stressTasks: new Map(), disconnectedStressTasks: new Set(),
	};
	panel.state.problem.state.timer.capturedAtUnixMs = Date.now();
	panel.panel = { webview: { postMessage: (message: object) => posted.push(structuredClone(message)) } };
	panel.render = () => { };
	panel.showOperationToast = () => { };
	return { panel, posted };
}

test('contest submission bypasses the connection gate without starting a bridge operation', async () => {
	const { panel } = createPanel();
	panel.state.connected = false;
	panel.longRunningOperationNoticeVisible = true;
	panel.state.problem.target = { kind: 'contest', problemId: '1', contestId: '2', contestRef: 'e2e', contestProblemId: '3', problemLabel: 'A' };
	const submitted: string[] = [];
	panel.actions.submit = async (problem: protocol.ImportedProblem) => { submitted.push(problem.url); };
	await panel.handleMessage({ command: 'submit' });
	assert.deepEqual({ submitted, operations: [...panel.state.operationsInFlight], status: panel.state.statusMessage }, {
		submitted: [panel.state.problem.url], operations: [], status: undefined,
	});
});

test('contest submission opens the original OJ in the default browser without invoking the bridge', async () => {
	const compiled = source();
	const start = compiled.indexOf('async function submitProblem(');
	const end = compiled.indexOf('\nasync function ', start + 1);
	const opened: string[] = [];
	const context = vm.createContext({ vscode: {
		Uri: { parse: (url: string) => url },
		env: { openExternal: async (url: string) => { opened.push(url); return true; } },
	} });
	vm.runInContext(`${compiled.slice(start, end)}; globalThis.submit = submitProblem;`, context);
	const problem = protocol.parseProblemBindData(structuredClone(bindPayload));
	problem.target = { kind: 'contest', problemId: '1', contestId: '2', contestRef: 'e2e', contestProblemId: '3', problemLabel: 'A' };
	problem.url = 'https://shortestpath.cn/contests/e2e/problems/A';
	problem.capabilities.submission.enabled = false;
	problem.capabilities.submission.languages = [];
	const sources = ['https://atcoder.jp/contests/abc400/tasks/abc400_a', 'https://codeforces.com/contest/2100/problem/A'];
	for (const sourceUrl of sources) {
		problem.publicContent = validatePublicProblemContent({ source_url: sourceUrl });
		await context.submit(problem, {}, {}, new Map());
	}
	for (const sourceUrl of [undefined, '', 'javascript:alert(1)']) {
		problem.publicContent = validatePublicProblemContent({ source_url: sourceUrl });
		await context.submit(problem, {}, {}, new Map());
	}
	problem.publicContent = undefined;
	await context.submit(problem, {}, {}, new Map());
	assert.deepEqual(opened, sources);
});

test('inline hints fetch accepted answers once and remain available offline without opening a modal', async () => {
	const { panel, posted } = createPanel();
	panel.state.problem.state.timer.accepted = true;
	let requests = 0;
	panel.actions.answer = async () => {
		requests++;
		return { state: 'revealed', hintId: '123', answer: { format: 'markdown', content: 'external answer' }, viewed: true, answerLiked: false, answerLikeCount: 1 };
	};
	await panel.handleMessage({ command: 'openHint', hintId: '123' });
	await panel.handleMessage({ command: 'openHint', hintId: '123' });
	panel.state.connected = false;
	panel.state.answers.clear();
	await panel.handleMessage({ command: 'openHint', hintId: '123' });
	assert.deepEqual({ requests, posted }, { requests: 1, posted: [] });
});

test('an expired hint reads its question only when clicked, without revealing an answer or retrying', async () => {
	const { panel, posted } = createPanel();
	panel.state.problem.state.hints[0].unlocked = false;
	panel.state.problem.state.hints[0].remainingMs = 60_000;
	let reads = 0;
	let answers = 0;
	panel.actions.answer = async () => { answers++; };
	panel.actions.refreshHints = async () => {
		reads++;
		panel.state.problem.state.hints[0].unlocked = true;
	};
	await panel.handleMessage({ command: 'openHint', hintId: '123' });
	assert.deepEqual({ reads, answers, posted }, { reads: 0, answers: 0, posted: [] });
	panel.state.problem.state.timer.capturedAtUnixMs -= 60_001;
	await panel.handleMessage({ command: 'openHint', hintId: '123' });
	await panel.handleMessage({ command: 'openHint', hintId: '123' });
	assert.deepEqual({ reads, answers, posted }, { reads: 1, answers: 0, posted: [{ type: 'expandHint', hintId: '123' }] });
});

test('verification blocks static tab and hint requests while cached contents remain readable', async () => {
	const { panel } = createPanel();
	panel.state.problem.state.timer.accepted = true;
	panel.longRunningOperationNoticeVisible = true;
	const requests: string[] = [];
	panel.actions.answer = async () => { requests.push('answer'); };
	panel.actions.editorial = async () => { requests.push('editorial'); };
	panel.actions.submit = async () => { requests.push('submit'); };
	await panel.handleMessage({ command: 'openHint', hintId: '123' });
	await panel.handleMessage({ command: 'editorial' });
	await panel.handleMessage({ command: 'answer', hintId: '123' });
	await panel.handleMessage({ command: 'submit' });
	assert.deepEqual(requests, []);
	const cachedEditorial = { state: 'available' };
	panel.state.cachedEditorial = cachedEditorial;
	panel.state.answers.set('123', { format: 'markdown', content: 'cached answer' });
	await panel.handleMessage({ command: 'editorial' });
	await panel.handleMessage({ command: 'openHint', hintId: '123' });
	assert.equal(panel.state.editorial, cachedEditorial);
	assert.deepEqual(requests, []);
	panel.longRunningOperationNoticeVisible = false;
	await panel.handleMessage({ command: 'submit' });
	assert.deepEqual(requests, ['submit']);
});

test('a hint countdown enables its click action locally without asking the website to synchronize', () => {
	const compiled = fs.readFileSync(path.resolve(__dirname, '../problemView.js'), 'utf8');
	const start = compiled.indexOf('/* ---- Hint countdown ---- */');
	const end = compiled.indexOf('/* ---- Modal infrastructure ---- */', start);
	let now = 1000;
	let tick!: () => void;
	const messages: object[] = [];
	const countdown = { textContent: '', remove() { } };
	const label = { textContent: '' };
	class Button {
		disabled = true;
		ariaLabel = '';
		dataset = { remainingMs: '10000' };
		classList = { toggle() { } };
		querySelector(selector: string) { return selector === '.hint-countdown' ? countdown : selector === '.hint-lock-label' ? label : null; }
		closest() { return null; }
		removeAttribute() { this.dataset.remainingMs = ''; }
		setAttribute(_name: string, value: string) { this.ariaLabel = value; }
	}
	const button = new Button();
	vm.runInNewContext(compiled.slice(start, end), {
		Date: { now: () => now }, body: { dataset: { connected: 'true' } }, HTMLButtonElement: Button,
		document: { querySelectorAll: () => button.dataset.remainingMs ? [button] : [], addEventListener() { } },
		setInterval: (callback: () => void) => { tick = callback; return 1; }, clearInterval() { },
		vscode: { postMessage: (message: object) => messages.push(message) },
	});
	assert.equal(button.disabled, true);
	now += 10_000;
	tick();
	assert.deepEqual({ enabled: !button.disabled, label: label.textContent, aria: button.ariaLabel, messages }, { enabled: true, label: '查看提示', aria: '查看提示', messages: [] });
	now += 120_000;
	tick();
	assert.deepEqual(messages, []);
});

test('connection restores submission history and watches without requiring a refresh action', async () => {
	const { panel } = createPanel();
	const calls: string[] = [];
	panel.state.problem.target = { kind: 'problem' };
	panel.state.disconnectedSubmissions.add('45');
	panel.actions.refreshHistory = async () => { calls.push('history'); };
	panel.actions.watchSubmission = async (_problem: object, id: string) => { calls.push(`watch:${id}`); };
	panel.actions.loadStress = async () => ({ tasks: [] });
	await panel.restoreObservations();
	assert.deepEqual(calls, ['history', 'watch:45']);
	calls.length = 0;
	panel.state.connected = false;
	await panel.restoreObservations();
	panel.state.connected = true;
	delete panel.state.problem.target;
	await panel.restoreObservations();
	assert.deepEqual(calls, ['watch:45']);
});

test('hint rendering keeps external content inline and locked hints cannot expand', () => {
	const compiled = source();
	const start = compiled.indexOf('function renderHints(');
	const end = compiled.indexOf('function renderEditorialTab(', start);
	const context = vm.createContext({
		localization_1: { localize: (text: string) => text },
		escapeHtml: (text: string) => text, escapeAttribute: (text: string) => text,
		renderMarkdownContent: (content: { content: string }) => `<p>${content.content}</p>`,
		formatDuration: () => '00:01:00',
	});
	vm.runInContext(`${compiled.slice(start, end)}; globalThis.render = renderHints;`, context);
	const { panel } = createPanel();
	panel.state.answers.set('123', { format: 'markdown', content: 'external answer' });
	const html = context.render(panel.state);
	assert.match(html, /<details class="hint-item" data-persist-key="hint:123" data-hint-id="123"><summary/);
	assert.match(html, /data-i18n-ignore><p>external answer/);
	assert.doesNotMatch(html, /modal|closeModal|openHintModal/);
	panel.state.problem.state.hints[0].unlocked = false;
	panel.state.problem.state.hints[0].remainingMs = 60_000;
	assert.doesNotMatch(context.render(panel.state), /<details|external answer/);
});

test('summary clicks request an answer only when expanding; collapse remains local', () => {
	const compiled = fs.readFileSync(path.resolve(__dirname, '../problemView.js'), 'utf8');
	const start = compiled.indexOf('/* ---- Click handler ---- */');
	const end = compiled.indexOf(`document.addEventListener('submit'`, start);
	const messages: object[] = [];
	const hint = { open: false, dataset: { hintId: '123' } };
	let click!: (event: { target: Summary }) => void;
	class Summary {
		parentElement = hint;
		closest(selector: string): Summary | null { return selector === '.hint-item > summary' ? this : null; }
	}
	vm.runInNewContext(compiled.slice(start, end), {
		document: { addEventListener: (name: string, listener: typeof click) => { if (name === 'click') { click = listener; } } },
		Element: Summary, vscode: { postMessage: (message: object) => messages.push(message) },
	});
	click({ target: new Summary() });
	hint.open = true;
	click({ target: new Summary() });
	assert.equal(JSON.stringify(messages), JSON.stringify([{ command: 'openHint', hintId: '123' }]));
});

test('saved submission summaries render without the removed notice or manual refresh control', () => {
	const compiled = source();
	const start = compiled.indexOf('function renderSubmissions(');
	const end = compiled.indexOf('function renderSubmissionStatus(', start);
	const context = vm.createContext({
		localization_1: { localize: (text: string) => text },
		escapeHtml: (text: string) => text, escapeAttribute: (text: string) => text,
		compareSubmissionIdDescending: () => 0, isLiveSubmission: () => false,
		judgeDisplay_1: judgeDisplay, renderSubmissionStatus: () => 'AC',
	});
	vm.runInContext(`${compiled.slice(start, end)}; globalThis.render = renderSubmissions;`, context);
	const { panel } = createPanel();
	panel.state.submissions = new Map([['45', { submissionId: '45', status: 'AC', score: 100, maxTimeMs: 1, maxMemoryKB: 10 }]]);
	const html = context.render(panel.state);
	assert.match(html, /提交 45/);
	assert.doesNotMatch(html, /refreshHistory|刷新提交记录|本地保存的历史记录|<details/);
});

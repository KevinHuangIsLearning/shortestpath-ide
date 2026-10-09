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
	const opened: string[] = [];
	const context = vm.createContext({
		console, setTimeout, clearTimeout, openUrl: async (url: string) => { opened.push(url); },
		hintAnswerCache: new Map(), hintAnswerCacheKey: (ref: string, id: string) => `${ref}/${id}`,
		shortestpathOjProtocol_1: protocol,
		hasIncompatibleProblemState: () => false,
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
	return { panel, posted, opened };
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

test('contest submission routes the original OJ through the browsing opener without invoking the bridge', async () => {
	const compiled = source();
	const start = compiled.indexOf('async function submitProblem(');
	const end = compiled.indexOf('\nasync function ', start + 1);
	const opened: string[] = [];
	const context = vm.createContext({ openUrl: async (url: string) => { opened.push(url); }, vscode: {
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

test('statement website and HTTPS link messages use the browsing opener; unsafe links are ignored', async () => {
	const { panel, opened } = createPanel();
	await panel.handleMessage({ command: 'openWebsite' });
	await panel.handleMessage({ command: 'openUrl', url: 'https://shortestpath.cn/editorial/1' });
	await panel.handleMessage({ command: 'openUrl', url: 'command:workbench.action.quit' });
	await panel.handleMessage({ command: 'openUrl', url: 42 });
	assert.deepEqual(opened, [panel.state.problem.url, 'https://shortestpath.cn/editorial/1']);
});

test('webview HTTP links prevent the default external opener and forward literal URLs', () => {
	const compiled = fs.readFileSync(path.resolve(__dirname, '../problemView.js'), 'utf8');
	const start = compiled.indexOf('document.addEventListener(\'click\', event => {');
	const prefix = compiled.slice(compiled.indexOf('{', start) + 1, compiled.indexOf('const summary', start));
	let href = 'https://shortestpath.cn/editorial/1?x=2&y=3';
	let prevented = 0;
	const messages: object[] = [];
	class Element {
		closest() { return { getAttribute: () => href }; }
	}
	const context = vm.createContext({ Element, vscode: { postMessage: (message: object) => messages.push(structuredClone(message)) } });
	vm.runInContext(`globalThis.click = event => { ${prefix} };`, context);
	context.click({ target: new Element(), preventDefault: () => { prevented++; } });
	href = '#sample';
	context.click({ target: new Element(), preventDefault: () => { prevented++; } });
	assert.deepEqual({ prevented, messages }, { prevented: 1, messages: [{ command: 'openUrl', url: 'https://shortestpath.cn/editorial/1?x=2&y=3' }] });
});

test('website opener switches to browsing before opening the integrated URL', async () => {
	const compiled = source();
	const start = compiled.indexOf('async function openUrl(');
	const calls: unknown[][] = [];
	const context = vm.createContext({ vscode: { commands: {
		getCommands: async () => ['shortestpath.browser.open'],
		executeCommand: async (...args: unknown[]) => { calls.push(args); },
	} } });
	const body = compiled.slice(start, compiled.indexOf('\n}', start) + 2);
	vm.runInContext(`${body}; globalThis.open = openUrl;`, context);
	await context.open('https://shortestpath.cn/problem/1');
	assert.deepEqual(calls, [['shortestpath.mode.browse'], ['shortestpath.browser.open', 'https://shortestpath.cn/problem/1']]);
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


test('likes update panel state before the first render and website request, then reconcile or roll back independently', async () => {
	const { panel } = createPanel();
	const markdown = { format: 'markdown', content: '' };
	panel.state.editorial = { state: 'available', hints: [{ hintId: '123', seq: 1, question: markdown, answer: markdown, questionLiked: false, answerLiked: false, questionLikeCount: 3, answerLikeCount: 1 }], simpleContent: markdown, content: markdown, solutionCode: '' };
	panel.state.cachedEditorial = panel.state.editorial;
	const snapshot = () => structuredClone(panel.state.problem.state.hints[0].likes);
	const renders: ReturnType<typeof snapshot>[] = [];
	panel.render = () => { renders.push(snapshot()); };
	const pending = new Map<string, { resolve: (result: protocol.LikeResult) => void; reject: (error: Error) => void }>();
	panel.actions.like = (problem: protocol.ImportedProblem, _hintId: string, target: 'question' | 'answer', liked: boolean) => {
		assert.equal(problem.state.hints[0].likes[target].liked, liked);
		assert.deepEqual(renders.at(-1), snapshot());
		return new Promise<protocol.LikeResult>((resolve, reject) => { pending.set(target, { resolve, reject }); });
	};
	const saved: protocol.EditorialResult[] = [];
	panel.actions.saveEditorial = async (_problem: protocol.ImportedProblem, editorial: protocol.EditorialResult) => { saved.push(structuredClone(editorial)); };
	const question = panel.handleMessage({ command: 'like', hintId: '123', target: 'question', liked: true });
	const answer = panel.handleMessage({ command: 'editorialLike', hintId: '123', target: 'answer', liked: true });
	await panel.handleMessage({ command: 'like', hintId: '123', target: 'question', liked: true });
	assert.equal(pending.size, 2);
	panel.updateProblemState(panel.state.problem.ref, protocol.parseProblemBindData(structuredClone(bindPayload)).state);
	panel.render();
	assert.deepEqual(renders[0], { question: { liked: true, count: 4 }, answer: { liked: false, count: 1 } });
	assert.deepEqual(snapshot(), { question: { liked: true, count: 4 }, answer: { liked: true, count: 2 } });
	pending.get('question')!.resolve({ hintId: '123', target: 'question', liked: true, questionLiked: true, questionLikeCount: 12, answerLiked: false, answerLikeCount: 1 });
	await question;
	assert.deepEqual(snapshot(), { question: { liked: true, count: 12 }, answer: { liked: true, count: 2 } });
	assert.equal(panel.state.editorial.hints[0].answerLiked, true);
	assert.equal(saved[0].state, 'available');
	if (saved[0].state === 'available') { assert.equal(saved[0].hints[0].answerLiked, false); }
	pending.get('answer')!.reject(new Error('sync failed'));
	await answer;
	assert.deepEqual(snapshot(), { question: { liked: true, count: 12 }, answer: { liked: false, count: 1 } });
	assert.deepEqual(panel.state.editorial, panel.state.cachedEditorial);
	const unlike = panel.handleMessage({ command: 'like', hintId: '123', target: 'question', liked: false });
	assert.deepEqual(snapshot().question, { liked: false, count: 11 });
	pending.get('question')!.reject(new Error('sync failed'));
	await unlike;
	assert.deepEqual(snapshot().question, { liked: true, count: 12 });
	assert.equal(panel.state.operationsInFlight.size, 0);
});


test('hint like rollback restores distinct hint and editorial snapshots', async () => {
	const { panel } = createPanel();
	const markdown = { format: 'markdown', content: '' };
	panel.state.editorial = { state: 'available', hints: [{ hintId: '123', seq: 1, question: markdown, answer: markdown, questionLiked: true, answerLiked: false, questionLikeCount: 8, answerLikeCount: 1 }], simpleContent: markdown, content: markdown, solutionCode: '' };
	let rejectRequest: (error: Error) => void = () => { throw new Error('Missing request'); };
	panel.actions.like = () => new Promise<protocol.LikeResult>((_resolve, reject) => { rejectRequest = reject; });
	const request = panel.handleMessage({ command: 'like', hintId: '123', target: 'question', liked: true });
	assert.deepEqual(structuredClone(panel.state.problem.state.hints[0].likes.question), { liked: true, count: 4 });
	rejectRequest(new Error('sync failed'));
	await request;
	assert.deepEqual(structuredClone(panel.state.problem.state.hints[0].likes.question), { liked: false, count: 3 });
	assert.equal(panel.state.editorial.hints[0].questionLiked, true);
	assert.equal(panel.state.editorial.hints[0].questionLikeCount, 8);
});


test('editorial unlike uses the displayed editorial count when hint data differs', async () => {
	const { panel } = createPanel();
	const markdown = { format: 'markdown', content: '' };
	panel.state.editorial = { state: 'available', hints: [{ hintId: '123', seq: 1, question: markdown, answer: markdown, questionLiked: true, answerLiked: false, questionLikeCount: 8, answerLikeCount: 1 }], simpleContent: markdown, content: markdown, solutionCode: '' };
	let rejectRequest: (error: Error) => void = () => { throw new Error('Missing request'); };
	panel.actions.like = () => new Promise<protocol.LikeResult>((_resolve, reject) => { rejectRequest = reject; });
	const request = panel.handleMessage({ command: 'editorialLike', hintId: '123', target: 'question', liked: false });
	assert.deepEqual(structuredClone(panel.state.problem.state.hints[0].likes.question), { liked: false, count: 7 });
	assert.equal(panel.state.editorial.hints[0].questionLikeCount, 7);
	rejectRequest(new Error('sync failed'));
	await request;
	assert.deepEqual(structuredClone(panel.state.problem.state.hints[0].likes.question), { liked: false, count: 3 });
	assert.equal(panel.state.editorial.hints[0].questionLikeCount, 8);
});

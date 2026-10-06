/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { bindPayload } from './fixtures';
import { parseProblemBindData } from '../shortestpathOjProtocol';
import { validatePublicProblemContent } from '../publicProblemValidation';

function render(connected: boolean, recoveryState?: string, verification = false, contest = false, sourceUrl = 'https://atcoder.jp/contests/abc400/tasks/abc400_a') {
	const compiled = fs.readFileSync(path.resolve(__dirname, '../extension.js'), 'utf8');
	const start = compiled.indexOf('function renderProblemViewSections(');
	const end = compiled.indexOf('\nfunction getProblemWebviewHtml', start);
	const context = vm.createContext({
		localization_1: { localize: (s: string) => s },
		escapeHtml: (s: string) => s,
		getSelectedStatementProblem: (s: object) => s,
		renderProblemRating: (state: { connected: boolean }) => String(state.connected), renderRatingPrompt: () => '', renderInformation: () => '',
		renderStatement: () => '<p data-i18n-ignore>cached statement</p>',
		renderHints: (state: { connected: boolean }) => String(state.connected),
		renderEditorialTab: (state: { connected: boolean }) => String(state.connected),
		renderSubmissions: (state: { connected: boolean }) => String(state.connected),
	});
	vm.runInContext(`${compiled.slice(start, end)}; globalThis.render = renderProblemViewSections`, context);
	const problem = parseProblemBindData(structuredClone(bindPayload));
	if (contest) {
		problem.target = { kind: 'contest', problemId: '1', contestId: '2', contestRef: 'e2e', contestProblemId: '3', problemLabel: 'A' };
		problem.publicContent = validatePublicProblemContent({ source_url: sourceUrl });
		problem.capabilities.submission.enabled = false;
		problem.capabilities.submission.languages = [];
	}
	return context.render({
		problem, connected, recoveryState,
		statusMessage: '正在重新连接…', operationsInFlight: new Set(), previousStatements: [],
	}, verification, undefined, false);
}

test('contest submission opens the website even when bridge submission is unavailable', () => {
	for (const connected of [false, true]) {
		for (const verification of [false, true]) {
			assert.doesNotMatch(render(connected, 'verification_required', verification, true).submissionButton, / disabled/);
		}
	}
});

test('contest submission is disabled without a usable original OJ address', () => {
	for (const sourceUrl of ['', 'javascript:alert(1)']) {
		assert.match(render(true, undefined, false, true, sourceUrl).submissionButton, / disabled/);
	}
});

test('cached statement stays available during background recovery without a login gate or enabled submission', () => {
	for (const status of [undefined, 'connecting', 'error']) {
		const sections = render(false, status);
		assert.deepEqual({ connected: sections.connected, gate: sections.connectionGate, statement: sections.statement, submissionDisabled: sections.submissionButton.includes(' disabled') }, {
			connected: false, gate: '', statement: '<p data-i18n-ignore>cached statement</p>', submissionDisabled: true,
		});
	}
	assert.match(render(false, 'error').status, /data-command="retryConnection"/);
	const css = fs.readFileSync(path.resolve(__dirname, '../../resources/problemView.css'), 'utf8');
	assert.doesNotMatch(css, /body\[data-connected=['"]false['"]\]\s+#oj-problem-content/);
	assert.doesNotMatch(css, /\.connection-gate-content\s*\{[^}]*min-height/);
});

test('confirmed login, account mismatch and verification provide a website action alongside cached content', () => {
	assert.match(render(false, 'verification_required').connectionGate, /请去网页完成验证/);
	for (const [status, label] of [['login_required', '请去网页登录'], ['account_mismatch', '请去网页登录原账号'], ['verification_required', '请去网页完成验证']]) {
		const gate = render(false, status).connectionGate;
		assert.match(gate, new RegExp(label));
		assert.match(gate, /data-command="loginConnection"/);
		assert.strictEqual((gate.match(/<button/g) ?? []).length, 1);
	}
	assert.strictEqual(render(true).connectionGate, '');
	assert.match(render(true, undefined, true).connectionGate, /请去网页完成验证/);
});

test('initial cached page has disconnected state even when its connection gate is empty', () => {
	const compiled = fs.readFileSync(path.resolve(__dirname, '../extension.js'), 'utf8');
	const start = compiled.indexOf('function getProblemWebviewHtml(');
	const end = compiled.indexOf('\nconst difficultyTagMap', start);
	const context = vm.createContext({
		getSelectedStatementProblem: (problem: object) => problem,
		getProblemViewTimer: () => ({ elapsedMs: 0, running: false, accepted: false, capturedAt: 0 }),
		vscode: { Uri: { joinPath: () => '' } },
		judgeDisplay_1: { describeJudgeType: () => '' },
		timerDisplay_1: { formatElapsedTimer: () => '' },
		escapeHtml: (s: string) => s, escapeAttribute: (s: string) => s,
		renderStatementVersionControl: () => '',
		fillTemplate: (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? ''),
	});
	vm.runInContext(`${compiled.slice(start, end)}; globalThis.render = getProblemWebviewHtml;`, context);
	const template = fs.readFileSync(path.resolve(__dirname, '../../resources/problemView.html'), 'utf8');
	const html = context.render({ problem: parseProblemBindData(structuredClone(bindPayload)), previousStatements: [] }, render(false, 'connecting'), template, { asWebviewUri: () => '', cspSource: 'test' }, '');
	assert.match(html, /<body data-connected="false"/);
	assert.match(html, /<div id="oj-connection-gate"><\/div>/);
	assert.match(html, /<div id="oj-statement-content"><p data-i18n-ignore>cached statement<\/p>/);
});

test('a verification notice blocks every online control while leaving the cached statement available', () => {
	const sections = render(true, undefined, true);
	assert.deepEqual({ connected: sections.connected, submissionDisabled: sections.submissionButton.includes(' disabled'), ratingConnected: sections.rating, hintsConnected: sections.hints, editorialConnected: sections.editorial, submissionsConnected: sections.submissions, statement: sections.statement }, {
		connected: false, submissionDisabled: true, ratingConnected: 'false', hintsConnected: 'false', editorialConnected: 'false', submissionsConnected: 'false', statement: '<p data-i18n-ignore>cached statement</p>',
	});
	assert.equal(render(true).connected, true);
	assert.equal(render(true).submissionButton.includes(' disabled'), false);
});

test('webview connection state follows explicit updates independently of gate changes', () => {
	const compiled = fs.readFileSync(path.resolve(__dirname, '../problemView.js'), 'utf8');
	const start = compiled.indexOf('if (message.connected !== undefined)');
	const end = compiled.indexOf('syncRatingDialog();', start);
	const gate = { innerHTML: '' };
	const body = { dataset: { connected: 'true' } };
	const context = vm.createContext({
		body, document: { getElementById: () => gate },
		message: {}, snapshotSection: () => ({}), restoreSection() {},
		animateHeightChange: (_section: object, update: () => void) => update(),
	});
	for (const [connected, html] of [[false, ''], [false, '<button>login</button>'], [true, '']] as const) {
		context.message = { connected, sections: { 'oj-connection-gate': html } };
		vm.runInContext(`{${compiled.slice(start, end)}}`, context);
		assert.deepEqual({ connected: body.dataset.connected, gate: gate.innerHTML }, { connected: String(connected), gate: html });
	}
	context.message = { sections: { 'oj-connection-gate': '<button>fallback</button>' } };
	vm.runInContext(`{${compiled.slice(start, end)}}`, context);
	assert.equal(body.dataset.connected, 'true');
});

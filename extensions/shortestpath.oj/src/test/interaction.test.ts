/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import type { StressTask } from '../shortestpathOjProtocol';

const view = (): string => fs.readFileSync(path.resolve(__dirname, '../problemView.js'), 'utf8');

test('one click submits from the problem panel', () => {
	const source = view();
	const start = source.indexOf('/* ---- Click handler ---- */');
	const end = source.indexOf(`document.addEventListener('submit'`, start);
	assert.ok(start >= 0 && end > start);
	const messages: object[] = [];
	let click: ((event: { target: Button }) => void) | undefined;
	class Button {
		disabled = false;
		dataset = { command: 'submit' };
		closest(selector: string): Button | null { return selector === 'button[data-command]' ? this : null; }
	}
	vm.runInNewContext(source.slice(start, end), {
		document: { addEventListener: (name: string, listener: typeof click) => { if (name === 'click') { click = listener; } } },
		Element: Button,
		vscode: { postMessage: (message: object) => messages.push(message) },
	});
	click!({ target: new Button() });
	assert.equal(JSON.stringify(messages), JSON.stringify([{ command: 'submit' }]));
});

test('clicking the editorial tab sends the request that owns confirmation and access checks', () => {
	const html = fs.readFileSync(path.resolve(__dirname, '../../resources/problemView.html'), 'utf8');
	assert.match(html, /class="tab-button" data-tab="editorial" data-command="editorial"/);
	const source = view();
	const start = source.indexOf('/* ---- Click handler ---- */');
	const end = source.indexOf(`document.addEventListener('submit'`, start);
	const messages: object[] = [];
	let click: ((event: { target: Button }) => void) | undefined;
	class Button {
		disabled = false;
		dataset = { command: 'editorial', tab: 'editorial' };
		closest(selector: string): Button | null { return selector === 'button[data-command]' ? this : null; }
	}
	vm.runInNewContext(source.slice(start, end), {
		document: { addEventListener: (name: string, listener: typeof click) => { if (name === 'click') { click = listener; } } },
		Element: Button, vscode: { postMessage: (message: object) => messages.push(message) },
	});
	click!({ target: new Button() });
	assert.equal(JSON.stringify(messages), JSON.stringify([{ command: 'editorial' }]));
});

test('completion expands a collapsed result once and later updates preserve manual collapse', () => {
	const source = view();
	const start = source.indexOf('const snapshotSection =');
	const end = source.indexOf('const getActiveTabId =', start);
	class Details {
		open = false;
		dataset = { autoExpandKey: '' };
		constructor(readonly key: string) { }
		getAttribute(): string { return this.key; }
	}
	class Section {
		constructor(readonly details: Details[]) { }
		querySelectorAll(selector: string): Details[] { return selector === 'details' ? this.details : []; }
	}
	const context = vm.createContext({ document: { activeElement: null } });
	vm.runInContext(`${source.slice(start, end)}; globalThis.snapshot = snapshotSection; globalThis.restore = restoreSection;`, context);
	const previous = new Details('submission:10');
	const snapshot = context.snapshot(new Section([previous]));
	const completed = new Details('submission:10'); completed.dataset.autoExpandKey = '1112';
	const counterexample = new Details('stress-counterexample:1112'); counterexample.open = true; counterexample.dataset.autoExpandKey = '1112';
	const next = new Section([completed, counterexample]);
	context.restore(next, snapshot);
	assert.deepEqual(next.details.map(detail => detail.open), [true, true]);
	completed.open = false; counterexample.open = false;
	context.restore(next, context.snapshot(next));
	assert.deepEqual(next.details.map(detail => detail.open), [false, false]);
	const inlineHint = new Details('hint:123'); inlineHint.open = true;
	const hints = new Details('editorial-hints');
	const simple = new Details('editorial-simple'); simple.open = true;
	const detailed = new Details('editorial-detailed');
	const reportSnapshot = context.snapshot(new Section([hints, simple, detailed, inlineHint]));
	const refreshedReport = new Section(['editorial-detailed', 'editorial-hints', 'editorial-simple', 'hint:123'].map(key => { const detail = new Details(key); detail.open = true; return detail; }));
	context.restore(refreshedReport, reportSnapshot);
	assert.deepEqual(refreshedReport.details.map(detail => detail.open), [false, false, true, true]);
	const description = new Details('statement:description');
	const samples = new Details('statement:samples'); samples.open = true;
	const code = new Details('editorial-code');
	const sectionSnapshot = context.snapshot(new Section([description, samples, code]));
	const updatedSections = new Section(['statement:samples', 'editorial-code', 'statement:description'].map(key => { const detail = new Details(key); detail.open = true; return detail; }));
	context.restore(updatedSections, sectionSnapshot);
	assert.deepEqual(updatedSections.details.map(detail => detail.open), [true, false, false]);
});

function renderTasks(tasks: StressTask[]): string {
	const source = fs.readFileSync(path.resolve(__dirname, '../extension.js'), 'utf8');
	const start = source.indexOf('function renderSubmissionStress(');
	const end = source.indexOf('function compareSubmissionIdDescending(', start);
	const context = vm.createContext({
		localization_1: { localize: (text: string) => text },
		escapeHtml: (text: string) => text.replace(/</g, '&lt;'),
		escapeAttribute: (text: string) => text,
		isStressFinished: (status: string) => ['found', 'not_found', 'error', 'timeout'].includes(status),
	});
	vm.runInContext(`${source.slice(start, end)}; globalThis.render = renderSubmissionStress;`, context);
	return context.render({ problem: { localTest: { enabled: true } }, stressTasks: new Map(tasks.map(task => [task.taskId, task])), addingStressCounterExamples: new Set(), addedStressCounterExamples: new Set(), disconnectedStressTasks: new Set() }, { submissionId: '10' });
}

const task: StressTask = { taskId: '1112', submissionId: '10', status: 'running', roundsPlanned: 120, roundsExecuted: 0, billing: { amount: 0, currency: 'free', refundAmount: 0 }, createdAt: '' };

test('stress progress omits implementation and billing metadata', () => {
	const html = renderTasks([task]);
	assert.match(html, /对拍中…/);
	assert.doesNotMatch(html, /网页|网站|提供|费用|退款|1112|free|running/);
});

test('finished counterexamples open with a prominent add action before their data', () => {
	const html = renderTasks([{ ...task, status: 'found', roundsExecuted: 3, counterExample: { input: '1 2', expected: '3', actual: '4' } }]);
	assert.match(html, /发现反例/);
	assert.match(html, /class="stress-counterexample-action"/);
	assert.ok(html.indexOf('data-command="addStressCounterExample"') < html.indexOf('<details'));
	assert.match(html, /<details[^>]* open data-auto-expand-key="1112"/);
	assert.doesNotMatch(html, /对拍任务|费用|退款|free|· found/);
	for (const unavailable of [{ counterExampleTruncated: true }, { interactionTrace: 'trace' }]) {
		assert.doesNotMatch(renderTasks([{ ...task, status: 'found', counterExample: { input: '', expected: '', actual: '' }, ...unavailable }]), /data-command="addStressCounterExample"/);
	}
});

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

function createManager() {
	const compiled = fs.readFileSync(path.resolve(__dirname, '../extension.js'), 'utf8');
	const start = compiled.indexOf('class ShortestPathOjProblemPanel');
	const end = compiled.indexOf('async function activate(', start);
	const views: Array<Record<string, any>> = [];
	const recoveries: string[] = [];
	const changes: string[] = [];
	const confirmations: string[] = [];
	const context = vm.createContext({
		console, setTimeout, clearTimeout,
		localTests_1: localTests,
		defaultProblemSourceRatio: 60,
		problemPanelLayout_1: { defaultProblemSourceRatio: 60 },
		localization_1: { localizeFormat: (s: string, value: string) => s.replace('{0}', value) },
		vscode: {
			extensions: { getExtension: () => ({ activate: async () => undefined }) },
			commands: { executeCommand: async (_name: string, request: { sourcePath: string }) => ({ sourcePath: request.sourcePath, status: 'idle', diagnostics: '', tests: [] }) },
			Uri: { file: (fsPath: string) => ({ fsPath }) },
			workspace: { getConfiguration: () => ({ get: () => 60 }) },
			window: { createWebviewPanel: (_type: string, _title: string, _show: object, options: object) => {
				const view: Record<string, any> = { options, active: false, webview: { postMessage: () => true } };
				view.onDidDispose = (listener: () => void) => { view.disposed = listener; };
				view.onDidChangeViewState = (listener: () => void) => { view.changed = listener; };
				view.webview.onDidReceiveMessage = (listener: (message: object) => void) => { view.message = listener; };
				view.dispose = () => view.disposed();
				views.push(view);
				return view;
			} },
		},
	});
	vm.runInContext(`${compiled.slice(start, end)}; globalThis.Manager = ShortestPathOjProblemPanels; globalThis.Child = ShortestPathOjProblemPanel;`, context);
	context.Child.prototype.showProblem = function (problem: { ref: string }, connected: boolean, sourcePath: string) {
		this.state = { problem, connected, sourcePath, submissions: new Map(), finishedSubmissions: new Set(), disconnectedSubmissions: new Set(), stressTasks: new Map() };
		this.ensurePanel(1);
	};
	context.Child.prototype.reveal = function () { };
	context.Child.prototype.render = function () { };
	context.Child.prototype.confirm = function () { confirmations.push(this.problemRef); return Promise.resolve(true); };
	const manager = new context.Manager({}, '', {
		recover: (problem: { ref: string }) => recoveries.push(problem.ref), stopRecovery() { },
		sourceChanged: async (_problem: object, _previous: string, sourcePath: string) => changes.push(sourcePath),
	}, new Set());
	manager.showProblem({ ref: 'A', title: 'A' }, false, '/A.cpp');
	manager.showProblem({ ref: 'B', title: 'B' }, false, '/B.cpp');
	return { manager, views, recoveries, changes, confirmations };
}

test('activating an existing problem tab restores its connection; inactive disconnects do not hijack it', () => {
	const { manager, views, recoveries } = createManager();
	views[0].active = true;
	views[0].changed();
	assert.strictEqual(manager.active.problemRef, 'A');
	assert.deepEqual(recoveries, ['A']);
	manager.setDisconnected('B');
	assert.deepEqual(recoveries, ['A']);
	views[0].active = false;
	views[1].active = true;
	views[1].changed();
	assert.strictEqual(manager.active.problemRef, 'B');
	assert.deepEqual(recoveries, ['A', 'B']);
});

test('confirmation stays with the initiating problem after the user switches tabs', async () => {
	const { manager, confirmations } = createManager();
	assert.strictEqual(manager.active.problemRef, 'B');
	await manager.confirmForProblem('A', 'Confirm', 'Yes', 'No');
	assert.deepEqual(confirmations, ['A']);
	assert.strictEqual(manager.forProblem('A').problemRef, 'A');
});

test('source changes move the owning panel identity and update persisted problem association', async () => {
	const { manager, views, changes } = createManager();
	views[0].options.sourceEditor = { fsPath: '/renamed.cpp' };
	views[0].changed();
	await Promise.resolve();
	assert.deepEqual(changes, ['/renamed.cpp']);
	assert.strictEqual(manager.panels.has('/A.cpp'), false);
	assert.strictEqual(manager.panels.get('/renamed.cpp').problemRef, 'A');
});

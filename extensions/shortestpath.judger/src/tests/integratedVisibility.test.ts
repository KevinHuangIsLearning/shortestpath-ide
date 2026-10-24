/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('vscode', () => ({ workspace: { fs: { stat: jest.fn(async () => ({})) } }, Uri: { file: (file: string) => ({ toString: () => `file://${file}` }) }, commands: { executeCommand: jest.fn(), registerCommand: jest.fn(() => ({ dispose() {} })) }, window: { tabGroups: { activeTabGroup: { activeTab: undefined }, all: [] } } }), { virtual: true });
jest.mock('../extension', () => ({ getJudgeViewProvider: jest.fn(), updateJudgeVisibility: jest.fn() }));
jest.mock('../parser', () => ({ getProblem: jest.fn(), saveProblem: jest.fn() }));
jest.mock('../utils', () => ({ getProblemForDocument: jest.fn() }));
jest.mock('../preferences', () => ({ getAutoShowJudgePref: () => true, getDefaultOnlineJudge: () => true, getDefaultProblemSource: jest.fn(() => 'original'), getOjMapping: () => null, getVjudgeOpenInBrowser: jest.fn(() => false), getVjudgeUrlSuffix: () => '#original', getVjudgeBrowserSplitRatio: () => 65 }));
jest.mock('../compiler', () => ({ setOnlineJudgeEnv: jest.fn() }));

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getJudgeViewProvider, updateJudgeVisibility } from '../extension';
import { getProblemForDocument } from '../utils';
import { Problem } from '../types';
import { getProblem, saveProblem } from '../parser';
import { openProblemBrowser, registerProblemBrowser } from '../problemBrowser';
import { getDefaultProblemSource, getVjudgeOpenInBrowser } from '../preferences';
import { editorChanged, editorClosed, updateActiveTabJudgeVisibility, refreshActiveJudgeTab } from '../webview/editorChange';

describe('integrated tests editor visibility', () => {
	const provider = { problemPath: undefined as string | undefined, isViewUninitialized: () => true, extensionToJudgeViewMessage: jest.fn() };
	beforeEach(() => {
		jest.clearAllMocks();
		(getVjudgeOpenInBrowser as jest.Mock).mockReturnValue(false);
		(getDefaultProblemSource as jest.Mock).mockReturnValue('original');
		if (provider.problemPath) { editorClosed(editor(provider.problemPath).document); }
		provider.problemPath = undefined;
		provider.extensionToJudgeViewMessage.mockReset();
		(vscode.window.tabGroups.all as unknown as { tabs: { input: unknown }[] }[]) = [];
		(vscode.window.tabGroups.activeTabGroup as unknown as { activeTab: { input: unknown } | undefined }).activeTab = undefined;
		globalThis.logger = { ...console };
		(getJudgeViewProvider as jest.Mock).mockReturnValue(provider);
	});
	const editor = (fileName: string, scheme = 'file') => ({ document: { fileName, uri: { fsPath: fileName, scheme } } }) as vscode.TextEditor;
	test('opening and reopening an imported source restores its bound page once per tab', async () => {
		(getVjudgeOpenInBrowser as jest.Mock).mockReturnValue(true);
		const problem = { name: 'A', url: 'https://codeforces.com/problemset/problem/1/A', srcPath: '/A.cpp', tests: [] } as unknown as Problem;
		(getProblem as jest.Mock).mockReturnValue(problem);
		(getProblemForDocument as jest.Mock).mockReturnValue(problem);
		const group = vscode.window.tabGroups.activeTabGroup as unknown as { activeTab: { input: unknown } };
		const browserCalls = () => (vscode.commands.executeCommand as jest.Mock).mock.calls.filter(([name]) => name === 'workbench.action.browser.open');
		for (let i = 0; i < 2; i++) {
			group.activeTab = { input: { uri: { scheme: 'file', fsPath: '/A.cpp' } } };
			updateActiveTabJudgeVisibility();
			await editorChanged(editor('/A.cpp'));
			await Promise.resolve();
		}
		expect(browserCalls()).toEqual(Array(2).fill(['workbench.action.browser.open', {
			url: problem.url, openInEditor: true, sourceEditor: 'file:///A.cpp', sourceEditorRatio: 65,
		}]));
	});
	test('restores a persisted VJudge route and respects disabled problem pages', async () => {
		(getVjudgeOpenInBrowser as jest.Mock).mockReturnValue(true);
		(getDefaultProblemSource as jest.Mock).mockReturnValue('vjudge');
		const problem = { name: 'B', url: 'https://codeforces.com/problemset/problem/1/B', browserProblemUrl: 'https://vjudge.net/problem/CodeForces-1B', srcPath: '/B.cpp' } as Problem;
		(getProblem as jest.Mock).mockReturnValue(problem);
		const group = vscode.window.tabGroups.activeTabGroup as unknown as { activeTab: { input: unknown } };
		group.activeTab = { input: { uri: { scheme: 'file', fsPath: '/B.cpp' } } };
		updateActiveTabJudgeVisibility();
		await Promise.resolve();
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.browser.open', {
			url: problem.browserProblemUrl, openInEditor: true, sourceEditor: 'file:///B.cpp', sourceEditorRatio: 65,
		});
		jest.clearAllMocks();
		(getDefaultProblemSource as jest.Mock).mockReturnValue('none');
		group.activeTab = { input: { uri: { scheme: 'file', fsPath: '/B.cpp' } } };
		updateActiveTabJudgeVisibility();
		expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('workbench.action.browser.open', expect.anything());
	});
	test('native button opens an empty companion before a local problem has a URL', async () => {
		(getProblem as jest.Mock).mockReturnValue(undefined);
		registerProblemBrowser({ subscriptions: [] } as unknown as vscode.ExtensionContext, () => {});
		const callback = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(([command]) => command === 'judger.openProblemBrowser')![1];
		await callback('/local.cpp');
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.browser.open', {
			url: undefined, openInEditor: true, sourceEditor: 'file:///local.cpp', sourceEditorRatio: 65,
		});
	});
	test.each([true, false])('reopening uses the edited address exactly (local=%s)', async local => {
		(getVjudgeOpenInBrowser as jest.Mock).mockReturnValue(true);
		await openProblemBrowser({ name: 'A', srcPath: '/edited.cpp', local,
			url: local ? '/edited.cpp' : 'https://example.com/original', browserProblemUrl: 'https://example.org/edited?lang=zh#statement',
		} as Problem);
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.browser.open', {
			url: 'https://example.org/edited?lang=zh#statement', openInEditor: true, sourceEditor: 'file:///edited.cpp', sourceEditorRatio: 65,
		});
	});
	test('a local problem without a bound URL waits for the native button', async () => {
		(getVjudgeOpenInBrowser as jest.Mock).mockReturnValue(true);
		await openProblemBrowser({ name: 'A', srcPath: '/local.cpp', url: '/local.cpp', local: true } as Problem);
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
	});
	test.each([true, false])('address edits persist against the owning source (local=%s)', async local => {
		const current = { name: 'A', srcPath: '/local.cpp', url: 'https://example.com/original', tests: [{ id: 1, input: '1', output: '2' }] } as Problem;
		(getProblem as jest.Mock).mockReturnValue(local ? undefined : current);
		const changed = jest.fn();
		registerProblemBrowser({ subscriptions: [] } as unknown as vscode.ExtensionContext, changed);
		const callback = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(([command]) => command === 'judger.setProblemBrowserUrl')![1];
		await callback('/local.cpp', 'https://example.com/new');
		expect(saveProblem).toHaveBeenCalledWith('/local.cpp', expect.objectContaining({
			browserProblemUrl: 'https://example.com/new',
			url: local ? '/local.cpp' : current.url,
			tests: local ? [] : current.tests,
		}));
		expect(changed).toHaveBeenCalledWith(expect.objectContaining({ browserProblemUrl: 'https://example.com/new' }));
	});
	test('SP sources hide CPH and never focus its view; other sources keep the existing auto-focus', async () => {
		const sp = { url: 'https://shortestpath.cn/problem/test/found/A', name: 'A', srcPath: '/A.cpp' };
		(getProblemForDocument as jest.Mock).mockReturnValue(sp);
		await editorChanged(editor('/A.cpp'));
		expect(updateJudgeVisibility).toHaveBeenLastCalledWith(sp);
		expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('judger.judgeView.focus');
		const cf = { url: 'https://codeforces.com/problemset/problem/1/A', name: 'B', srcPath: '/B.cpp' };
		(getProblemForDocument as jest.Mock).mockReturnValue(cf);
		await editorChanged(editor('/B.cpp'));
		expect(updateJudgeVisibility).toHaveBeenLastCalledWith(cf);
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith('judger.judgeView.focus');
		editorClosed(editor('/B.cpp').document);
	});
	test('terminal, output and notes preserve the current source visibility', async () => {
		await editorChanged(undefined);
		await editorChanged(editor('Output', 'output'));
		await editorChanged(editor('/notes.md'));
		expect(updateJudgeVisibility).not.toHaveBeenCalled();
		expect(provider.extensionToJudgeViewMessage).not.toHaveBeenCalled();
	});
	test('switching a paired source tab updates visibility without a text editor', () => {
		const sp = { shortestPath: true, srcPath: '/paired.cpp' };
		(getProblem as jest.Mock).mockReturnValue(sp);
		const group = vscode.window.tabGroups.activeTabGroup as unknown as { activeTab: { input: unknown } };
		group.activeTab = { input: { uri: { scheme: 'file', fsPath: '/paired.cpp' } } };
		updateActiveTabJudgeVisibility();
		expect(updateJudgeVisibility).toHaveBeenLastCalledWith(sp);
		(getProblem as jest.Mock).mockReturnValue(undefined);
		group.activeTab = { input: { uri: { scheme: 'file', fsPath: '/ordinary.cpp' } } };
		updateActiveTabJudgeVisibility();
		expect(updateJudgeVisibility).toHaveBeenLastCalledWith(undefined);
		jest.clearAllMocks();
		for (const input of [{}, { uri: { scheme: 'file', fsPath: '/notes.md' } }, { uri: { scheme: 'output', fsPath: 'Output' } }]) {
			group.activeTab = { input };
			updateActiveTabJudgeVisibility();
		}
		expect(updateJudgeVisibility).not.toHaveBeenCalled();
	});
	test('same-named paired sources refresh their own tests on every path switch', () => {
		const group = vscode.window.tabGroups.activeTabGroup as unknown as { activeTab: { input: unknown } };
		const first = { name: 'main', srcPath: '/first/main.cpp', url: '', tests: [{ id: 1, input: 'first', output: '1' }] };
		const second = { ...first, srcPath: '/second/main.cpp', tests: [{ id: 1, input: 'second', output: '2' }] };
		(vscode.window.tabGroups.all as unknown as { tabs: { input: unknown }[] }[]) = [
			{ tabs: [first, second].map(problem => ({ input: { uri: { scheme: 'file', fsPath: problem.srcPath } } })) },
		];
		provider.extensionToJudgeViewMessage.mockImplementation(message => { provider.problemPath = message.problem?.srcPath; });
		for (const problem of [first, second, first]) {
			(getProblem as jest.Mock).mockReturnValue(problem);
			group.activeTab = { input: { uri: { scheme: 'file', fsPath: problem.srcPath } } };
			refreshActiveJudgeTab();
		}
		expect(provider.extensionToJudgeViewMessage.mock.calls.map(([message]) => message)).toEqual(
			[first, second, first].map(problem => ({ command: 'new-problem', problem })),
		);
		jest.clearAllMocks();
		refreshActiveJudgeTab();
		expect(provider.extensionToJudgeViewMessage).not.toHaveBeenCalled();
		editorClosed(editor(first.srcPath).document);
		provider.problemPath = undefined;
		provider.extensionToJudgeViewMessage.mockReset();
	});
	test.each(['editor-first', 'tab-first'])('same-named source switches refresh once when both events fire: %s', async order => {
		const group = vscode.window.tabGroups.activeTabGroup as unknown as { activeTab: { input: unknown } };
		const first = { name: 'main', srcPath: '/workspace/a/main.cpp', url: '', tests: [{ id: 1, input: 'a', output: '1' }] } as Problem;
		const second = { ...first, srcPath: '/workspace/b/main.cpp', tests: [{ id: 1, input: 'b', output: '2' }] };
		provider.extensionToJudgeViewMessage.mockImplementation(message => { provider.problemPath = message.problem?.srcPath; });
		for (const problem of [first, second, first]) {
			(getProblem as jest.Mock).mockReturnValue(problem);
			(getProblemForDocument as jest.Mock).mockReturnValue(problem);
			group.activeTab = { input: { uri: { scheme: 'file', fsPath: problem.srcPath } } };
			(vscode.window.tabGroups.all as unknown as { tabs: { input: unknown }[] }[]) = [{ tabs: [first, second].map(value => ({ input: { uri: { scheme: 'file', fsPath: value.srcPath } } })) }];
			if (order === 'editor-first') { await editorChanged(editor(problem.srcPath)); refreshActiveJudgeTab(); }
			else { refreshActiveJudgeTab(); await editorChanged(editor(problem.srcPath)); }
		}
		expect(provider.extensionToJudgeViewMessage.mock.calls.map(([message]) => message)).toEqual(
			[first, second, first].map(problem => ({ command: 'new-problem', problem })),
		);
		expect((vscode.commands.executeCommand as jest.Mock).mock.calls.filter(([command]) => command === 'shortestpath.oj.showProblemForCph')).toEqual(
			[],
		);
	});
	test('tab, group and close events share the complete settled refresh', () => {
		const source = fs.readFileSync(path.resolve(__dirname, '../../src/extension.ts'), 'utf8');
		expect(source).toMatch(/onDidCloseTextDocument\(\(e\) => \{\s*editorClosed\(e\);\s*tabChangeScheduler.schedule\(refreshActiveJudgeTab\)/);
		for (const event of ['onDidChangeTabs', 'onDidChangeTabGroups']) {
			expect(source).toContain(`${event}(() => tabChangeScheduler.schedule(refreshActiveJudgeTab))`);
		}
	});
	test('clearing a closed ordinary source cannot override the active paired source visibility', () => {
		const sp = { shortestPath: true, srcPath: '/paired.cpp' };
		(getProblem as jest.Mock).mockReturnValue(sp);
		(vscode.window.tabGroups.activeTabGroup as unknown as { activeTab: { input: unknown } }).activeTab = { input: { uri: { scheme: 'file', fsPath: '/paired.cpp' } } };
		provider.problemPath = '/closed.cpp';
		provider.extensionToJudgeViewMessage.mockImplementation(message => updateJudgeVisibility(message.problem));
		refreshActiveJudgeTab();
		expect(provider.extensionToJudgeViewMessage).toHaveBeenCalledWith({ command: 'new-problem', problem: undefined });
		expect(updateJudgeVisibility).toHaveBeenLastCalledWith(sp);
		provider.problemPath = undefined;
	});
});

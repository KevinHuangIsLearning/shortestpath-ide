/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('vscode', () => ({ commands: { executeCommand: jest.fn() }, window: { tabGroups: { activeTabGroup: { activeTab: undefined }, all: [] } } }), { virtual: true });
jest.mock('../extension', () => ({ getJudgeViewProvider: jest.fn(), updateJudgeVisibility: jest.fn() }));
jest.mock('../parser', () => ({ getProblem: jest.fn() }));
jest.mock('../utils', () => ({ getProblemForDocument: jest.fn() }));
jest.mock('../preferences', () => ({ getAutoShowJudgePref: () => true, getDefaultOnlineJudge: () => true }));
jest.mock('../compiler', () => ({ setOnlineJudgeEnv: jest.fn() }));

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getJudgeViewProvider, updateJudgeVisibility } from '../extension';
import { getProblemForDocument } from '../utils';
import { Problem } from '../types';
import { getProblem } from '../parser';
import { editorChanged, editorClosed, updateActiveTabJudgeVisibility, refreshActiveJudgeTab } from '../webview/editorChange';

describe('integrated tests editor visibility', () => {
	const provider = { problemPath: undefined as string | undefined, isViewUninitialized: () => true, extensionToJudgeViewMessage: jest.fn() };
	beforeEach(() => {
		jest.clearAllMocks();
		if (provider.problemPath) { editorClosed(editor(provider.problemPath).document); }
		provider.problemPath = undefined;
		provider.extensionToJudgeViewMessage.mockReset();
		(vscode.window.tabGroups.all as unknown as { tabs: { input: unknown }[] }[]) = [];
		(vscode.window.tabGroups.activeTabGroup as unknown as { activeTab: { input: unknown } | undefined }).activeTab = undefined;
		globalThis.logger = { ...console };
		(getJudgeViewProvider as jest.Mock).mockReturnValue(provider);
	});
	const editor = (fileName: string, scheme = 'file') => ({ document: { fileName, uri: { fsPath: fileName, scheme } } }) as vscode.TextEditor;
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

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
import { getProblem } from '../parser';
import { editorChanged, editorClosed, updateActiveTabJudgeVisibility, refreshActiveJudgeTab } from '../webview/editorChange';

describe('integrated tests editor visibility', () => {
	const provider = { problemPath: undefined as string | undefined, isViewUninitialized: () => true, extensionToJudgeViewMessage: jest.fn() };
	beforeEach(() => {
		jest.clearAllMocks();
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
		provider.extensionToJudgeViewMessage.mockImplementation(() => updateJudgeVisibility(undefined));
		refreshActiveJudgeTab();
		expect(provider.extensionToJudgeViewMessage).toHaveBeenCalledWith({ command: 'new-problem', problem: undefined });
		expect(updateJudgeVisibility).toHaveBeenLastCalledWith(sp);
		provider.problemPath = undefined;
	});
});

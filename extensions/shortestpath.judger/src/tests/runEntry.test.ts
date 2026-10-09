/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
jest.mock('vscode', () => ({ window: { showErrorMessage: jest.fn() }, Uri: { file: (fsPath: string) => ({ fsPath }) } }), { virtual: true });
jest.mock('../parser', () => ({ saveProblemFromWebview: jest.fn(() => true), getProblem: jest.fn() }));
jest.mock('../problemActions', () => ({}));
jest.mock('../testcaseRepository', () => ({}));
jest.mock('../importTestcases', () => ({}));
jest.mock('../browserSubmission', () => ({ getBrowserSubmission: jest.fn() }));
jest.mock('../companion', () => ({}));
jest.mock('../utils', () => ({}));
jest.mock('../problemDocument', () => ({}));
jest.mock('../runTestCases', () => ({}));
jest.mock('../webview/processRunSingle', () => ({}));
jest.mock('../webview/processRunAll', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../compiler', () => ({ runningCompilers: [], onlineJudgeEnv: false }));
jest.mock('../executions', () => ({ runningBinaries: [], clearKillRequested: jest.fn() }));
jest.mock('../stressTest', () => ({ isStressTestRunning: jest.fn(() => false) }));
jest.mock('../preferences', () => ({ getAutoShowJudgePref: jest.fn(() => false) }));
jest.mock('../i18n', () => ({ __esModule: true, default: (_: string, text: string) => text }));
import { getAutoShowJudgePref } from '../preferences';
import JudgeViewProvider from '../webview/JudgeView';
import runAll from '../webview/processRunAll';
import { getProblem, saveProblemFromWebview } from '../parser';
import { clearKillRequested } from '../executions';
import { isStressTestRunning } from '../stressTest';
import { Problem } from '../types';
import * as vscode from 'vscode';

beforeEach(() => jest.clearAllMocks());
test('all public run entries are mutually exclusive, clear cancellation, and recover after completion', async () => {
	globalThis.logger = { log: jest.fn(), error: jest.fn() } as typeof globalThis.logger;
	const provider = new JudgeViewProvider({} as vscode.Uri);
	provider.extensionToJudgeViewMessage = jest.fn();
	const problem = { srcPath: '/main.cpp', tests: [] } as unknown as Problem;
	(getProblem as jest.Mock).mockReturnValue(problem);
	let finish: () => void = () => undefined;
	(runAll as jest.Mock).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
	const first = provider.runAll(problem);
	await provider.runAll(problem);
	expect(runAll).toHaveBeenCalledTimes(1);
	expect(clearKillRequested).toHaveBeenCalledTimes(1);
	finish(); await first;
	await provider.runAll(problem);
	expect(runAll).toHaveBeenCalledTimes(2);
	expect(clearKillRequested).toHaveBeenCalledTimes(2);
	(isStressTestRunning as jest.Mock).mockReturnValueOnce(true);
	await provider.runAll(problem);
	expect(runAll).toHaveBeenCalledTimes(2);
});

test('a stale run snapshot uses the current problem and cannot overwrite host-imported tests', async () => {
	const provider = new JudgeViewProvider({} as vscode.Uri);
	provider.extensionToJudgeViewMessage = jest.fn();
	const stale = { srcPath: '/main.cpp', tests: [] } as unknown as Problem;
	const current = { ...stale, tests: [{ id: 1, input: 'host import', output: '' }] };
	(saveProblemFromWebview as jest.Mock).mockReturnValueOnce(false);
	(getProblem as jest.Mock).mockReturnValue(current);
	await provider.runAll(stale);
	expect(runAll).toHaveBeenCalledWith(current);
});

test('storage-promoted large inline data refreshes file references before running', async () => {
	const provider = new JudgeViewProvider({} as vscode.Uri);
	provider.extensionToJudgeViewMessage = jest.fn();
	const snapshot = { srcPath: '/main.cpp', tests: [{ id: 1, input: '', output: 'x'.repeat(70000) }] } as unknown as Problem;
	const stored = { ...snapshot, tests: [{ id: 1, input: '', output: '', outputPath: '/expected.out' }] };
	(saveProblemFromWebview as jest.Mock).mockReturnValue(true);
	(getProblem as jest.Mock).mockReturnValue(stored);
	(isStressTestRunning as jest.Mock).mockReturnValue(false);
	await provider.runAll(snapshot);
	expect(provider.extensionToJudgeViewMessage).toHaveBeenCalledWith({ command: 'new-problem', problem: stored, onlyIfActive: true });
	expect(runAll).toHaveBeenCalledWith(stored);
});


test('integrated problem refresh and execution messages never reveal the legacy sidebar', async () => {
	globalThis.logger = { log: jest.fn(), error: jest.fn() } as typeof globalThis.logger;
	(getAutoShowJudgePref as jest.Mock).mockReturnValue(true);
	const provider = new JudgeViewProvider({} as vscode.Uri);
	const focus = jest.spyOn(provider, 'focus').mockResolvedValue();
	const integrated = { srcPath: '/main.cpp', shortestPath: true, url: '', tests: [] } as unknown as Problem;
	await provider.extensionToJudgeViewMessage({ command: 'new-problem', problem: integrated });
	await provider.extensionToJudgeViewMessage({ command: 'compiling-start' });
	expect(focus).not.toHaveBeenCalled();
	const ordinary = { ...integrated, shortestPath: false };
	await provider.extensionToJudgeViewMessage({ command: 'new-problem', problem: ordinary });
	expect(focus).toHaveBeenCalledTimes(1);
	(getAutoShowJudgePref as jest.Mock).mockReturnValue(false);
});

test('disposing an old Judge view cannot clear its replacement; disposing the current view releases it', () => {
	const provider = new JudgeViewProvider({} as vscode.Uri);
	jest.spyOn(provider as unknown as { _getHtmlForWebview(): string }, '_getHtmlForWebview').mockReturnValue('');
	const callbacks: Array<() => void> = [];
	const view = () => ({
		onDidDispose: (callback: () => void) => { callbacks.push(callback); },
		webview: { onDidReceiveMessage: jest.fn() },
	}) as unknown as vscode.WebviewView;
	provider.resolveWebviewView(view());
	provider.resolveWebviewView(view());
	callbacks[0]();
	expect(provider.isViewUninitialized()).toBe(false);
	callbacks[1]();
	expect(provider.isViewUninitialized()).toBe(true);
});

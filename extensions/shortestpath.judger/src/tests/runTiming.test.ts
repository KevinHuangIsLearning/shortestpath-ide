/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('vscode', () => ({
	ViewColumn: { One: 1 },
	workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }), openTextDocument: jest.fn(async () => ({ save: async () => true })) },
	window: { showTextDocument: jest.fn(async () => undefined) },
}), { virtual: true });
jest.mock('../executableCleanup', () => ({ retainExecutable: () => ({ dispose() {} }) }));

jest.mock('../compiler', () => ({ compileFile: jest.fn(), getBinSaveLocation: () => '/test/A.bin' }));
jest.mock('../utils', () => ({ getLanguage: () => ({ name: 'cpp', compiler: 'g++', args: [] }) }));
jest.mock('../parser', () => ({ saveProblem: jest.fn() }));
jest.mock('../executions', () => ({ deleteBinary: jest.fn(), wasKillRequested: () => false }));
jest.mock('../testCaseExecution', () => ({ executeAndJudgeTestCase: jest.fn(async () => ({ id: 1, time: 7, pass: true, stdout: '3', stderr: '', code: 0, signal: null, timeOut: false })) }));
jest.mock('../preferences', () => ({ getIgnoreSTDERRORPref: () => true, getTimeOutPref: () => 1000 }));
jest.mock('../extension', () => {
	const provider = { extensionToJudgeViewMessage: jest.fn() };
	return { getJudgeViewProvider: () => provider };
});

import { compileFile } from '../compiler';
import { executeAndJudgeTestCase } from '../testCaseExecution';
import { getJudgeViewProvider } from '../extension';
import { runSingleAndSave } from '../webview/processRunSingle';
import type { Problem } from '../types';

globalThis.logger = { ...console, log: jest.fn(), error: jest.fn() };
const problem: Problem = { name: 'A+B', srcPath: '/test/A.cpp', url: '', interactive: false, timeLimit: 1000, memoryLimit: 256, group: '', tests: [{ id: 1, input: '1 2', output: '3' }] };
const emit = getJudgeViewProvider().extensionToJudgeViewMessage as jest.Mock;

beforeEach(() => jest.clearAllMocks());

test('the first case starts running only after compilation and reports execution time', async () => {
	let completeCompile: ((value: boolean) => void) | undefined;
	(compileFile as jest.Mock).mockImplementation(() => new Promise<boolean>(resolve => { completeCompile = resolve; }));
	const pending = runSingleAndSave(problem, 1, false, true);
	for (let i = 0; i < 10 && !completeCompile; i++) { await Promise.resolve(); }
	expect(completeCompile).toBeDefined();
	expect(emit).not.toHaveBeenCalled();
	expect(executeAndJudgeTestCase).not.toHaveBeenCalled();
	completeCompile!(true);
	const result = await pending;
	expect({ time: result?.time, commands: emit.mock.calls.map(([message]) => message.command) }).toEqual({ time: 7, commands: ['running', 'run-single-result'] });
});

test('compile failure never starts or times a testcase', async () => {
	(compileFile as jest.Mock).mockResolvedValue(false);
	expect(await runSingleAndSave(problem, 1, false, true)).toEqual(expect.objectContaining({ verdict: 'CE', time: 0 }));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ command: 'run-single-result' }));
	expect(executeAndJudgeTestCase).not.toHaveBeenCalled();
});

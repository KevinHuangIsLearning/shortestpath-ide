/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
const mockPost = jest.fn();
jest.mock('vscode', () => ({ window: { showErrorMessage: jest.fn() } }), { virtual: true });
jest.mock('../extension', () => ({ getJudgeViewProvider: () => ({ extensionToJudgeViewMessage: mockPost }) }));
jest.mock('../toolProcess', () => ({ runTool: jest.fn() }));
jest.mock('../preferences', () => ({ getPythonCommand: () => 'custom-python' }));
jest.mock('../submit', () => ({}));
jest.mock('../utils', () => ({}));
jest.mock('../i18n', () => ({ __esModule: true, default: (_: string, text: string) => text }));
import { submitKattisProblem } from '../companion';
import { runTool } from '../toolProcess';
import { Problem } from '../types';
import * as vscode from 'vscode';

beforeEach(() => {
	jest.clearAllMocks();
	globalThis.logger = { log: jest.fn(), error: jest.fn() } as typeof globalThis.logger;
	globalThis.reporter = { sendTelemetryEvent: jest.fn() } as unknown as typeof globalThis.reporter;
});
afterEach(() => jest.restoreAllMocks());

test('missing Kattis setup does not enter the waiting state', async () => {
	jest.spyOn(fs, 'existsSync').mockReturnValue(false);
	await submitKattisProblem({ srcPath: '/main.cpp' } as Problem);
	expect(mockPost).not.toHaveBeenCalled();
	expect(runTool).not.toHaveBeenCalled();
	expect(vscode.window.showErrorMessage).toHaveBeenCalled();
});

test.each([0, 1])('Kattis exit %s settles submission state using the configured Python', async code => {
	jest.spyOn(fs, 'existsSync').mockReturnValue(true);
	(runTool as jest.Mock).mockResolvedValue({ code, signal: null, timeOut: false, stdout: '', stderr: 'diagnostic' });
	await submitKattisProblem({ srcPath: '/main.cpp' } as Problem);
	expect((runTool as jest.Mock).mock.calls[0][0]).toBe('custom-python');
	expect(mockPost.mock.calls.map(call => call[0].command)).toEqual(['waiting-for-submit', 'submit-finished']);
	expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(code ? 1 : 0);
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
jest.mock('vscode', () => ({ window: { showQuickPick: jest.fn(), showTextDocument: jest.fn(async () => ({})) }, ViewColumn: { One: 1 }, workspace: { workspaceFolders: [{ uri: { fsPath: '/workspace' } }], openTextDocument: jest.fn(async () => ({ getText: () => '' })) }, commands: { executeCommand: jest.fn() } }), { virtual: true });
jest.mock('../extension', () => ({ getJudgeViewProvider: () => ({ extensionToJudgeViewMessage: jest.fn() }) }));
jest.mock('../toolProcess', () => ({}));
jest.mock('../preferences', () => ({ getDefaultLangPref: jest.fn(() => 'cpp'), getDefaultLanguageTemplateFileLocation: () => '/template.cpp', getMenuChoices: () => ['cpp'], getVjudgeOjNames: () => null, getVjudgeOpenInBrowser: () => false, getOjMapping: () => null, includeProblemIndex: () => true, getFileNameTemplate: () => '{name}.{ext}', getFileNameTemplateOverrides: () => null, wordRegex: () => /\w+/g, getDefaultProblemSource: () => 'none', doTemplateFileVariableReplacement: () => false }));
jest.mock('../submit', () => ({}));
jest.mock('../utils', () => ({ randomId: () => 1 }));
jest.mock('../parser', () => ({ saveProblem: jest.fn() }));
jest.mock('../i18n', () => ({ __esModule: true, default: (_key: string, text: string) => text }));
import { handleNewProblem } from '../companion';
import { getDefaultLangPref } from '../preferences';
import { Problem } from '../types';
import * as vscode from 'vscode';

beforeEach(() => {
	jest.clearAllMocks();
	globalThis.logger = { log: jest.fn(), error: jest.fn() } as unknown as typeof globalThis.logger;
	globalThis.reporter = { sendTelemetryEvent: jest.fn() } as unknown as typeof globalThis.reporter;
});
afterEach(() => jest.restoreAllMocks());

test('missing browser-import template fails before file or layout mutation on every retry', async () => {
	jest.spyOn(fs, 'existsSync').mockReturnValue(false);
	const write = jest.spyOn(fs, 'writeFileSync');
	const problem = { name: 'A', url: 'https://example.com/A', tests: [] } as unknown as Problem;
	await expect(handleNewProblem(problem, undefined, true)).rejects.toThrow('Template file does not exist');
	await expect(handleNewProblem(problem, undefined, true)).rejects.toThrow('Template file does not exist');
	expect(write).not.toHaveBeenCalled();
	expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
});

test('browser-import language picker cancellation returns silently', async () => {
	(getDefaultLangPref as jest.Mock).mockReturnValueOnce(null);
	(vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce(undefined);
	expect(await handleNewProblem({} as Problem, undefined, true)).toEqual({ created: false });
});


test('fixing the missing template allows a clean retry with template contents', async () => {
	let ready = false;
	jest.spyOn(fs, 'existsSync').mockImplementation(file => String(file) === '/template.cpp' && ready);
	jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
	jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('template contents'));
	const write = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
	const problem = { name: 'A', url: 'https://example.com/A', tests: [] } as unknown as Problem;
	await expect(handleNewProblem(problem, undefined, true)).rejects.toThrow('Template file does not exist');
	ready = true;
	expect(await handleNewProblem(problem, undefined, true)).toEqual({ created: true, sourcePath: '/workspace/A.cpp' });
	expect(write.mock.calls).toEqual([['/workspace/A.cpp', 'template contents']]);
});

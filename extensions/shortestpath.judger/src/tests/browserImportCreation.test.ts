/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
jest.mock('vscode', () => ({ window: { showQuickPick: jest.fn(), showTextDocument: jest.fn(async () => ({})) }, ViewColumn: { One: 1 }, workspace: { workspaceFolders: [{ uri: { fsPath: '/workspace' } }], openTextDocument: jest.fn(async () => ({ getText: () => '' })) }, commands: { executeCommand: jest.fn() } }), { virtual: true });
jest.mock('../extension', () => ({ getJudgeViewProvider: () => ({ extensionToJudgeViewMessage: jest.fn() }) }));
jest.mock('../toolProcess', () => ({}));
jest.mock('../preferences', () => ({ getDefaultLangPref: jest.fn(() => 'cpp'), getCppTemplate: () => null, getDefaultLanguageTemplateFileLocation: () => '/template.cpp', getMenuChoices: () => ['cpp'], getVjudgeOjNames: () => null, getVjudgeOpenInBrowser: () => false, getOjMapping: jest.fn(() => null), includeProblemIndex: () => true, getShortestPathFixedTemplate: jest.fn(() => true), getFileNameTemplate: jest.fn(() => '{name}.{ext}'), getFileNameTemplateOverrides: jest.fn(() => null), wordRegex: () => /\w+/g, getDefaultProblemSource: () => 'none', doTemplateFileVariableReplacement: () => false }));
jest.mock('../submit', () => ({}));
jest.mock('../utils', () => ({ randomId: () => 1 }));
jest.mock('../parser', () => ({ saveProblem: jest.fn(), getProblem: () => null }));
jest.mock('../i18n', () => ({ __esModule: true, default: (_key: string, text: string) => text }));
import { handleNewProblem } from '../companion';
import { getDefaultLangPref, getShortestPathFixedTemplate, getFileNameTemplate, getFileNameTemplateOverrides, getOjMapping } from '../preferences';
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
	await expect(handleNewProblem(problem, undefined, undefined, true)).rejects.toThrow('Template file does not exist');
	await expect(handleNewProblem(problem, undefined, undefined, true)).rejects.toThrow('Template file does not exist');
	expect(write).not.toHaveBeenCalled();
	expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
});

test('browser-import language picker cancellation returns silently', async () => {
	(getDefaultLangPref as jest.Mock).mockReturnValueOnce(null);
	(vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce(undefined);
	expect(await handleNewProblem({} as Problem, undefined, undefined, true)).toEqual({ created: false });
});


test('fixing the missing template allows a clean retry with template contents', async () => {
	let ready = false;
	jest.spyOn(fs, 'existsSync').mockImplementation(file => String(file) === '/template.cpp' && ready);
	jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
	jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('template contents'));
	const write = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
	const problem = { name: 'A', url: 'https://example.com/A', tests: [] } as unknown as Problem;
	await expect(handleNewProblem(problem, undefined, undefined, true)).rejects.toThrow('Template file does not exist');
	ready = true;
	expect(await handleNewProblem(problem, undefined, undefined, true)).toEqual({ created: true, sourcePath: '/workspace/A.cpp' });
	expect(write.mock.calls).toEqual([['/workspace/A.cpp', 'template contents', { flag: 'wx' }]]);
});


describe('ShortestPath OJ optional configured source paths', () => {
	const importedProblem = (): Problem => ({ name: '字母互换', group: 'dsu', url: 'https://shortestpath.cn/problem/dsu/found/A', tests: [], shortestPath: true, interactive: false, memoryLimit: 256, timeLimit: 1000, srcPath: '' });
	beforeEach(() => {
		jest.spyOn(fs, 'existsSync').mockImplementation(file => String(file) === '/template.cpp');
		(getShortestPathFixedTemplate as jest.Mock).mockReturnValue(false);
		jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
		jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('template contents'));
		jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
	});

	afterEach(() => { (getShortestPathFixedTemplate as jest.Mock).mockReturnValue(true); });

	test('fixed naming remains enabled by default', async () => {
		(getShortestPathFixedTemplate as jest.Mock).mockReturnValue(true);
		expect(await handleNewProblem(importedProblem())).toEqual({ created: true, sourcePath: '/workspace/dsu/A_字母互换.cpp' });
	});

	test('global filename template controls both directory and filename', async () => {
		(getFileNameTemplate as jest.Mock).mockReturnValueOnce('solutions/{group}/{name}.{ext}');
		const result = await handleNewProblem(importedProblem());
		expect(result).toEqual({ created: true, sourcePath: '/workspace/solutions/dsu/字母互换.cpp' });
		expect(fs.writeFileSync).toHaveBeenCalledWith(result.sourcePath, 'template contents', { flag: 'wx' });
	});

	test('ShortestPath per-OJ template is used verbatim even with a context hash', async () => {
		(getOjMapping as jest.Mock).mockReturnValue({ 'shortestpath.cn': { oj: 'ShortestPath', ojName: 'ShortestPath', contestIdRegex: 'problem/([^/]+)/', problemIdRegex: '/([^/]+)$' } });
		(getFileNameTemplateOverrides as jest.Mock).mockReturnValueOnce({ ShortestPath: 'custom/{contestId}/{problemId}.{ext}' });
		try {
			const result = await handleNewProblem(importedProblem(), undefined, 'a'.repeat(64));
			expect(result).toEqual({ created: true, sourcePath: '/workspace/custom/dsu/A.cpp' });
		} finally { (getOjMapping as jest.Mock).mockReturnValue(null); }
	});

	test('ShortestPath special-evaluation imports outside fixed URL patterns do not gain a suffix', async () => {
		(getFileNameTemplate as jest.Mock).mockReturnValueOnce('solutions/{group}/{name}.{ext}');
		const problem = { ...importedProblem(), name: 'A', url: 'https://shortestpath.cn/problem/dsu/template/A', tests: [] };
		expect(await handleNewProblem(problem, undefined, 'a'.repeat(64))).toEqual({ created: true, sourcePath: '/workspace/solutions/dsu/A.cpp' });
	});

	test('other OJ imports retain context isolation and template directories', async () => {
		(getFileNameTemplate as jest.Mock).mockReturnValueOnce('custom/{name}.{ext}');
		const problem = { ...importedProblem(), name: 'A', url: 'https://example.com/A', shortestPath: false };
		expect(await handleNewProblem(problem, undefined, 'a'.repeat(64))).toEqual({ created: true, sourcePath: `/workspace/custom/A_${'a'.repeat(24)}.cpp` });
	});

	test('re-import keeps the bound solution when naming settings change', async () => {
		const previous = '/workspace/dsu/A_字母互换.cpp';
		jest.spyOn(fs, 'existsSync').mockImplementation(file => String(file) === previous);
		(getFileNameTemplate as jest.Mock).mockReturnValueOnce('new/{name}.{ext}');
		const result = await handleNewProblem(importedProblem(), previous);
		expect(result).toEqual({ created: true, sourcePath: previous });
		expect(fs.writeFileSync).not.toHaveBeenCalled();
	});
});

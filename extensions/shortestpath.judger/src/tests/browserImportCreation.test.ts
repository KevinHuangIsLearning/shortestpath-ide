/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import path from 'path';
jest.mock('vscode', () => {
	class Position { constructor(public line: number, public character: number) {} }
	class Range { constructor(public start: Position, public end: Position) {} }
	class Selection { constructor(public anchor: Position, public active: Position) {} }
	return {
		window: { showQuickPick: jest.fn(), showInputBox: jest.fn(), showSaveDialog: jest.fn(), showErrorMessage: jest.fn(), showTextDocument: jest.fn(async () => ({})) },
		ViewColumn: { One: 1 },
		Uri: { file: (value: string) => ({ toString: () => `file://${value}` }) },
		workspace: { workspaceFolders: [{ uri: { fsPath: require('path').resolve('/workspace') } }], openTextDocument: jest.fn(async () => ({ getText: () => '' })) },
		commands: { executeCommand: jest.fn() },
		Position, Range, Selection,
		TextEditorRevealType: { InCenter: 2 },
	};
}, { virtual: true });
jest.mock('../extension', () => ({ getJudgeViewProvider: () => ({ extensionToJudgeViewMessage: jest.fn() }) }));
jest.mock('../toolProcess', () => ({}));
jest.mock('../preferences', () => ({ getDefaultLangPref: jest.fn(() => 'cpp'), getCppTemplate: () => null, getDefaultLanguageTemplateFileLocation: () => '/template.cpp', getMenuChoices: () => ['cpp'], getVjudgeOjNames: () => null, getVjudgeOpenInBrowser: jest.fn(() => false), getVjudgeBrowserSplitRatio: () => 65, getVjudgeUrlSuffix: () => '#original', getOjMapping: jest.fn(() => null), includeProblemIndex: () => true, getShortestPathImportCategoryEnabled: jest.fn(() => true), getShortestPathImportPrefix: jest.fn(() => ''), getFileNameTemplate: jest.fn(() => '{name}.{ext}'), getFileNameTemplateOverrides: jest.fn(() => null), useShortCodeForcesName: () => false, wordRegex: () => /\w+/g, getDefaultProblemSource: jest.fn(() => 'none'), doTemplateFileVariableReplacement: () => false }));
jest.mock('../submit', () => ({}));
jest.mock('../utils', () => ({ randomId: () => 1, isCodeforcesUrl: () => false, isLuoguUrl: () => false, isAtCoderUrl: () => false }));
jest.mock('../parser', () => ({ saveProblem: jest.fn(), getProblem: () => null }));
jest.mock('../i18n', () => ({ __esModule: true, default: (_key: string, text: string) => text }));
import { handleNewProblem } from '../companion';
import { saveProblem } from '../parser';
import { getDefaultLangPref, getShortestPathImportCategoryEnabled, getShortestPathImportPrefix, getFileNameTemplate, getFileNameTemplateOverrides, getOjMapping, getVjudgeOpenInBrowser, getDefaultProblemSource } from '../preferences';
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
	expect(await handleNewProblem(problem, undefined, undefined, true)).toEqual({ created: true, sourcePath: path.resolve('/workspace/A.cpp') });
	expect(write.mock.calls).toEqual([[path.resolve('/workspace/A.cpp'), 'template contents', { flag: 'wx' }]]);
});


describe('code template cursor placeholders', () => {
	test.each([
		['$0', 2],
		['${0}', 4],
		['$CURSOR_PLACEHOLDER', 19],
	])('removes %s from the created file and places the cursor there', async (token, length) => {
		const template = `int main() {\n    ${token}\n}\n`;
		const doc = {
			getText: () => template,
			positionAt: (offset: number) => {
				const before = template.slice(0, offset);
				const lines = before.split('\n');
				return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
			},
		};
		const deleted: vscode.Range[] = [];
		const editor = {
			edit: jest.fn(async (callback: (builder: { delete(range: vscode.Range): void }) => void) => {
				callback({ delete: range => deleted.push(range) });
				return true;
			}),
			selection: undefined as unknown as vscode.Selection,
			revealRange: jest.fn(),
		};
		jest.spyOn(fs, 'existsSync').mockImplementation(file => String(file) === '/template.cpp');
		jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
		jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from(template));
		jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
		(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValueOnce(doc);
		(vscode.window.showTextDocument as jest.Mock).mockResolvedValueOnce(editor);

		const problem = { name: 'A', url: 'https://example.com/A', tests: [] } as unknown as Problem;
		expect(await handleNewProblem(problem, undefined, undefined, true)).toEqual({ created: true, sourcePath: path.resolve('/workspace/A.cpp') });
		expect(deleted).toHaveLength(1);
		expect([deleted[0].start.line, deleted[0].start.character, deleted[0].end.line, deleted[0].end.character]).toEqual([1, 4, 1, 4 + length]);
		expect(editor.selection).toEqual(new vscode.Selection(new vscode.Position(1, 4), new vscode.Position(1, 4)));
		expect(editor.revealRange).toHaveBeenCalledWith(new vscode.Range(new vscode.Position(1, 4), new vscode.Position(1, 4)), vscode.TextEditorRevealType.InCenter);
	});

	test('does not strip $0 from an existing solution on re-import', async () => {
		const template = 'int main() {\n    $0\n}\n';
		const doc = { getText: () => template, positionAt: () => new vscode.Position(0, 0) };
		const editor = { edit: jest.fn(), selection: undefined as unknown as vscode.Selection, revealRange: jest.fn() };
		jest.spyOn(fs, 'existsSync').mockImplementation(file => ['/template.cpp', path.resolve('/workspace/A.cpp')].includes(String(file)));
		jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
		jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from(template));
		jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
		(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValueOnce(doc);
		(vscode.window.showTextDocument as jest.Mock).mockResolvedValueOnce(editor);

		const problem = { name: 'A', url: 'https://example.com/A', tests: [] } as unknown as Problem;
		expect(await handleNewProblem(problem, undefined, undefined, true)).toEqual({ created: true, sourcePath: path.resolve('/workspace/A.cpp') });
		expect(fs.writeFileSync).not.toHaveBeenCalled();
		expect(editor.edit).not.toHaveBeenCalled();
		expect(editor.selection).toBeUndefined();
	});
});


describe('ShortestPath OJ source paths with an optional directory prefix', () => {
	const importedProblem = (): Problem => ({ name: '字母互换', group: 'dsu', url: 'https://shortestpath.cn/problem/dsu/found/A', tests: [], shortestPath: true, interactive: false, memoryLimit: 256, timeLimit: 1000, srcPath: '' });
	beforeEach(() => {
		jest.spyOn(fs, 'existsSync').mockImplementation(file => String(file) === '/template.cpp');
		jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
		jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('template contents'));
		jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
	});
	afterEach(() => { (getShortestPathImportPrefix as jest.Mock).mockReturnValue(''); });

	test.each([
		['/problem/dsu/found/A', 'dsu/found/A_字母互换.cpp'],
		['/problem/dsu/adv/A', 'dsu/adv/A_字母互换.cpp'],
		['/problem/dsu/chal/A', 'dsu/chal/A_字母互换.cpp'],
		['/problem/dsu/past/A', 'dsu/past/A_字母互换.cpp'],
		['/upsolving/cf/2078/A', 'contest/2078/A_字母互换.cpp'],
		['/upsolving/cf/2078/B', 'contest/2078/B_字母互换.cpp'],
		['/upsolving/at/agc078/A', 'contest/agc078/A_字母互换.cpp'],
		['/upsolving/id/260', 'upsolving/260_字母互换.cpp'],
		['/upsolving/id/261', 'upsolving/261_字母互换.cpp'],
	])('imports %s into a distinct path despite the legacy naming template', async (route, relativePath) => {
		const mapping = require('../../package.json').contributes.configuration.properties['judger.general.ojMapping'].default;
		(getOjMapping as jest.Mock).mockReturnValue(mapping);
		(getFileNameTemplateOverrides as jest.Mock).mockReturnValue({ ShortestPath: '{ojName}/{contestId}/{problemId}.{ext}' });
		try {
			const result = await handleNewProblem({ ...importedProblem(), url: `https://shortestpath.cn${route}` }, undefined, 'a'.repeat(64));
			expect(result).toEqual({ created: true, sourcePath: path.resolve(`/workspace/${relativePath}`) });
			expect(saveProblem).toHaveBeenCalledWith(result.sourcePath, expect.objectContaining({ url: `https://shortestpath.cn${route}`, srcPath: result.sourcePath }));
		} finally {
			(getOjMapping as jest.Mock).mockReturnValue(null);
			(getFileNameTemplateOverrides as jest.Mock).mockReturnValue(null);
		}
	});

	test('disabling category directories restores the legacy topic path', async () => {
		(getShortestPathImportCategoryEnabled as jest.Mock).mockReturnValueOnce(false);
		expect(await handleNewProblem(importedProblem())).toEqual({ created: true, sourcePath: path.resolve('/workspace/dsu/A_字母互换.cpp') });
	});
	test('integrated imports never attach a competing browser preview', async () => {
		(getVjudgeOpenInBrowser as jest.Mock).mockReturnValueOnce(true);
		(getDefaultProblemSource as jest.Mock).mockReturnValueOnce('original');
		(vscode.commands.executeCommand as jest.Mock).mockClear();
		await handleNewProblem({ ...importedProblem(), url: 'http://127.0.0.1:13000/problem/dsu/found/A' });
		expect((vscode.commands.executeCommand as jest.Mock).mock.calls.some(([command]) => command === 'workbench.action.browser.open')).toBe(false);
	});

	test('enabled prefix is added before the source directory', async () => {
		(getShortestPathImportPrefix as jest.Mock).mockReturnValue('ShortestPath/solutions');
		const result = await handleNewProblem(importedProblem());
		expect(result).toEqual({ created: true, sourcePath: path.resolve('/workspace/ShortestPath/solutions/dsu/found/A_字母互换.cpp') });
		expect(fs.writeFileSync).toHaveBeenCalledWith(result.sourcePath, 'template contents', { flag: 'wx' });
	});

	test('ShortestPath browser imports keep their path even without an OJ mapping', async () => {
		const problem = { ...importedProblem(), url: 'https://shortestpath.cn/upsolving/cf/2078/A' };
		expect(await handleNewProblem(problem, undefined, undefined, true, true)).toEqual({ created: true, sourcePath: path.resolve('/workspace/contest/2078/A_字母互换.cpp') });
		expect(vscode.window.showSaveDialog).not.toHaveBeenCalled();
		expect(vscode.window.showInputBox).not.toHaveBeenCalled();
	});

	test('ShortestPath special-evaluation imports outside fixed URL patterns do not gain a suffix', async () => {
		(getFileNameTemplate as jest.Mock).mockReturnValueOnce('solutions/{group}/{name}.{ext}');
		const problem = { ...importedProblem(), name: 'A', url: 'https://shortestpath.cn/problem/dsu/template/A', tests: [] };
		expect(await handleNewProblem(problem, undefined, 'a'.repeat(64))).toEqual({ created: true, sourcePath: path.resolve('/workspace/solutions/dsu/A.cpp') });
	});

	test('other OJ imports retain context isolation and template directories', async () => {
		(getShortestPathImportPrefix as jest.Mock).mockReturnValue('ShortestPath');
		(getFileNameTemplate as jest.Mock).mockReturnValueOnce('custom/{name}.{ext}');
		const problem = { ...importedProblem(), name: 'A', url: 'https://example.com/A', shortestPath: false };
		expect(await handleNewProblem(problem, undefined, 'a'.repeat(64))).toEqual({ created: true, sourcePath: path.resolve(`/workspace/custom/A_${'a'.repeat(24)}.cpp`) });
	});

	test('re-import keeps the bound solution when prefix settings change', async () => {
		const previous = path.resolve('/workspace/old/solution.cpp');
		jest.spyOn(fs, 'existsSync').mockImplementation(file => String(file) === previous);
		(getShortestPathImportPrefix as jest.Mock).mockReturnValue('new');
		const result = await handleNewProblem(importedProblem(), previous);
		expect(result).toEqual({ created: true, sourcePath: previous });
		expect(fs.writeFileSync).not.toHaveBeenCalled();
	});
});


describe('browser import filenames without naming templates', () => {
	beforeEach(() => {
		(getOjMapping as jest.Mock).mockReturnValue({ 'example.com': { oj: 'Example' } });
		(getFileNameTemplate as jest.Mock).mockReturnValue(null);
		(getFileNameTemplateOverrides as jest.Mock).mockReturnValue(null);
		jest.spyOn(fs, 'existsSync').mockImplementation(file => String(file) === '/template.cpp');
		jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
		jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('template contents'));
		jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
	});
	afterEach(() => { (getFileNameTemplate as jest.Mock).mockReturnValue('{name}.{ext}'); (getFileNameTemplateOverrides as jest.Mock).mockReturnValue(null); (getOjMapping as jest.Mock).mockReturnValue(null); });
	const problem = (): Problem => ({ name: 'A', url: 'https://example.com/A', tests: [] } as unknown as Problem);

	test('asks for a name, appends the selected extension, then creates the file', async () => {
		(vscode.window.showInputBox as jest.Mock).mockResolvedValue('solution');
		expect(await handleNewProblem(problem(), undefined, undefined, true, true)).toEqual({ created: true, sourcePath: path.resolve('/workspace/solution.cpp') });
		expect(vscode.window.showInputBox).toHaveBeenCalledTimes(1);
	});

	test('cancelling the name prompt creates no files or layout changes', async () => {
		(vscode.window.showInputBox as jest.Mock).mockResolvedValue(undefined);
		expect(await handleNewProblem(problem(), undefined, undefined, true, true)).toEqual({ created: false });
		expect(fs.writeFileSync).not.toHaveBeenCalled();
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
	});

	test.each(['../outside.cpp', 'CON.cpp', 'solution.py'])('rejects invalid filename %s before mutation', async filename => {
		(vscode.window.showInputBox as jest.Mock).mockResolvedValue(filename);
		expect(await handleNewProblem(problem(), undefined, undefined, true, true)).toEqual({ created: false });
		expect(fs.writeFileSync).not.toHaveBeenCalled();
	});

	test.each(['global', 'override'])('configured %s filename template bypasses the prompt', async kind => {
		if (kind === 'global') { (getFileNameTemplate as jest.Mock).mockReturnValue('global/{name}.{ext}'); }
		else {
			(getOjMapping as jest.Mock).mockReturnValue({ 'example.com': { oj: 'Example' } });
			(getFileNameTemplateOverrides as jest.Mock).mockReturnValue({ Example: 'custom/{name}.{ext}' });
		}
		const result = await handleNewProblem(problem(), undefined, undefined, true, true);
		expect(result.created).toBe(true);
		expect(vscode.window.showInputBox).not.toHaveBeenCalled();
	});
});


test('other OJ imports pair the selected problem page after creating and opening the source', async () => {
	jest.spyOn(fs, 'existsSync').mockImplementation(file => String(file) === '/template.cpp');
	jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
	jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('template contents'));
	const write = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
	(getVjudgeOpenInBrowser as jest.Mock).mockReturnValueOnce(true).mockReturnValueOnce(true);
	(getDefaultProblemSource as jest.Mock).mockReturnValueOnce('original');
	const problem = { name: 'A', url: 'https://example.com/A', tests: [] } as unknown as Problem;
	await handleNewProblem(problem);
	expect(saveProblem).toHaveBeenCalledWith(problem.srcPath, expect.objectContaining({ browserProblemUrl: 'https://example.com/A' }));
	const commands = (vscode.commands.executeCommand as jest.Mock).mock.calls;
	expect(commands).toEqual([
		['workbench.action.browser.open', { url: 'https://example.com/A', openInEditor: true, sourceEditor: 'file://' + path.resolve('/workspace/A.cpp'), sourceEditorRatio: 65 }],
		['shortestpath.oj.showProblemForCph', 'https://example.com/A'],
	]);
	const execute = vscode.commands.executeCommand as jest.Mock;
	expect(write.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[0]);
	expect((vscode.window.showTextDocument as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[0]);
});


describe('browser imports from URLs without an OJ mapping', () => {
	const problem = (): Problem => ({ name: 'A', url: 'https://example.com/A', tests: [] } as unknown as Problem);
	beforeEach(() => {
		(getOjMapping as jest.Mock).mockReturnValue({ 'example.com': { oj: 'Example' } });
		(getFileNameTemplate as jest.Mock).mockReturnValue('solutions/{name}.{ext}');
		jest.spyOn(fs, 'existsSync').mockImplementation(file => String(file) === '/template.cpp');
		jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
		jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('template contents'));
		jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
	});
	afterEach(() => {
		(getOjMapping as jest.Mock).mockReturnValue(null);
		(getFileNameTemplate as jest.Mock).mockReturnValue('{name}.{ext}');
	});

	test('uses the page URL and saves at the chosen directory and name despite a global template', async () => {
		(vscode.window.showSaveDialog as jest.Mock).mockResolvedValue({ fsPath: path.resolve('/chosen/nested/solution') });
		const result = await handleNewProblem(problem(), undefined, 'a'.repeat(64), true, true, 'https://mirror.example/A');
		expect(result).toEqual({ created: true, sourcePath: path.resolve('/chosen/nested/solution.cpp') });
		const options = (vscode.window.showSaveDialog as jest.Mock).mock.calls[0][0];
		expect([options.title, options.defaultUri.toString(), options.filters]).toEqual(['Import Problem', 'file://' + path.resolve('/workspace/A.cpp'), { CPP: ['cpp'] }]);
		expect(fs.writeFileSync).toHaveBeenCalledWith(result.sourcePath, 'template contents', { flag: 'wx' });
		expect(vscode.window.showInputBox).not.toHaveBeenCalled();
	});

	test('a mapped page keeps automatic naming even if the parser returns an unmapped URL', async () => {
		const result = await handleNewProblem({ ...problem(), url: 'https://mirror.example/A' }, undefined, undefined, true, true, 'https://example.com/A');
		expect(result).toEqual({ created: true, sourcePath: path.resolve('/workspace/solutions/A.cpp') });
		expect(vscode.window.showSaveDialog).not.toHaveBeenCalled();
	});

	test('cancelling the save dialog creates no source or metadata', async () => {
		(vscode.window.showSaveDialog as jest.Mock).mockResolvedValue(undefined);
		expect(await handleNewProblem(problem(), undefined, undefined, true, true, 'https://mirror.example/A')).toEqual({ created: false });
		expect(fs.writeFileSync).not.toHaveBeenCalled();
		expect(saveProblem).not.toHaveBeenCalled();
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
	});

	test('native replacement confirmation replaces source and imports metadata', async () => {
		(vscode.window.showSaveDialog as jest.Mock).mockResolvedValue({ fsPath: path.resolve('/chosen/existing.cpp') });
		jest.spyOn(fs, 'existsSync').mockImplementation(file => ['/template.cpp', path.resolve('/chosen/existing.cpp')].includes(String(file)));
		expect(await handleNewProblem(problem(), undefined, undefined, true, true, 'https://mirror.example/A')).toEqual({ created: true, sourcePath: path.resolve('/chosen/existing.cpp') });
		expect(fs.writeFileSync).toHaveBeenCalledWith(path.resolve('/chosen/existing.cpp'), 'template contents', { flag: 'w' });
		expect(saveProblem).toHaveBeenCalledWith(path.resolve('/chosen/existing.cpp'), expect.objectContaining({ srcPath: path.resolve('/chosen/existing.cpp') }));
		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
	});

	test('a missing template does not truncate an existing replacement target', async () => {
		(vscode.window.showSaveDialog as jest.Mock).mockResolvedValue({ fsPath: path.resolve('/chosen/existing.cpp') });
		jest.spyOn(fs, 'existsSync').mockImplementation(file => String(file) === path.resolve('/chosen/existing.cpp'));
		await expect(handleNewProblem(problem(), undefined, undefined, true, true, 'https://mirror.example/A')).rejects.toThrow('Template file does not exist');
		expect(fs.writeFileSync).not.toHaveBeenCalled();
		expect(saveProblem).not.toHaveBeenCalled();
	});

	test.each([path.resolve('/chosen/solution.py'), path.resolve('/chosen/CON.cpp'), path.resolve('/chosen/existing')])('rejects invalid or unconfirmed existing target %s without changing files or metadata', async fsPath => {
		(vscode.window.showSaveDialog as jest.Mock).mockResolvedValue({ fsPath });
		jest.spyOn(fs, 'existsSync').mockImplementation(file => ['/template.cpp', path.resolve('/chosen/existing.cpp')].includes(String(file)));
		expect(await handleNewProblem(problem(), undefined, undefined, true, true, 'https://mirror.example/A')).toEqual({ created: false });
		expect(fs.writeFileSync).not.toHaveBeenCalled();
		expect(saveProblem).not.toHaveBeenCalled();
	});
});

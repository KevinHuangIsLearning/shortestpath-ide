/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('vscode', () => ({
	Disposable: class { constructor(readonly dispose: () => void) { } },
	commands: { executeCommand: jest.fn(async () => undefined), registerCommand: jest.fn(() => ({ dispose() { } })) },
	Uri: { file: (file: string) => ({ fsPath: file }) },
    workspace: { getConfiguration: () => ({ get: (key: string, fallback: unknown) => key === 'mode' ? 'direct' : key === 'executableCleanupDelaySeconds' ? 0 : fallback }), openTextDocument: jest.fn(async () => ({ save: async () => true })) },
	window: { showErrorMessage: jest.fn(), tabGroups: { activeTabGroup: { activeTab: { input: {} } } } },
}), { virtual: true });
jest.mock('../utils', () => ({ getLanguage: () => ({ name: 'cpp', compiler: process.env.CPH_TEST_CPP_COMPILER || 'g++', args: ['-std=c++17', '-g'], skipCompile: false }) }));
jest.mock('../extension', () => ({ getJudgeViewProvider: jest.fn(), updateJudgeVisibility: jest.fn() }));
jest.mock('../preferences', () => ({ getDefaultOnlineJudge: () => true, getSaveLocationPref: () => '', getCppOutputArgPref: () => '-o', getHideStderrorWhenCompiledOK: () => false, getIgnoreSTDERRORPref: () => true, getTimeOutPref: () => 1000 }));
jest.mock('../parser', () => ({ getProblem: jest.fn(), saveProblem: jest.fn(), getProbSaveLocation: (source: string) => `${source}.prob` }));
jest.mock('../stressTest', () => ({ isStressTestRunning: () => false }));

import * as vscode from 'vscode';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'fs';
import os from 'os';
import path from 'path';
import { getProblem } from '../parser';
import { getJudgeViewProvider, updateJudgeVisibility } from '../extension';
import { getBinSaveLocation } from '../compiler';
import { registerIntegratedTestCommands, getIntegratedTestService } from '../integratedTestCommands';
import { Problem } from '../types';
import { execFileSync } from 'child_process';
import { deleteBinary } from '../executions';

let compilerAvailable = false;
try { execFileSync(process.env.CPH_TEST_CPP_COMPILER || 'g++', ['--version'], { stdio: 'ignore' }); compilerAvailable = true; } catch { }
const integrationTest = compilerAvailable ? test : test.skip;

integrationTest('headless adapter really compiles and runs samples, reports mismatch and compile errors, and cleans binaries without CPH UI', async () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), 'sp-integrated-'));
	const sourcePath = path.join(directory, 'A.cpp');
	const problem: Problem = { shortestPath: true, name: 'A', srcPath: sourcePath, url: 'https://shortestpath.cn/problem/DSU/found/A', interactive: false, memoryLimit: 256, timeLimit: 1000, group: 'test', tests: [{ id: 1, input: '2\n', output: '4\n' }, { id: 2, input: '3\n', output: 'wrong\n' }] };
	globalThis.extensionContext = { extensionPath: directory } as vscode.ExtensionContext;
    globalThis.logger = { ...console, log: jest.fn() };
	globalThis.reporter = { sendTelemetryEvent: jest.fn() } as unknown as typeof globalThis.reporter;
	(getProblem as jest.Mock).mockImplementation(() => problem);
	const context = { subscriptions: [] as Array<{ dispose(): void }> };
	registerIntegratedTestCommands(context as vscode.ExtensionContext, () => false);
	try {
		writeFileSync(sourcePath, '#include <iostream>\nint main() { int x; std::cin >> x; std::cout << 2*x << "\\n"; }\n');
		problem.tests.push({ id: 3, input: '4\n', output: ' 8\t\n\n' });
		const result = await getIntegratedTestService().request({ action: 'runAll', sourcePath });
        expect({ error: result.error, diagnostics: result.diagnostics }).toEqual({ error: undefined, diagnostics: '' });
		expect(result.tests.map(test => [test.id, test.result?.stdout, test.result?.pass])).toEqual([[1, '4\n', true], [2, '6\n', false], [3, '8\n', true]]);
		expect(result.tests[1].result?.diff?.lines.some(line => line.type !== 'match')).toBe(true);
		await new Promise(resolve => setTimeout(resolve, 5));
		expect([existsSync(getBinSaveLocation(sourcePath)), existsSync(`${getBinSaveLocation(sourcePath)}.dSYM`)]).toEqual([false, false]);
		writeFileSync(sourcePath, 'this is not C++');
		const failed = await getIntegratedTestService().request({ action: 'run', sourcePath, id: 1 });
		expect(failed.error).toBe('compile-failed');
		expect(failed.diagnostics).toContain('error:');
		expect(failed.status).toBe('idle');
		expect(getJudgeViewProvider).not.toHaveBeenCalled();
	} finally {
		context.subscriptions.forEach(disposable => disposable.dispose());
		rmSync(directory, { recursive: true, force: true });
	}
}, 15000);

test('binary cleanup preserves interpreted source and unrelated files while removing Java classes and native artifacts', () => {
    globalThis.logger = { ...console, log: jest.fn() };
	const directory = mkdtempSync(path.join(os.tmpdir(), 'sp-cleanup-'));
	try {
		const sourcePath = path.join(directory, 'A.py');
		writeFileSync(sourcePath, 'source');
		deleteBinary({ name: 'python', skipCompile: true, compiler: 'python3', args: [] }, sourcePath);
		expect(existsSync(sourcePath)).toBe(true);
		writeFileSync(path.join(directory, 'Main.class'), 'class');
		writeFileSync(path.join(directory, 'Main$Inner.class'), 'class');
		deleteBinary({ name: 'java', skipCompile: false, compiler: 'javac', args: [] }, path.join(directory, 'Main*.class'));
		expect(existsSync(path.join(directory, 'Main.class'))).toBe(false);
		expect(existsSync(path.join(directory, 'Main$Inner.class'))).toBe(false);
		expect(existsSync(sourcePath)).toBe(true);
		const binPath = path.join(directory, 'A.bin');
		writeFileSync(binPath, 'binary');
		mkdirSync(path.join(`${binPath}.dSYM`, 'Contents', 'Resources', 'DWARF'), { recursive: true });
		writeFileSync(path.join(`${binPath}.dSYM`, 'Contents', 'Resources', 'DWARF', 'A.bin'), 'symbols');
		mkdirSync(path.join(directory, 'other.bin.dSYM'));
		deleteBinary({ name: 'cpp', skipCompile: false, compiler: 'g++', args: [] }, binPath);
		expect(readdirSync(directory).sort()).toEqual(['A.py', 'other.bin.dSYM']);
		// Cleanup also handles interrupted compilers that only produced symbols.
		mkdirSync(`${binPath}.dSYM`);
		deleteBinary({ name: 'cpp', skipCompile: false, compiler: 'g++', args: [] }, binPath);
		expect(readdirSync(directory).sort()).toEqual(['A.py', 'other.bin.dSYM']);
	} finally { rmSync(directory, { recursive: true, force: true }); }
});

test('a restored paired source loads its visibility; background or browser tabs do not change the active judge', async () => {
	const problem: Problem = { shortestPath: true, name: 'A', srcPath: '/A.cpp', url: 'https://shortestpath.cn/problem/DSU/found/A', interactive: false, memoryLimit: 256, timeLimit: 1000, group: 'test', tests: [] };
	(getProblem as jest.Mock).mockReturnValue(problem);
	const context = { subscriptions: [] as Array<{ dispose(): void }> };
	(vscode.commands.registerCommand as jest.Mock).mockClear();
	(updateJudgeVisibility as jest.Mock).mockClear();
	registerIntegratedTestCommands(context as vscode.ExtensionContext, () => false);
	const command = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(([id]) => id === 'judger.integratedTests')![1];
	const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab as unknown as { input: { uri?: { scheme: string; fsPath: string } } };
	try {
		activeTab.input = {};
		await command({ action: 'load', sourcePath: '/A.cpp' });
		expect(updateJudgeVisibility).not.toHaveBeenCalled();
		activeTab.input = { uri: { scheme: 'file', fsPath: '/A.cpp' } };
		await command({ action: 'load', sourcePath: '/A.cpp' });
		expect(updateJudgeVisibility).toHaveBeenCalledWith(problem);
		(updateJudgeVisibility as jest.Mock).mockClear();
		activeTab.input = { uri: { scheme: 'file', fsPath: '/B.cpp' } };
		await command({ action: 'load', sourcePath: '/A.cpp' });
		expect(updateJudgeVisibility).not.toHaveBeenCalled();
	} finally {
		activeTab.input = {};
		context.subscriptions.forEach(disposable => disposable.dispose());
	}
});

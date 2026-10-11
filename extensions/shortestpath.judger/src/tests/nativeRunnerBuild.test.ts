/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({}), { virtual: true });
jest.mock('../compiler', () => ({ compileFile: jest.fn() }));
jest.mock('../toolProcess', () => ({ runTool: jest.fn() }));
jest.mock('../i18n', () => ({ __esModule: true, default: (_key: string, message: string) => message }));

import { compileFile } from '../compiler';
import { prepareNativeRunner } from '../nativeRunner';

let root: string;
beforeEach(() => {
	jest.resetAllMocks();
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-native-build-'));
	const tools = path.join(root, 'dist/static/tools');
	fs.mkdirSync(tools, { recursive: true });
	fs.writeFileSync(path.join(tools, 'runner.cpp'), 'mock runner source');
	globalThis.extensionContext = { extensionPath: root, globalStorageUri: { fsPath: path.join(root, 'storage') } } as vscode.ExtensionContext;
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

test('concurrent cold starts share one bounded build and cannot observe a partial cache', async () => {
	let finish!: () => void;
	(compileFile as jest.Mock).mockImplementation(async (_source, options) => {
		fs.writeFileSync(options.outputPath, 'partial');
		await new Promise<void>(resolve => { finish = resolve; });
		fs.writeFileSync(options.outputPath, 'complete');
		return true;
	});
	const first = prepareNativeRunner();
	const second = prepareNativeRunner();
	const cache = path.join(root, 'storage/native');
	expect(fs.readdirSync(cache).filter(name => name.startsWith('runner-'))).toEqual([]);
	finish();
	const [one, two] = await Promise.all([first, second]);
	expect([one, fs.readFileSync(one, 'utf8'), fs.readdirSync(cache)]).toEqual([two, 'complete', [path.basename(one)]]);
	expect(compileFile).toHaveBeenCalledTimes(1);
	expect(compileFile).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeout: 60000, compileMode: 'force', silent: true }));
	await prepareNativeRunner();
	expect(compileFile).toHaveBeenCalledTimes(1);
});

test('Windows retries a transient first failure once and preserves its diagnostic output', async () => {
	const progress: string[] = [];
	(compileFile as jest.Mock).mockImplementationOnce(async (_source, options) => {
		options.reportProgress('temporary file lock');
		fs.writeFileSync(options.outputPath, 'partial');
		return false;
	}).mockImplementationOnce(async (_source, options) => { fs.writeFileSync(options.outputPath, 'complete'); return true; });
	const executable = await prepareNativeRunner(message => progress.push(message), 'win32');
	expect(path.extname(executable)).toBe('.exe');
	expect(compileFile).toHaveBeenCalledTimes(2);
	expect((compileFile as jest.Mock).mock.calls[0][1].additionalArgs).toEqual(['-std=c++17', '-lpsapi', '-lshell32']);
	expect(progress.join('\n')).toMatch(/temporary file lock[\s\S]*Retrying once/);
	expect(fs.readdirSync(path.dirname(executable))).toEqual([path.basename(executable)]);
});

test('persistent Windows failures report the compiler details, clean partial output, and allow later recovery', async () => {
	(compileFile as jest.Mock).mockImplementation(async (_source, options) => { options.reportProgress('ld: permission denied'); fs.writeFileSync(options.outputPath, 'partial'); return false; });
	await expect(prepareNativeRunner(undefined, 'win32')).rejects.toThrow(/Could not compile the native runner[\s\S]*permission denied/);
	expect(compileFile).toHaveBeenCalledTimes(2);
	expect(fs.readdirSync(path.join(root, 'storage/native'))).toEqual([]);
	(compileFile as jest.Mock).mockImplementation(async (_source, options) => { fs.writeFileSync(options.outputPath, 'complete'); return true; });
	expect(fs.readFileSync(await prepareNativeRunner(undefined, 'win32'), 'utf8')).toBe('complete');
});

test('a Windows staging cleanup lock is logged without preventing recovery or turning success into failure', async () => {
	const progress: string[] = [];
	jest.spyOn(fs.promises, 'rm').mockRejectedValueOnce(Object.assign(new Error('EPERM: file temporarily locked'), { code: 'EPERM' }));
	(compileFile as jest.Mock).mockResolvedValueOnce(false).mockImplementationOnce(async (_source, options) => { fs.writeFileSync(options.outputPath, 'complete'); return true; });
	const executable = await prepareNativeRunner(message => progress.push(message), 'win32');
	expect([fs.readFileSync(executable, 'utf8'), (compileFile as jest.Mock).mock.calls.length]).toEqual(['complete', 2]);
	expect(progress.join('\n')).toMatch(/cleanup failed:.*EPERM[\s\S]*Retrying once/);
	fs.rmSync(executable);
	jest.spyOn(fs.promises, 'rm').mockRejectedValueOnce(new Error('EPERM: cleanup locked'));
	(compileFile as jest.Mock).mockImplementation(async (_source, options) => { fs.writeFileSync(options.outputPath, 'complete'); return true; });
	expect(await prepareNativeRunner(undefined, 'win32')).toBe(executable);
});

test('joining a shared build replays earlier diagnostics and receives later retry output', async () => {
	let finish!: () => void;
	(compileFile as jest.Mock).mockImplementationOnce(async (_source, options) => {
		options.reportProgress('first failure details');
		await new Promise<void>(resolve => { finish = resolve; });
		return false;
	}).mockImplementationOnce(async (_source, options) => { options.reportProgress('retry succeeded'); fs.writeFileSync(options.outputPath, 'complete'); return true; });
	const ordinaryRun = prepareNativeRunner(undefined, 'win32');
	const output: string[] = [];
	const selfTest = prepareNativeRunner(message => output.push(message), 'win32');
	finish();
	expect(await ordinaryRun).toBe(await selfTest);
	expect(output.join('\n')).toMatch(/first failure details[\s\S]*Retrying once[\s\S]*retry succeeded/);
});

test('a cancelled cold build ends promptly and never launches the Windows retry', async () => {
	jest.useFakeTimers();
	jest.spyOn(fs.promises, 'rm').mockImplementation(async directory => { fs.rmSync(String(directory), { recursive: true, force: true }); });
	let cancelled = false;
	let finish!: () => void;
	(compileFile as jest.Mock).mockImplementation(async () => { await new Promise<void>(resolve => { finish = resolve; }); return false; });
	const pending = prepareNativeRunner(undefined, 'win32', () => { if (cancelled) { throw new Error('cancelled'); } });
	const rejected = expect(pending).rejects.toThrow('cancelled');
	cancelled = true;
	jest.advanceTimersByTime(60);
	await rejected;
	finish();
	for (let turn = 0; turn < 5; turn++) { await Promise.resolve(); }
	expect(compileFile).toHaveBeenCalledTimes(1);
});

test('cancelling one shared waiter leaves the build available to another testcase', async () => {
	jest.useFakeTimers();
	let cancelled = false;
	let finish!: () => void;
	(compileFile as jest.Mock).mockImplementation(async (_source, options) => { await new Promise<void>(resolve => { finish = resolve; }); fs.writeFileSync(options.outputPath, 'complete'); return true; });
	const first = prepareNativeRunner(undefined, 'win32', () => { if (cancelled) { throw new Error('cancelled'); } });
	const rejected = expect(first).rejects.toThrow('cancelled');
	const second = prepareNativeRunner(undefined, 'win32');
	cancelled = true;
	jest.advanceTimersByTime(60);
	await rejected;
	expect((compileFile as jest.Mock).mock.calls[0][1].isCancelled()).toBe(false);
	finish();
	expect(fs.readFileSync(await second, 'utf8')).toBe('complete');
	expect(compileFile).toHaveBeenCalledTimes(1);
});

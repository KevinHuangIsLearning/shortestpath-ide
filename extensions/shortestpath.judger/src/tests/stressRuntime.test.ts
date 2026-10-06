/*---------------------------------------------------------------------------------------------
 * Copyright (c) 2026 ShortestPath IDE contributors. Licensed under GPL-3.0-or-later.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
jest.mock('vscode', () => ({
	Uri: { file: (fsPath: string) => ({ fsPath }) },
	workspace: { workspaceFolders: [], getConfiguration: (section: string) => ({ get: (key: string, fallback: unknown) => section === 'judger.execution' && key === 'redirectStdio' ? true : fallback }), openTextDocument: async () => ({ save: async () => true }) },
	window: { showErrorMessage: jest.fn() },
}), { virtual: true });
jest.mock('../utils', () => ({ getLanguage: (file: string) => file.endsWith('.js') ? ({ name: 'js', compiler: process.execPath, args: [], skipCompile: true }) : ({ name: 'cpp', compiler: 'c++', args: [], skipCompile: false }), ocHide: jest.fn(), ocShow: jest.fn(), ocWrite: jest.fn() }));
jest.mock('../preferences', () => ({ getSaveLocationPref: () => '', getCollectProblemsInRoot: () => false, getDefaultOnlineJudge: () => false, getCppOutputArgPref: () => '-o', getHideStderrorWhenCompiledOK: () => true, getIgnoreSTDERRORPref: () => true, getTimeOutPref: () => 3000 }));
jest.mock('../extension', () => ({ getJudgeViewProvider: () => ({ extensionToJudgeViewMessage: jest.fn() }) }));
jest.mock('../i18n', () => ({ __esModule: true, default: (_: string, text: string) => text }));
import { runStressTest } from '../stressTest';
import { Problem } from '../types';

const hasCompiler = spawnSync('c++', ['--version']).status === 0;
(hasCompiler ? test : test.skip)('real compiled stress target obeys freopen redirection and retains the failing input', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-stress-runtime-'));
	globalThis.logger = { log: jest.fn(), error: jest.fn() } as unknown as typeof globalThis.logger;
	globalThis.reporter = { sendTelemetryEvent: jest.fn() } as unknown as typeof globalThis.reporter;
	try {
		fs.mkdirSync(path.join(root, 'dist/static'), { recursive: true });
		fs.cpSync(path.resolve(__dirname, '../../static/tools'), path.join(root, 'dist/static/tools'), { recursive: true });
		globalThis.extensionContext = { extensionPath: root, globalStorageUri: { fsPath: path.join(root, 'storage') } } as typeof globalThis.extensionContext;
		const target = path.join(root, 'target.cpp'), generator = path.join(root, 'generator.cpp'), brute = path.join(root, 'brute.cpp');
		fs.writeFileSync(generator, '#include <cstdio>\nint main(){puts("7");}');
		fs.writeFileSync(brute, '#include <cstdio>\nint main(){int x;scanf("%d", &x);printf("%d\\n",x+1);}');
		fs.writeFileSync(target, '#include <cstdio>\nint main(){freopen("absent.in","r",stdin);freopen("unwanted.out","w",stdout);int x=0;scanf("%d",&x);printf("%d\\n",x+2);}');
		const onFailure = jest.fn();
		const result = await runStressTest({ srcPath: target, tests: [], name: 'A', url: '', interactive: false, memoryLimit: 256, timeLimit: 3000, group: '' } as Problem, generator, brute, 1, { onProgress: jest.fn(), onStatus: jest.fn(), onFailure });
		expect([result.state, onFailure.mock.calls[0][1].input, onFailure.mock.calls[0][1].output, onFailure.mock.calls[0][2].stdout, onFailure.mock.calls[0][2].verdict, fs.existsSync(path.join(root, 'unwanted.out'))]).toEqual(['found', '7\n', '8\n', '9\n', 'WA', false]);
	} finally { fs.rmSync(root, { recursive: true, force: true }); }
}, 30000);

test('stress uses the configured output allowance above the obsolete 4 MiB cap and stores the counterexample as files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-stress-large-runtime-'));
    globalThis.logger = { log: jest.fn(), error: jest.fn() } as unknown as typeof globalThis.logger;
    try {
        const target = path.join(root, 'target.js'), generator = path.join(root, 'generator.js'), brute = path.join(root, 'brute.js');
        fs.writeFileSync(generator, "process.stdout.write(Buffer.alloc(5*1024*1024,120))");
        fs.writeFileSync(brute, 'process.stdin.pipe(process.stdout)');
        fs.writeFileSync(target, "process.stdin.resume();process.stdout.write('wrong')");
        const onFailure = jest.fn();
        const result = await runStressTest({ srcPath: target, tests: [], name: 'A', url: '', interactive: false, memoryLimit: 256, timeLimit: 3000, group: '' }, generator, brute, 1, { onProgress: jest.fn(), onStatus: jest.fn(), onFailure });
        expect(result.state).toBe('found');
        const testcase = onFailure.mock.calls[0][1];
        expect(fs.statSync(testcase.inputPath).size).toBe(5 * 1024 * 1024);
        expect(fs.statSync(testcase.outputPath).size).toBe(5 * 1024 * 1024);
        expect(testcase.input).toBe('');
        expect(testcase.output).toBe('');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
}, 10000);

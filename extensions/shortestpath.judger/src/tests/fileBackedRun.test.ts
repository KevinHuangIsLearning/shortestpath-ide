import fs from 'fs';
import os from 'os';
import path from 'path';
jest.mock('vscode', () => ({
    workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }), openTextDocument: async () => ({ save: async () => true }) },
    window: { showTextDocument: async () => undefined, showErrorMessage: jest.fn() },
    ViewColumn: { One: 1 },
}), { virtual: true });
jest.mock('../utils', () => ({ getLanguage: () => ({ name: 'js', compiler: process.execPath, args: [], skipCompile: true }) }));
jest.mock('../compiler', () => ({ getBinSaveLocation: (file: string) => file, compileFile: async () => true, runningCompilers: [] }));
jest.mock('../preferences', () => ({ getTimeOutPref: () => 10000, getIgnoreSTDERRORPref: () => true, getSaveLocationPref: () => '', getCollectProblemsInRoot: () => false }));
jest.mock('../i18n', () => ({ __esModule: true, default: (_key: string, text: string) => text }));
jest.mock('../extension', () => ({ getJudgeViewProvider: () => ({ extensionToJudgeViewMessage: jest.fn() }) }));
import { runSingleAndSave } from '../webview/processRunSingle';
import { Problem } from '../types';

test('real child process judges a large file-backed testcase while returning a bounded display payload', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-file-run-'));
    globalThis.logger = { log: jest.fn(), error: jest.fn() } as unknown as typeof globalThis.logger;
    try {
        const source = path.join(root, 'main.js');
        fs.writeFileSync(source, "process.stdin.pipe(process.stdout);");
        const inputPath = path.join(root, '1.in');
        const outputPath = path.join(root, '1.out');
        const data = '12345678\n'.repeat(1024 * 1024);
        fs.writeFileSync(inputPath, data);
        fs.writeFileSync(outputPath, data);
        const problem = { srcPath: source, tests: [{ id: 1, input: '', output: '', inputPath, outputPath }] } as Problem;
        const result = await runSingleAndSave(problem, 1, true, true);
        expect(result?.pass).toBe(true);
        expect(result?.stdout.length).toBeLessThanOrEqual(65536);
        expect(result?.diff?.preview).toBe(true);
        expect(result?.diff?.lines.length).toBeLessThanOrEqual(10);
        expect(result?.stdout).toBe('');
        expect(fs.readFileSync(result!.stdoutPath!, 'utf8')).toBe(data);
        expect(problem.tests[0].input).toBe('');
        fs.writeFileSync(outputPath, 'wrong');
        expect((await runSingleAndSave(problem, 1, true, true))?.pass).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
}, 20000);

import { stopTestcase } from '../testcaseCancellation';
test('stop while reading answer returns STOP without launching the solution', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-cancel-read-'));
    globalThis.logger = { log: jest.fn(), error: jest.fn() } as unknown as typeof globalThis.logger;
    const source = path.join(root, 'main.js'); const answer = path.join(root, 'answer'); const marker = path.join(root, 'started');
    fs.writeFileSync(source, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'started')`);
    fs.writeFileSync(answer, 'expected');
    const original = fs.promises.readFile.bind(fs.promises);
    const spy = jest.spyOn(fs.promises, 'readFile').mockImplementation(async (...args: Parameters<typeof fs.promises.readFile>) => {
        if (args[0] === answer) { stopTestcase(source, 1); }
        return original(...args);
    });
    try {
        const result = await runSingleAndSave({ srcPath: source, tests: [{ id: 1, input: '', output: '', outputPath: answer }] } as Problem, 1, true, true);
        expect(result?.verdict).toBe('STOP');
        expect(fs.existsSync(marker)).toBe(false);
    } finally { spy.mockRestore(); fs.rmSync(root, { recursive: true, force: true }); }
});

import { runTestCase } from '../executions';
import { terminateProcess } from '../processTermination';
import { spawn } from 'child_process';

test('timeout ends a real solution that ignores SIGTERM', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-hard-stop-'));
    globalThis.logger = { log: jest.fn(), error: jest.fn() } as unknown as typeof globalThis.logger;
    const source = path.join(root, 'main.js');
    fs.writeFileSync(source, "process.on('SIGTERM',()=>{});setInterval(()=>{},10);");
    try {
        const result = await runTestCase({ name: 'js', compiler: process.execPath, args: [], skipCompile: true }, source, '', { timeoutMs: 500 });
        expect(result.timeOut).toBe(true);
        expect(result.signal).toBe('SIGKILL');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
}, 5000);

test('manual termination escalates when a real process ignores SIGTERM', async () => {
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},10);"]);
    try {
        await new Promise<void>(resolve => child.stdout.once('data', () => resolve()));
        const closed = new Promise<string | null>(resolve => child.once('close', (_code, signal) => resolve(signal)));
        terminateProcess(child);
        expect(await closed).toBe('SIGKILL');
    } finally { child.kill('SIGKILL'); }
}, 5000);

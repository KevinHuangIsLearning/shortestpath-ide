import fs from 'fs';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
jest.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }), { virtual: true });
jest.mock('../compiler', () => ({ compileFile: jest.fn(async (_source, options) => { require('fs').writeFileSync(options.outputPath, 'mock runner'); return true; }) }));
jest.mock('../toolProcess', () => ({ runTool: jest.fn(async (_command, args) => {
    const files = require('fs');
    files.writeFileSync(args[2], 'answer'); files.writeFileSync(args[3], '');
    files.writeFileSync(args[4], JSON.stringify({ cpuMs: 5, memoryBytes: 100, code: 0, signal: 0, timeOut: false }));
    return { code: 0, signal: null, time: 350, timeOut: false };
}) }));
import { runTool } from '../toolProcess';
import { runNative } from '../nativeRunner';

test.each([[100, 5000], [1000, 10000]])('CPU budget %i uses a separate bounded wall watchdog', async (cpuLimit, wallLimit) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-native-policy-'));
    try {
        const tools = path.join(root, 'dist/static/tools');
        fs.mkdirSync(tools, { recursive: true }); fs.writeFileSync(path.join(tools, 'runner.cpp'), 'mock source');
        globalThis.extensionContext = { extensionPath: root, globalStorageUri: { fsPath: path.join(root, 'storage') } } as vscode.ExtensionContext;
        const result = await runNative('/mock-solution', '', [], cpuLimit);
        const call = (runTool as jest.Mock).mock.calls.slice(-1)[0];
        expect([call[1][5], call[1][8], call[3]]).toEqual([String(cpuLimit), String(wallLimit), wallLimit + 2000]);
        expect([result.time, result.timeOut, result.code]).toEqual([5, false, 0]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

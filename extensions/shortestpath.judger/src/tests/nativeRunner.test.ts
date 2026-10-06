/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger. Licensed under GPL-3.0-or-later.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync as mockExecFileSync } from 'child_process';
import * as vscode from 'vscode';
jest.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) } }), { virtual: true });
jest.mock('../compiler', () => ({ compileFile: async (source: string, options: { outputPath: string }) => { require('child_process').execFileSync('c++', ['-std=c++17', source, '-o', options.outputPath]); return true; } }));
import { runNative } from '../nativeRunner';

test('native host passes output limits and classifies excess output as OLE', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-native-limit-'));
	try {
		const tools = path.join(root, 'dist/static/tools');
		fs.mkdirSync(tools, { recursive: true });
		fs.copyFileSync(path.resolve(__dirname, '../../static/tools/runner.cpp'), path.join(tools, 'runner.cpp'));
		globalThis.extensionContext = { extensionPath: root, globalStorageUri: { fsPath: path.join(root, 'storage') } } as vscode.ExtensionContext;
		const source = path.join(root, 'solution.cpp'), binary = path.join(root, 'solution');
		fs.writeFileSync(source, '#include <cstdio>\nint main(){for(int i=0;i<9*1024*1024;i++)putchar(120);}');
		mockExecFileSync('c++', [source, '-o', binary]);
		const accepted = await runNative(binary, '', [], 3000, 16 * 1024 * 1024);
		const limited = await runNative(binary, '', [], 3000, 1024);
		expect([accepted.code, accepted.outputLimitExceeded, accepted.stdout.length, limited.outputLimitExceeded, limited.stdout.length]).toEqual([0, false, 9 * 1024 * 1024, true, 1024]);
	} finally { fs.rmSync(root, { recursive: true, force: true }); }
}, 20000);

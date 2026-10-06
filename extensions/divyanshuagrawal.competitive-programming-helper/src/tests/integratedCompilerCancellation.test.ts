/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('vscode', () => ({ workspace: { openTextDocument: jest.fn() } }), { virtual: true });
jest.mock('../utils', () => ({ getLanguage: jest.fn(), ocHide: jest.fn() }));
jest.mock('../extension', () => ({ getJudgeViewProvider: jest.fn() }));
jest.mock('../preferences', () => ({ getDefaultOnlineJudge: () => true, getCppOutputArgPref: () => '-o', getHideStderrorWhenCompiledOK: () => false }));
jest.mock('child_process', () => ({ spawn: jest.fn() }));

import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { getLanguage } from '../utils';
import { compileFile, compilationsInProgress } from '../compiler';

test('stopping during document save never starts a compiler afterwards', async () => {
	globalThis.logger = { ...console };
	let finishSave!: (value: boolean) => void;
	(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({ save: () => new Promise(resolve => { finishSave = resolve; }) });
	let cancelled = false;
	const compile = compileFile('/A.cpp', { silent: true, isCancelled: () => cancelled });
	expect(compilationsInProgress).toBe(1);
	await Promise.resolve();
	cancelled = true;
	finishSave(true);
	expect(await compile).toBe(false);
	expect(compilationsInProgress).toBe(0);
	expect(spawn).not.toHaveBeenCalled();
});

test.each(['interrupted', 'launch error'])('%s compilation waits for close and removes partial binary and debug symbols', async mode => {
    globalThis.logger = { ...console, log: jest.fn(), error: jest.fn() };
    const directory = mkdtempSync(path.join(os.tmpdir(), 'sp-compile-stop-'));
    const outputPath = path.join(directory, 'A.bin');
    const compiler = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
    (spawn as jest.Mock).mockReturnValue(compiler);
    (getLanguage as jest.Mock).mockReturnValue({ name: 'cpp', compiler: 'g++', args: ['-g'] });
    (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({ save: async () => true });
    try {
        const compile = compileFile(path.join(directory, 'A.cpp'), { silent: true, outputPath });
        await new Promise(resolve => setImmediate(resolve));
        if (mode === 'launch error') { compiler.emit('error', new Error('Compiler launch failed')); }
        else { compiler.emit('exit', null, 'SIGTERM'); }
        expect(compilationsInProgress).toBe(1);
        writeFileSync(outputPath, 'partial binary');
        mkdirSync(`${outputPath}.dSYM`);
        compiler.emit('close', null, 'SIGTERM');
        expect(await compile).toBe(false);
        expect([existsSync(outputPath), existsSync(`${outputPath}.dSYM`), compilationsInProgress]).toEqual([false, false, 0]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});

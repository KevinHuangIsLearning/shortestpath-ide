/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../compiler', () => ({ compileFile: jest.fn(async () => true) }));
jest.mock('../utils', () => ({ getLanguage: jest.fn(() => ({ name: 'cpp', compiler: 'g++', args: [], skipCompile: false })) }));
jest.mock('../preferences', () => ({ getIgnoreSTDERRORPref: jest.fn(() => false) }));
jest.mock('../executions', () => ({ runTestCase: jest.fn(), runCustomChecker: jest.fn() }));

import { runEnvironmentSelfTest } from '../environmentSelfTest';
import { compileFile } from '../compiler';
import { runTestCase } from '../executions';
import { isResultCorrect } from '../judge';

globalThis.logger = { ...console, log: jest.fn() };
const samples = [{ input: '1 2\n', output: '3\n' }, { input: '-7 4\n', output: '-3\n' }];
let directory: string;
let sourcePath: string;

beforeEach(async () => {
	jest.clearAllMocks();
	directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cph-self-test-unit-'));
	sourcePath = path.join(directory, 'check.cpp');
	(compileFile as jest.Mock).mockImplementation(async (_file, options) => { await fs.promises.writeFile(options.outputPath, 'binary'); return true; });
	(runTestCase as jest.Mock).mockImplementation(async (_language, _binary, input) => ({ stdout: samples.find(sample => sample.input === input)?.output, stderr: '', code: 0, signal: null, time: 1, timeOut: false }));
});
afterEach(async () => { await fs.promises.rm(directory, { recursive: true, force: true }); });

test('uses CPH compiler, runner and text judge, checks AC and WA, and cleans the binary', async () => {
	const progress = jest.fn();
	const result = await runEnvironmentSelfTest({ sourcePath, samples, reportProgress: progress });
	expect(result).toEqual({ success: true });
	expect(compileFile).toHaveBeenCalledWith(sourcePath, expect.objectContaining({ silent: true, timeout: 60000, outputPath: expect.stringContaining(directory) }));
	expect(runTestCase).toHaveBeenCalledTimes(3);
	expect(progress).toHaveBeenCalledWith(expect.objectContaining({ type: 'sample', pass: true, actual: '3\n' }));
	expect(fs.existsSync(path.join(directory, process.platform === 'win32' ? 'cph-check.exe' : 'cph-check.bin'))).toBe(false);
});

test('fails when compilation fails without running testcases', async () => {
	(compileFile as jest.Mock).mockResolvedValue(false);
	expect(await runEnvironmentSelfTest({ sourcePath, samples })).toEqual({ success: false, reason: 'compile' });
	expect(runTestCase).not.toHaveBeenCalled();
});

test.each(['wrong output', 'timeout', 'stderr', 'nonzero exit'])('fails a CPH sample on %s', async failure => {
	(runTestCase as jest.Mock).mockResolvedValue({ stdout: failure === 'wrong output' ? '4\n' : '3\n', stderr: failure === 'stderr' ? 'error' : '', code: failure === 'nonzero exit' ? 1 : 0, signal: null, time: 1, timeOut: failure === 'timeout' });
	expect(await runEnvironmentSelfTest({ sourcePath, samples })).toEqual(expect.objectContaining({ success: false, reason: 'sample' }));
	expect(runTestCase).toHaveBeenCalledTimes(1);
});

test('validates the deliberately wrong expected answer through the production judge', () => {
	expect(isResultCorrect({ id: 1, input: '1 2', output: 'SHORTESTPATH_WRONG_ANSWER' }, '3\n')).toBe(false);
});

test('current CPH text judge does not silently apply a float tolerance', () => {
	expect(isResultCorrect({ id: 1, input: '', output: '0.3' }, '0.30000000000000004')).toBe(false);
});

test('invalid invocation cannot create a passing self-test', async () => {
	await expect(runEnvironmentSelfTest({ sourcePath: 'relative.cpp', samples })).rejects.toThrow(/Invalid/);
	await expect(runEnvironmentSelfTest({ sourcePath, samples: [] })).rejects.toThrow(/Invalid/);
	expect(compileFile).not.toHaveBeenCalled();
});

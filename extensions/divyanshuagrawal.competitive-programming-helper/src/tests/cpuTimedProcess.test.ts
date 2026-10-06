/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getTestCaseTime, killTestCaseProcess, spawnTestCaseProcess } from '../cpuTimedProcess';

jest.mock('vscode', () => ({ window: { showErrorMessage: jest.fn() } }), { virtual: true });
jest.mock('../compiler', () => ({ onlineJudgeEnv: false, runningCompilers: [] }));
jest.mock('../preferences', () => ({ getTimeOutPref: jest.fn(() => 5000) }));
jest.mock('../utils/customChecker', () => ({ executeCustomChecker: jest.fn() }));
import { runTestCase } from '../executions';
import { getTimeOutPref } from '../preferences';

globalThis.logger = { ...console, log: jest.fn(), error: jest.fn() };

const macTest = process.platform === 'darwin' ? test : test.skip;

async function run(command: string, args: string[], input = '') {
	const started = performance.now();
	const child = spawnTestCaseProcess(command, args, {});
	let stdout = '';
	let stderr = '';
	child.stdout.on('data', data => { stdout += data.toString(); });
	child.stderr.on('data', data => { stderr += data.toString(); });
	const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
		child.once('error', reject);
		child.once('close', (code, signal) => resolve({ code, signal }));
	});
	child.stdin.end(input);
	const status = await closed;
	const wall = performance.now() - started;
	return { ...status, stdout, stderr, wall, cpu: getTestCaseTime(child, Math.round(wall)) };
}

macTest('freshly compiled C++ is executed once and reports CPU usage rather than launch or sleep time', async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cph-cpu-test-'));
	try {
		const source = path.join(directory, 'main.cpp');
		const binary = path.join(directory, '程序 $ literal.cpp.bin');
		const marker = path.join(directory, 'executions');
		await fs.writeFile(source, `#include <chrono>
#include <thread>
#include <fstream>
#include <iostream>
int main(int argc, char** argv) {
  std::ofstream(argv[1], std::ios::app) << 'x';
  long long a, b; std::cin >> a >> b;
  std::this_thread::sleep_for(std::chrono::milliseconds(200));
  auto end = std::chrono::steady_clock::now() + std::chrono::milliseconds(120);
  while (std::chrono::steady_clock::now() < end) {}
  std::cout << a + b << std::endl;
  std::cerr << "program stderr";
}
`);
		const compiler = process.env.CPH_TEST_CPP_COMPILER || 'g++';
		execFileSync(compiler, ['-std=c++20', '-O2', '-g', source, '-o', binary]);
		const first = await run(binary, [marker], '1 2');
		const second = await run(binary, [marker], '-7 4');
		expect({ code: first.code, signal: first.signal, stdout: first.stdout, stderr: first.stderr, executions: await fs.readFile(marker, 'utf8') }).toEqual({ code: 0, signal: null, stdout: '3\n', stderr: 'program stderr', executions: 'xx' });
		for (const result of [first, second]) {
			expect(result.cpu).toBeGreaterThan(70);
			expect(result.cpu).toBeLessThan(200);
			expect(result.wall - result.cpu).toBeGreaterThan(150);
		}
		expect(second.stdout).toBe('-3\n');
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
}, 15000);

macTest('passes arguments literally and drains all program output before completion', async () => {
	const argument = 'spaces; $(echo injected) `echo injected` "quotes" 中文';
	const output = 'x'.repeat(1024 * 1024);
	const result = await run(process.execPath, ['-e', 'process.stdout.write(process.argv[1] + "x".repeat(1024 * 1024)); process.stderr.write("stderr"); process.exitCode = 7;', argument]);
	expect({ stdout: result.stdout, stderr: result.stderr, code: result.code }).toEqual({ stdout: argument + output, stderr: 'stderr', code: 7 });
});

macTest('stopping a timed run also terminates its program', async () => {
	const child = spawnTestCaseProcess(process.execPath, ['-e', 'console.log(process.pid); setInterval(() => {}, 1000);'], {});
	const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
	try {
		const pid = await new Promise<number>(resolve => child.stdout.once('data', data => resolve(Number(data.toString().trim()))));
		killTestCaseProcess(child);
		await closed;
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(() => process.kill(pid, 0)).toThrow();
	} finally {
		killTestCaseProcess(child);
		child.stdin.end();
	}
});

macTest('CPH reports CPU milliseconds and keeps a wall-clock timeout', async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cph-run-time-'));
	const script = path.join(directory, 'main.js');
	const language = { name: 'js' as const, compiler: process.execPath, args: [], skipCompile: true };
	try {
		await fs.writeFile(script, 'setTimeout(() => { process.stdout.write("done"); }, 300);');
		const started = performance.now();
		const result = await runTestCase(language, script, '');
		expect({ stdout: result.stdout, stderr: result.stderr, code: result.code, timeOut: result.timeOut }).toEqual({ stdout: 'done', stderr: '', code: 0, timeOut: false });
		expect(performance.now() - started - result.time).toBeGreaterThan(200);
		(getTimeOutPref as jest.Mock).mockReturnValueOnce(100);
		const timedOut = await runTestCase(language, script, '');
		expect(timedOut.timeOut).toBe(true);
		expect(timedOut.stdout).toBe('');
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
});

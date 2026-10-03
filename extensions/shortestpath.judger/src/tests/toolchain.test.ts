/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, ChildProcessWithoutNullStreams } from 'child_process';
import { executeTestlibChecker } from '../testlibChecker';
import { runInteractive } from '../interactiveRunner';
import { runTool } from '../toolProcess';

describe('real tool processes', () => {
	let directory: string;
	const processes: ChildProcessWithoutNullStreams[] = [];
	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-tool-test-'));
	});
	afterEach(() => {
		processes.forEach((child) => child.kill('SIGKILL'));
		processes.length = 0;
		fs.rmSync(directory, { recursive: true, force: true });
	});
	test('spawn failure, timeout and successful stderr diagnostics all settle and release processes', async () => {
		const missing = await runTool(
			path.join(directory, 'absent'),
			[],
			processes,
			1000,
		);
		const timeout = await runTool(
			process.execPath,
			['-e', 'setInterval(()=>{},1000)'],
			processes,
			30,
		);
		const success = await runTool(
			process.execPath,
			['-e', 'console.error("diagnostic")'],
			processes,
			2000,
		);
		expect([
			missing.signal,
			timeout.timeOut,
			success.code,
			success.stderr.trim(),
			processes.length,
		]).toEqual(['SPAWN_ERROR', true, 0, 'diagnostic', 0]);
	});

	test('native checker distinguishes timeout, crash and explicit testlib failure', async () => {
		const source = path.join(directory, 'status.cpp');
		const executable = path.join(directory, 'status');
		fs.writeFileSync(source, '#include <fstream>\n#include <csignal>\nint main(int argc,char** argv){int mode;std::ifstream(argv[1])>>mode;if(mode==99)for(;;){}if(mode==98)raise(SIGSEGV);return mode;}');
		execFileSync('c++', [source, '-o', executable]);
		for (const [mode, verdict] of [[0, 'AC'], [1, 'WA'], [2, 'PE'], [3, 'FAIL'], [7, 'PARTIAL'], [42, 'FAIL'], [98, 'FAIL'], [99, 'TLE']] as const) {
			const result = await executeTestlibChecker(executable, String(mode), '', '', processes, mode === 99 ? 100 : 10000);
			expect(result.verdict).toBe(verdict);
		}
	});
	test('real testlib checker sees input, output, answer in the expected order', async () => {
		const source = path.join(directory, 'checker.cpp');
		const executable = path.join(directory, 'checker');
		fs.writeFileSync(
			source,
			'#include "testlib.h"\nint main(int argc,char** argv){registerTestlibCmd(argc,argv); int n=inf.readInt(); int got=ouf.readInt(); int expected=ans.readInt(); if(got!=expected+n) quitf(_wa,"different"); quitf(_ok,"correct");}\n',
		);
		execFileSync('c++', [
			'-std=c++17',
			'-I',
			path.resolve(__dirname, '../../static/testlib'),
			source,
			'-o',
			executable,
		]);
		const accepted = await executeTestlibChecker(
			executable,
			'2\n',
			'5\n',
			'3\n',
			processes,
			2000,
		);
		const rejected = await executeTestlibChecker(
			executable,
			'2\n',
			'6\n',
			'3\n',
			processes,
			2000,
		);
		expect([accepted.verdict, rejected.verdict, processes.length]).toEqual([
			'AC',
			'WA',
			0,
		]);
	}, 20000);
	test('interactive execution applies a small configured output cap', async () => {
		const source = path.join(directory, 'interactor.cpp'), binary = path.join(directory, 'interactor');
		fs.writeFileSync(source, '#include <iostream>\nint main(){char c;while(std::cin.get(c)){}return 0;}');
		execFileSync('c++', [source, '-o', binary]);
		const result = await runInteractive({ command: process.execPath, args: ['-e', "process.stdout.write('x'.repeat(8192));"] }, binary, '', processes, 3000, directory, 1024);
		expect(result.run.outputLimitExceeded).toBe(true);
	}, 20000);
	test('duplex interaction produces checker feedback and both programs terminate', async () => {
		const source = path.join(directory, 'interactor.cpp');
		const executable = path.join(directory, 'interactor');
		fs.writeFileSync(
			source,
			'#include <iostream>\n#include <fstream>\nint main(int argc,char** argv){std::ifstream input(argv[1]); int a; input>>a; std::cout<<a<<std::endl; int result;std::cin>>result;std::ofstream(argv[2])<<result; return result==a*2?0:1;}\n',
		);
		execFileSync('c++', [source, '-o', executable]);
		const result = await runInteractive(
			{
				command: process.execPath,
				args: [
					'-e',
					'process.stdin.once("data",d=>{console.log(Number(d)*2);process.exit(0)})',
				],
			},
			executable,
			'21\n',
			processes,
			3000,
		);
		expect([
			result.run.code,
			result.checker.code,
			result.run.stdout,
			processes.length,
		]).toEqual([0, 0, '42', 0]);
	}, 20000);
});

test('auxiliary output decodes split UTF-8 bytes and bounds runaway output', async () => {
    const children: ChildProcessWithoutNullStreams[] = [];
    const run = await runTool(process.execPath, ['-e', "const b=Buffer.from('中文');process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),20)"], children, 3000);
    expect(run.stdout).toBe('中文');
    const overflow = await runTool(process.execPath, ['-e', "const fs=require('fs'),b=Buffer.alloc(65536,120);for(;;)fs.writeSync(1,b)"], children, 3000);
    expect(overflow.outputLimitExceeded).toBe(true);
    expect(Buffer.byteLength(overflow.stdout)).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(children).toHaveLength(0);
});

test('a rejecting interactor finishes a waiting solution and records judge-initiated cleanup', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-interactor-verdict-'));
    const children: ChildProcessWithoutNullStreams[] = [];
    try {
        const source = path.join(directory, 'interactor.cpp'), binary = path.join(directory, 'interactor');
        fs.writeFileSync(source, '#include <iostream>\nint main(){int x;std::cin>>x;std::cerr<<"wrong";return 1;}');
        execFileSync('c++', [source, '-o', binary]);
        const result = await runInteractive({ command: process.execPath, args: ['-e', "process.stdout.write('1\\n');setInterval(()=>{},1000)"] }, binary, '', children, 3000);
        expect(result.checker.code).toBe(1);
        expect(result.solutionTerminatedByJudge).toBe(true);
        expect(result.run.timeOut).toBe(false);
        expect(children).toHaveLength(0);
    } finally { children.forEach(child => child.kill('SIGKILL')); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('Python checkers keep the existing two-file argument protocol and honor cancellation', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-python-checker-'));
    const children: ChildProcessWithoutNullStreams[] = [];
    try {
        const checker = path.join(directory, 'checker.py');
        fs.writeFileSync(checker, 'import sys\na,b=sys.argv[1:]\nassert open(a).read()=="input"\nassert open(b).read()=="output"\nprint("中文")\n');
        const result = await executeTestlibChecker(checker, 'input', 'output', 'answer', children, 3000);
        expect(result.verdict).toBe('AC');
        expect(result.stdout.trim()).toBe('中文');
        await expect(executeTestlibChecker(checker, '', '', '', children, 3000, () => { throw new Error('Cancelled'); })).rejects.toThrow('Cancelled');
        expect(children).toHaveLength(0);
    } finally { children.forEach(child => child.kill('SIGKILL')); fs.rmSync(directory, { recursive: true, force: true }); }
});

test.each(['missing', 'crash', 'overflow'])('interactor %s is a judge failure and cleanup is recorded separately', async mode => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-bad-interactor-'));
    const children: ChildProcessWithoutNullStreams[] = [];
    try {
        const source = path.join(directory, 'interactor.cpp'), binary = path.join(directory, 'interactor');
        if (mode !== 'missing') {
            fs.writeFileSync(source, mode === 'crash' ? '#include <csignal>\nint main(){raise(SIGSEGV);}' : '#include <cstdio>\nint main(){for(;;)fputs("xxxxxxxxxxxxxxxxxxxxxxxx",stderr);}');
            execFileSync('c++', [source, '-o', binary]);
        }
        const result = await runInteractive({ command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] }, binary, '', children, 3000, undefined, 1024);
        expect(result.solutionTerminatedByJudge).toBe(true);
        expect(result.run.outputLimitExceeded).not.toBe(true);
        expect(result.run.timeOut).toBe(false);
        expect(result.checker.signal || result.checker.outputLimitExceeded).toBeTruthy();
    } finally { children.forEach(child => child.kill('SIGKILL')); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('a legacy two-file Python checker exit 2 is a failure rather than accepted PE', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-python-exit-'));
    try {
        const checker = path.join(directory, 'checker.py'); fs.writeFileSync(checker, 'import sys\nsys.exit(2)\n');
        expect((await executeTestlibChecker(checker, '', '', '', [], 3000)).verdict).toBe('FAIL');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

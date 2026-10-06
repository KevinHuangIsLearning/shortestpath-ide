/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { compareOutput } from '../outputComparison';

describe('independent native tools', () => {
	let directory: string;
	const tools = path.resolve(__dirname, '../../static/tools');
	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-中文-'));
	});
	afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
	test('native runner reports CPU, peak memory, exit code and timeout without leaking child output', () => {
		const runner = path.join(directory, 'runner');
		execFileSync('c++', [
			'-std=c++17',
			path.join(tools, 'runner.cpp'),
			'-o',
			runner,
		]);
		const source = path.join(directory, 'solution.cpp'),
			binary = path.join(directory, 'solution');
		fs.writeFileSync(
			source,
			'#include <iostream>\nint main(){int n;std::cin>>n;if(n<0)for(;;){}std::cout<<n+1;return 0;}',
		);
		execFileSync('c++', [source, '-o', binary]);
		const files = ['input', 'output', 'error', 'metrics'].map((file) =>
			path.join(directory, file),
		);
		fs.writeFileSync(files[0], '41');
		execFileSync(runner, [binary, ...files, '1000', '0', '16777216', '10000'], {
			timeout: 3000,
		});
		const success = JSON.parse(fs.readFileSync(files[3], 'utf8'));
		expect([
			fs.readFileSync(files[1], 'utf8'),
			success.code,
			success.timeOut,
			success.cpuMs >= 0,
			success.memoryBytes > 0,
		]).toEqual(['42', 0, false, true, true]);
		fs.writeFileSync(files[0], '-1');
		execFileSync(runner, [binary, ...files, '30', '0', '16777216', '5000'], { timeout: 3000 });
		expect(JSON.parse(fs.readFileSync(files[3], 'utf8')).timeOut).toBe(
			true,
		);
	}, 20000);
	test('native output honors the configured per-stream limit above and below 8 MiB', () => {
		const runner = path.join(directory, 'runner'), binary = path.join(directory, 'solution');
		const source = path.join(directory, 'solution.cpp');
		execFileSync('c++', ['-std=c++17', path.join(tools, 'runner.cpp'), '-o', runner]);
		fs.writeFileSync(source, '#include <cstdio>\nint main(){for(int i=0;i<9*1024*1024;i++)putchar(120);}');
		execFileSync('c++', [source, '-o', binary]);
		const files = ['input', 'output', 'error', 'metrics'].map(file => path.join(directory, file));
		fs.writeFileSync(files[0], '');
		execFileSync(runner, [binary, ...files, '3000', '0', String(16 * 1024 * 1024), '30000'], { timeout: 5000 });
		const success = JSON.parse(fs.readFileSync(files[3], 'utf8'));
		expect([fs.statSync(files[1]).size, success.code, success.signal]).toEqual([9 * 1024 * 1024, 0, 0]);
		fs.unlinkSync(files[1]); fs.unlinkSync(files[2]);
		execFileSync(runner, [binary, ...files, '3000', '0', '1024', '30000'], { timeout: 5000 });
		expect(fs.statSync(files[1]).size).toBeGreaterThan(1024);
		expect(fs.statSync(files[1]).size).toBeLessThanOrEqual(1025);
	}, 20000);
	test('C++ timing and stdio interception compile and preserve testcase data', () => {
		const source = path.join(directory, 'solution.cpp'),
			binary = path.join(directory, 'solution');
		fs.writeFileSync(
			source,
			'#include <iostream>\nint main(){std::freopen("missing.in","r",stdin);freopen("unwanted.out","w",stdout);int n;std::cin>>n;std::cout<<n*2;}',
		);
		execFileSync('c++', [
			'-std=c++17',
			'-include',
			path.join(tools, 'wrapper.hpp'),
			'-include',
			path.join(tools, 'hook.hpp'),
			source,
			'-o',
			binary,
		]);
		expect(
			execFileSync(binary, [], {
				input: '21',
				cwd: directory,
				stdio: ['pipe', 'pipe', 'pipe'],
			}).toString(),
		).toBe('42');
		expect(fs.existsSync(path.join(directory, 'unwanted.out'))).toBe(false);
	}, 20000);
	test('standard comparison distinguishes presentation from wrong tokens', () => {
		expect([
			compareOutput('1 \t\r\n\n', '1\n'),
			compareOutput('1 2\n', '1\n2'),
			compareOutput('1 2', '12'),
		]).toEqual(['AC', 'PE', 'WA']);
	});
});

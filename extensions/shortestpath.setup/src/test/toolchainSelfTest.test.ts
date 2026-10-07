/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { compilerFallbackFlags, runToolchainCommand, runToolchainSelfTest, selfTestSamples, type ToolchainCommand } from '../toolchainSelfTest';

test('GCC include discovery and the C++20 self-test retain a managed junction prefix', async () => {
	const compiler = 'C:\\.shortestpath-toolchain-0123456789ab\\User\\globalStorage\\shortestpath.shortestpath-setup\\toolchains\\winlibs\\mingw64-ucrt-15\\bin\\g++.exe';
	const discovery: string[][] = [];
	await compilerFallbackFlags(compiler, async (_executable, args, report) => {
		discovery.push([...args]);
		if (args.includes('-dumpmachine')) { return 'x86_64-w64-mingw32\n'; }
		report('#include <...> search starts here:\n C:/short/include\nEnd of search list.\n');
		return '';
	});
	let compilation: readonly string[] = [];
	await runToolchainSelfTest(compiler, 'clangd', ['-std=c++20'], () => {}, async () => {}, async (_executable, args, _report, input) => {
		if (args.includes('-o')) { compilation = args; }
		return !args.length ? selfTestSamples.find(sample => sample.input === input)!.output : '';
	});
	assert.deepEqual({ discovery, compilation: compilation.slice(0, 7) }, {
		discovery: [['-no-canonical-prefixes', '-E', '-x', 'c++', '-v', '-'], ['-dumpmachine']],
		compilation: ['-std=c++20', '-O2', '-g', '-Wall', '-Wextra', '-DDEBUG', '-no-canonical-prefixes']
	});
});

test('extracts C++ system headers including paths with spaces and frameworks', async () => {
	const flags = await compilerFallbackFlags('g++', async (_executable, args, report) => {
		if (args[0] === '-dumpmachine') { return 'x86_64-w64-mingw32\n'; }
		assert.deepEqual(args, ['-E', '-x', 'c++', '-v', '-']);
		report('#include <...> search starts here:\n /toolchain folder/include/c++\n /SDK/Frameworks (framework directory)\nEnd of search list.\n');
		return '';
	});
	assert.equal(flags[0], '-std=c++20');
	assert.ok(flags.includes('--target=x86_64-w64-mingw32'));
	assert.deepEqual(flags.slice(-4), ['-isystem', '/toolchain folder/include/c++', '-iframework', '/SDK/Frameworks']);
	await assert.rejects(compilerFallbackFlags('g++', async () => ''), /系统头文件/);
});

test('checks real program output and clangd configuration, then removes temporary files', async () => {
	let directory = '';
	const calls: string[] = [];
	const run: ToolchainCommand = async (executable, args, _report, input) => {
		calls.push(executable);
		if (args.includes('-o')) {
			const file = args[args.indexOf('-o') - 1]; directory = path.dirname(file);
			assert.match(fs.readFileSync(file, 'utf8'), /std::cin >> a >> b/);
			assert.deepEqual(args.slice(0, 6), ['-std=c++20', '-O2', '-g', '-Wall', '-Wextra', '-DDEBUG']);
		} else if (args[0]?.startsWith('--check=')) {
			const commands = JSON.parse(fs.readFileSync(path.join(directory, 'compile_commands.json'), 'utf8'));
			assert.deepEqual(commands[0].arguments.slice(0, 3), ['clang', '-std=c++20', '-isystem']);
			assert.ok(args.includes('--enable-config=false'));
		} else if (!args.length) { return selfTestSamples.find(sample => sample.input === input)!.output; }
		return '';
	};
	await runToolchainSelfTest('g++', 'clangd', ['-std=c++20', '-isystem', '/includes'], () => {}, async (file, samples) => { assert.ok(fs.existsSync(file)); assert.deepEqual(samples, selfTestSamples); }, run);
	assert.deepEqual(calls.slice(0, 3), ['g++', 'clangd', 'g++']);
	assert.equal(calls.at(-1), 'clangd');
	assert.equal(fs.existsSync(directory), false);
});

test('rejects bad output or clangd failure and cleans up after either', async () => {
	for (const failure of ['output', 'clangd']) {
		let directory = '';
		let checkedClangd = false;
		await assert.rejects(runToolchainSelfTest('g++', 'clangd', ['-std=c++20'], () => {}, async () => {}, async (_executable, args, _report, input) => {
			if (args.includes('-o')) { directory = path.dirname(args[args.indexOf('-o') - 1]); }
			if (!args.length) { return failure === 'output' ? 'wrong output' : selfTestSamples.find(sample => sample.input === input)!.output; }
			if (args[0]?.startsWith('--check=')) { checkedClangd = true; throw new Error('missing header'); }
			return '';
		}), failure === 'output' ? /输出/ : /missing header/);
		assert.equal(checkedClangd, failure === 'clangd');
		assert.equal(fs.existsSync(directory), false);
	}
});

test('command executor ends stdin and propagates nonzero exits', async () => {
	assert.equal(await runToolchainCommand(process.execPath, ['-e', 'process.stdin.on(\'data\',d=>process.stdout.write(d));process.stdin.on(\'end\',()=>process.stdout.write(\'ended\'));process.stdin.resume();'], () => {}, '1 2\n'), '1 2\nended');
	await assert.rejects(runToolchainCommand(process.execPath, ['-e', 'console.error(\'compiler failed\');process.exit(7);'], () => {}), /compiler failed/);
});


test('a failed Judger self-test blocks readiness and cleans up before clangd', async () => {
	let directory = '';
	let checkedClangd = false;
	await assert.rejects(runToolchainSelfTest('g++', 'clangd', ['-std=c++20'], () => {}, async () => { throw new Error('Judger failed'); }, async (_executable, args, _report, input) => {
		if (args.includes('-o')) { directory = path.dirname(args[args.indexOf('-o') - 1]); }
		if (!args.length) { return selfTestSamples.find(sample => sample.input === input)!.output; }
		if (args[0]?.startsWith('--check=')) { checkedClangd = true; }
		return '';
	}), /Judger failed/);
	assert.equal(checkedClangd, false);
	assert.equal(fs.existsSync(directory), false);
});

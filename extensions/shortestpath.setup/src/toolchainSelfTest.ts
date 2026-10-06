/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type ToolchainCommand = (executable: string, args: readonly string[], report: (message: string) => void, input?: string) => Promise<string>;

export const runToolchainCommand: ToolchainCommand = (executable, args, report, input = '') => new Promise((resolve, reject) => {
	const child = execFile(executable, [...args], { timeout: 60000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, env: { ...process.env, LC_ALL: 'C' } }, (error, stdout, stderr) => {
		if (error) {
			reject(new Error(`${executable}: ${error.message}\n${stderr}`));
		} else {
			resolve(stdout);
		}
	});
	child.stdin?.end(input);
	child.stdout?.on('data', chunk => report(String(chunk)));
	child.stderr?.on('data', chunk => report(String(chunk)));
});

/** Use explicit includes so an ordinary file works without a project .clangd. */
export async function compilerFallbackFlags(compiler: string, run: ToolchainCommand = runToolchainCommand, cppStandard = 'c++20'): Promise<string[]> {
	let output = '';
	await run(compiler, ['-E', '-x', 'c++', '-v', '-'], message => { output += message; });
	const search = output.match(/#include <\.\.\.> search starts here:\s*([\s\S]*?)End of search list\./)?.[1];
	const paths = search?.split(/\r?\n/).map(line => line.trim()).filter(Boolean) ?? [];
	if (!paths.length) {
		throw new Error('无法读取编译器的系统头文件路径。');
	}
	const target = (await run(compiler, ['-dumpmachine'], () => {})).trim();
	if (!/^[a-zA-Z0-9_.]+(?:-[a-zA-Z0-9_.]+)+$/.test(target)) {
		throw new Error('无法读取编译器的目标平台。');
	}
	return [`-std=${cppStandard}`, `--target=${target}`, '-Wall', '-Wextra', '-DDEBUG', '-Drsize_t=size_t', '-D__STDC_WANT_LIB_EXT1__=1', '-D__float128=long double', '-U__SIZEOF_FLOAT128__',
		...paths.flatMap(directory => directory.endsWith(' (framework directory)')
			? ['-iframework', directory.replace(/ \(framework directory\)$/, '')]
			: ['-isystem', directory])];
}

export const selfTestSamples = [
	{ input: '1 2\n', output: '3\n' },
	{ input: '-7 4\n', output: '-3\n' },
	{ input: '0 0\n', output: '0\n' },
	{ input: '1000000000 1000000000\n', output: '2000000000\n' }
];

const source = `#include <bits/stdc++.h>
static_assert(__cplusplus >= 202002L);
int main() {
	long long a, b;
	if (!(std::cin >> a >> b)) return 1;
	std::cout << a + b << "\\n";
}
`;

export type CphSelfTest = (file: string, samples: typeof selfTestSamples, report: (message: string) => void) => Promise<void>;

export async function runToolchainSelfTest(compiler: string, clangd: string, fallbackFlags: readonly string[], report: (message: string) => void, testCph: CphSelfTest, run: ToolchainCommand = runToolchainCommand): Promise<void> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shortestpath-env-check-'));
	try {
		const file = path.join(directory, 'check.cpp');
		const executable = path.join(directory, process.platform === 'win32' ? 'check.exe' : 'check');
		await fs.writeFile(file, source);
		report('检查编译器与 clangd 版本…');
		await run(compiler, ['--version'], report);
		await run(clangd, ['--version'], report);
		report('编译 C++20 测试程序…');
		await run(compiler, ['-std=c++20', '-O2', '-g', '-Wall', '-Wextra', '-DDEBUG', file, '-o', executable], report);
		report('检查命令行 A+B 样例结果…');
		for (const sample of selfTestSamples) {
			const output = await run(executable, [], report, sample.input);
			if (output.trim() !== sample.output.trim()) {
				throw new Error('测试程序的输出不符合预期。');
			}
		}
		report('检查 CPH 编译、运行与样例判题…');
		await testCph(file, selfTestSamples, report);
		// Match clangd's fallback command for files with no project configuration.
		await fs.writeFile(path.join(directory, 'compile_commands.json'), JSON.stringify([{ directory, file, arguments: ['clang', ...fallbackFlags, file] }]));
		report('检查 clangd 的 C++20 语法与系统头文件…');
		await run(clangd, [`--check=${file}`, `--compile-commands-dir=${directory}`, '--enable-config=false', '--log=error'], report);
		report('命令行、CPH 与代码提示自测全部通过。');
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
}

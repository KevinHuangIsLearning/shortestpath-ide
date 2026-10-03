/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { ChildProcessWithoutNullStreams } from 'child_process';
import * as vscode from 'vscode';
import { Run } from './types';
import { compileFile } from './compiler';
import { runTool } from './toolProcess';

export async function runNative(
	program: string,
	input: string,
	processes: ChildProcessWithoutNullStreams[],
	timeout: number,
	maxOutputSize = 8 * 1024 * 1024,
    inputPath?: string,
    cwd?: string,
    checkCancelled?: () => void,
): Promise<Run> {
	const root = globalThis.extensionContext.extensionPath;
	const source = path.join(root, 'dist/static/tools/runner.cpp');
	const hash = crypto
		.createHash('sha256')
		.update(fs.readFileSync(source))
		.digest('hex')
		.slice(0, 16);
	const cache = path.join(
		globalThis.extensionContext.globalStorageUri.fsPath,
		'native',
	);
	fs.mkdirSync(cache, { recursive: true });
	const executable = path.join(
		cache,
		`runner-${process.platform}-${process.arch}-${hash}${
			process.platform === 'win32' ? '.exe' : ''
		}`,
	);
	if (!fs.existsSync(executable)) {
		if (
			!(await compileFile(source, {
				outputPath: executable,
				additionalArgs: [
					'-std=c++17',
					...(process.platform === 'win32'
						? ['-lpsapi', '-lshell32']
						: []),
				],
			}))
		) {
			throw new Error('Could not compile the native runner');
		}
	}
	const wallTimeout = Math.max(5000, timeout * 10);
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-run-'));
	try {
		const paths = ['input', 'output', 'stderr', 'metrics.json'].map(
			(file) => path.join(directory, file),
		);
		if (inputPath) { paths[0] = inputPath; } else { fs.writeFileSync(paths[0], input); }
		checkCancelled?.();
		const wrapper = await runTool(
			executable,
			[
				program,
				...paths,
				String(timeout),
				vscode.workspace
					.getConfiguration('judger.execution')
					.get('unlimitedStack', false)
					? '1'
					: '0',
				String(maxOutputSize),
				String(wallTimeout),
			],
			processes,
			wallTimeout + 2000,
            '',
            cwd,
		);
		if (wrapper.code !== 0 || wrapper.signal || !fs.existsSync(paths[3])) {
			return { ...wrapper, code: wrapper.code || 1 };
		}
		const metrics = JSON.parse(fs.readFileSync(paths[3], 'utf8')) as {
			cpuMs: number;
			memoryBytes: number;
			code: number;
			signal: number;
			timeOut: boolean;
		};
		let outputLimitExceeded = false;
		const read = (file: string) => {
			if (!fs.existsSync(file)) {
				return '';
			}
			const size = fs.statSync(file).size;
			if (size > maxOutputSize) {
				outputLimitExceeded = true;
			}
			const buffer = Buffer.alloc(Math.min(size, maxOutputSize));
			const descriptor = fs.openSync(file, 'r');
			try {
				fs.readSync(descriptor, buffer, 0, buffer.length, 0);
			} finally {
				fs.closeSync(descriptor);
			}
			return buffer.toString('utf8');
		};
		const stdout = read(paths[1]),
			stderr = read(paths[2]);
		return {
			stdout,
			stderr,
			outputLimitExceeded,
			code: metrics.code,
			signal: metrics.signal ? Object.entries(os.constants.signals).find(([, value]) => value === metrics.signal)?.[0] ?? String(metrics.signal) : null,
			time: metrics.cpuMs,
			timeOut: metrics.timeOut,
			memoryBytes: metrics.memoryBytes,
		};
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
}

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
import localize from './i18n';

type RunnerWaiter = { report: (message: string) => void; checkCancelled?: () => void };
type RunnerBuildState = { waiters: Set<RunnerWaiter>; output: string };
const runnerBuilds = new Map<string, { promise: Promise<string>; state: RunnerBuildState }>();

/** Publish only complete runner binaries and share cold builds between testcases. */
export async function prepareNativeRunner(report: (message: string) => void = () => { }, buildPlatform: NodeJS.Platform = process.platform, checkCancelled?: () => void): Promise<string> {
	checkCancelled?.();
	const root = globalThis.extensionContext.extensionPath;
	const source = path.join(root, 'dist/static/tools/runner.cpp');
	const hash = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex').slice(0, 16);
	const cache = path.join(globalThis.extensionContext.globalStorageUri.fsPath, 'native');
	fs.mkdirSync(cache, { recursive: true });
	// v2 excludes binaries published by the former non-staged build path.
	const executable = path.join(cache, `runner-v2-${buildPlatform}-${process.arch}-${hash}${buildPlatform === 'win32' ? '.exe' : ''}`);
	const waiter: RunnerWaiter = { report, checkCancelled };
	let pending = runnerBuilds.get(executable);
	if (!pending && fs.existsSync(executable)) { return executable; }
	const build = async (state: RunnerBuildState) => {
		const cancelled = () => {
			for (const listener of state.waiters) {
				try { listener.checkCancelled?.(); } catch { state.waiters.delete(listener); }
			}
			return !state.waiters.size;
		};
		const assertActive = () => { if (cancelled()) { throw new Error('Runner preparation cancelled.'); } };
		const capture = (message: string) => {
			state.output = `${state.output}${message}\n`.slice(-24000);
			for (const listener of state.waiters) { listener.report(message); }
		};
		const attempts = buildPlatform === 'win32' ? 2 : 1;
		for (let attempt = 0; attempt < attempts; attempt++) {
			assertActive();
			capture(attempt
				? localize('judger.runner.retry', 'Preparing the judging helper failed. Retrying once…')
				: localize('judger.runner.preparing', 'Preparing the judging helper for first use (up to 60 seconds)…'));
			const directory = fs.mkdtempSync(path.join(cache, '.runner-build-'));
			const staged = path.join(directory, path.basename(executable));
			try {
				const compiled = await compileFile(source, {
					outputPath: staged, silent: true, timeout: 60000, compileMode: 'force', reportProgress: capture, isCancelled: cancelled,
					additionalArgs: ['-std=c++17', ...(buildPlatform === 'win32' ? ['-lpsapi', '-lshell32'] : [])]
				});
				assertActive();
				if (compiled && fs.existsSync(staged)) {
					// Another IDE window may have finished the same build in the meantime.
					if (!fs.existsSync(executable)) { fs.renameSync(staged, executable); }
					return executable;
				}
			} catch (error) {
				assertActive();
				capture(error instanceof Error ? error.message : String(error));
			} finally {
				try { await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
				catch (error) { capture(`Runner staging cleanup failed: ${error instanceof Error ? error.message : String(error)}`); }
			}
		}
		assertActive();
		throw new Error(`${localize('judger.runner.compileFailed', 'Could not compile the native runner.')}\n${state.output}`);
	};
	if (pending) {
		pending.state.waiters.add(waiter);
		if (pending.state.output) { report(pending.state.output); }
	} else {
		const state: RunnerBuildState = { waiters: new Set([waiter]), output: '' };
		const promise = build(state).finally(() => { if (runnerBuilds.get(executable)?.promise === promise) { runnerBuilds.delete(executable); } });
		pending = { promise, state };
		runnerBuilds.set(executable, pending);
	}
	const shared = pending;
	return new Promise<string>((resolve, reject) => {
		let timer: ReturnType<typeof setInterval> | undefined;
		const detach = () => { if (timer) { clearInterval(timer); } shared.state.waiters.delete(waiter); };
		const check = () => {
			try { checkCancelled?.(); } catch (error) { detach(); reject(error); }
		};
		if (checkCancelled) { timer = setInterval(check, 50); }
		shared.promise.then(value => { check(); detach(); resolve(value); }, error => { check(); detach(); reject(error); });
		check();
	});
}

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
	checkCancelled?.();
	const executable = await prepareNativeRunner(undefined, process.platform, checkCancelled);
	checkCancelled?.();
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

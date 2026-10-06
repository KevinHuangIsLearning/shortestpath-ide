/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { StringDecoder } from 'string_decoder';
import { Run } from './types';

/** Bounded auxiliary-process execution shared by native checkers and validators. */
export function runTool(
	command: string,
	args: string[],
	processes: ChildProcessWithoutNullStreams[],
	timeout: number,
	input = '',
    cwd?: string,
): Promise<Run> {
	const started = Date.now();
    const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
    let capturedBytes = 0;
	const result: Run = {
		stdout: '',
		stderr: '',
		code: null,
		signal: null,
		time: 0,
		timeOut: false,
	};
	return new Promise((resolve) => {
		const child = spawn(command, args, { windowsHide: true, cwd });
		processes.push(child);
		const timer = setTimeout(() => {
			result.timeOut = true;
			child.kill('SIGKILL');
		}, timeout);
		const capture = (key: 'stdout' | 'stderr', data: Buffer) => {
            capturedBytes += data.length;
            if (capturedBytes > 8 * 1024 * 1024) {
				result.outputLimitExceeded = true;
				child.kill('SIGKILL');
				return;
			}
			result[key] += decoders[key].write(data);
		};
		child.stdout.on('data', (data: Buffer) => capture('stdout', data));
		child.stderr.on('data', (data: Buffer) => capture('stderr', data));
		child.on('error', (error) => {
			result.stderr += error.message;
			result.signal = 'SPAWN_ERROR';
		});
		child.stdin.on('error', () => {
			/* A tool may finish without consuming stdin. */
		});
		child.once('close', (code, signal) => {
            result.stdout += decoders.stdout.end();
            result.stderr += decoders.stderr.end();
			clearTimeout(timer);
			const index = processes.indexOf(child);
			if (index >= 0) {
				processes.splice(index, 1);
			}
			result.code = code;
			result.signal = result.signal ?? signal;
			result.time = Date.now() - started;
			resolve(result);
		});
		child.stdin.end(input);
	});
}

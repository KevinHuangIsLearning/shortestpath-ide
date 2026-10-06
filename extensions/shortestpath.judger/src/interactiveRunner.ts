/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import { StringDecoder } from 'string_decoder';
import os from 'os';
import path from 'path';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { CustomCheckerRun, Run } from './types';

export type ProgramCommand = { command: string; args: string[] };

/** Wire both directions before either program can produce data. Closing either pipe forwards EOF. */
export async function runInteractive(
	solution: ProgramCommand,
	interactor: string,
	input: string,
	processes: ChildProcessWithoutNullStreams[],
	timeout: number,
    cwd?: string,
    maxOutputSize = 16 * 1024 * 1024,
): Promise<{ run: Run; checker: CustomCheckerRun; solutionTerminatedByJudge: boolean }> {
	const directory = fs.mkdtempSync(
		path.join(os.tmpdir(), 'judger-interactive-'),
	);
	const inputPath = path.join(directory, 'input.txt'),
		feedbackPath = path.join(directory, 'feedback.txt');
	fs.writeFileSync(inputPath, input);
	const start = Date.now();
	const empty = (): Run => ({
		stdout: '',
		stderr: '',
		code: null,
		signal: null,
		time: 0,
		timeOut: false,
	});
	const run = empty(),
		checker: CustomCheckerRun = {
			...empty(),
			command: JSON.stringify([interactor, inputPath, feedbackPath]),
		};
	const children: ChildProcessWithoutNullStreams[] = [];
	let solutionTerminatedByJudge = false;
    const decoders = new Map<Run, { stdout: StringDecoder; stderr: StringDecoder }>();
	let timer: NodeJS.Timeout | undefined;
	try {
		const target = spawn(solution.command, solution.args, {
			windowsHide: true,
            cwd,
		});
		const judge = spawn(interactor, [inputPath, feedbackPath], {
			windowsHide: true,
            cwd,
		});
		children.push(target, judge);
		processes.push(...children);
        let stoppedBy: Run | undefined;
        const stop = (cause?: Run) => {
            if (cause && !stoppedBy) {
                stoppedBy = cause;
                if (cause === checker && target.exitCode === null && target.signalCode === null && !run.signal) { solutionTerminatedByJudge = true; }
            }
            if (timer) { clearTimeout(timer); }
            children.forEach(child => child.kill('SIGKILL'));
        };
		const captured = new Map<Run, { stdout: number; stderr: number }>();
		const capture = (
			result: Run,
			key: 'stdout' | 'stderr',
			data: Buffer,
		) => {
			const counts = captured.get(result) ?? { stdout: 0, stderr: 0 };
			counts[key] += data.length;
			captured.set(result, counts);
			if (counts[key] > maxOutputSize) {
				result.outputLimitExceeded = true;
				stop(result);
				return;
			}
			const decoder = decoders.get(result) ?? { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
            decoders.set(result, decoder);
            result[key] += decoder[key].write(data);
		};
		const completed = children.map(
			(child, index) =>
				new Promise<void>((resolve) => {
					const result = index === 0 ? run : checker;
					child.stdin.on('error', () => {
						/* peer closed its output */
					});
					child.stdout.on('data', (data: Buffer) =>
						capture(result, 'stdout', data),
					);
					child.stderr.on('data', (data: Buffer) =>
						capture(result, 'stderr', data),
					);
					child.on('error', (error) => {
						result.stderr += error.message;
						result.signal = 'SPAWN_ERROR';
						stop(result);
					});
					child.once('close', (code, signal) => {
                        const decoder = decoders.get(result);
                        if (decoder) { result.stdout += decoder.stdout.end(); result.stderr += decoder.stderr.end(); }
						result.code = code;
						result.signal = result.signal ?? signal;
						result.time = Date.now() - start;

						if (code !== 0 || signal) {
							stop(result);
						}
						resolve();
					});
				}),
		);
		target.stdout.pipe(judge.stdin);
		judge.stdout.pipe(target.stdin);
		timer = setTimeout(() => {
			run.timeOut = true;
			checker.timeOut = true;
			stop();
		}, timeout);
		await Promise.all(completed);
		// testlib's tout is the output intended for a subsequent checker.
		if (fs.existsSync(feedbackPath)) {
			if (fs.statSync(feedbackPath).size > maxOutputSize) {
				checker.outputLimitExceeded = true;
			} else {
				run.stdout = fs.readFileSync(feedbackPath, 'utf8');
			}
		}
		return { run, checker, solutionTerminatedByJudge };
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
		for (const child of children) {
			child.kill('SIGKILL');
			const index = processes.indexOf(child);
			if (index >= 0) {
				processes.splice(index, 1);
			}
		}
		fs.rmSync(directory, { recursive: true, force: true });
	}
}

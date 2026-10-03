/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ChildProcessWithoutNullStreams } from 'child_process';
import { CustomCheckerRun } from './types';
import { testlibVerdict } from './resultEvaluator';
import { runTool } from './toolProcess';

export async function executeTestlibChecker(
	checker: string,
	input: string,
	output: string,
	answer: string,
	processes: ChildProcessWithoutNullStreams[],
	timeout: number,
    checkCancelled?: () => void,
    pythonCommand = process.platform === 'win32' ? 'python' : 'python3',
): Promise<CustomCheckerRun> {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-checker-'));
	try {
		const files = ['input.txt', 'output.txt', 'answer.txt'].map((file) =>
			path.join(directory, file),
		);
		[input, output, answer].forEach((text, index) =>
			fs.writeFileSync(files[index], text),
		);
        checkCancelled?.();
        const python = pythonCommand;
        const isPython = path.extname(checker).toLowerCase() === '.py';
        const command = isPython ? (process.platform === 'win32' && python === 'python3' ? 'python' : python) : checker;
        // Preserve the two-file protocol of existing Python checkers.
        const args = isPython ? [checker, ...files.slice(0, 2)] : files;
        const run = await runTool(command, args, processes, timeout);
        checkCancelled?.();
		const verdict = isPython && !run.timeOut && !run.signal && !run.outputLimitExceeded
            ? run.code === 0 ? 'AC' : run.code === 1 ? 'WA' : 'FAIL'
            : testlibVerdict(run);
		return {
			...run,
			verdict,
			command: [command, ...args]
				.map((value) => JSON.stringify(value))
				.join(' '),
		};
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
}

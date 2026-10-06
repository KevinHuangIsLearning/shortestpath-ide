/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { compileFile } from './compiler';
import { getLanguage } from './utils';
import { executeAndJudgeTestCase } from './testCaseExecution';
import { isResultCorrect } from './judge';
import { getIgnoreSTDERRORPref } from './preferences';

export type EnvironmentSelfTestSample = { input: string; output: string };
export type EnvironmentSelfTestProgress =
	| { type: 'compilerOutput'; text: string }
	| { type: 'sample'; index: number; input: string; expected: string; actual: string; pass: boolean };
export type EnvironmentSelfTestResult = { success: boolean; reason?: 'compile' | 'sample' | 'judge'; detail?: string };

/** Exercise the same compiler, process runner, and judge as CPH's Run All. */
export async function runEnvironmentSelfTest(options: {
	sourcePath: string;
	samples: EnvironmentSelfTestSample[];
	reportProgress?: (event: EnvironmentSelfTestProgress) => void;
}): Promise<EnvironmentSelfTestResult> {
	if (!options || typeof options.sourcePath !== 'string' || !path.isAbsolute(options.sourcePath)
		|| !Array.isArray(options.samples) || !options.samples.length
		|| options.samples.some(sample => typeof sample?.input !== 'string' || typeof sample?.output !== 'string')) {
		throw new Error('Invalid CPH self-test options');
	}
	// Keep every generated binary inside the caller's temporary test directory.
	const binary = path.join(path.dirname(options.sourcePath), process.platform === 'win32' ? 'cph-check.exe' : 'cph-check.bin');
	try {
		const compiled = await compileFile(options.sourcePath, {
			silent: true, outputPath: binary, timeout: 60000,
			reportProgress: text => options.reportProgress?.({ type: 'compilerOutput', text })
		});
		if (!compiled) { return { success: false, reason: 'compile' }; }
		const language = getLanguage(options.sourcePath);
		for (const [index, sample] of options.samples.entries()) {
			const result = await executeAndJudgeTestCase(language, binary, {
				id: index, input: sample.input, expectedOutput: sample.output,
				failOnStderr: !getIgnoreSTDERRORPref(), maxOutputSize: 64 * 1024,
				judgeOutput: (_expected, stdout) => isResultCorrect({ ...sample, id: index }, stdout)
			});
			options.reportProgress?.({ type: 'sample', index, input: sample.input, expected: sample.output, actual: result.stdout, pass: result.pass === true });
			if (result.pass !== true) { return { success: false, reason: 'sample', detail: result.stderr }; }
		}
		// Confirm a deliberately wrong expected answer is rejected as WA.
		const sample = options.samples[0];
		const result = await executeAndJudgeTestCase(language, binary, {
			id: -1, input: sample.input, expectedOutput: 'SHORTESTPATH_WRONG_ANSWER',
			failOnStderr: !getIgnoreSTDERRORPref(), maxOutputSize: 64 * 1024,
			judgeOutput: (expected, stdout) => isResultCorrect({ id: -1, input: sample.input, output: expected }, stdout)
		});
		if (result.pass !== false || result.code !== 0 || result.signal || result.timeOut || result.outputLimitExceeded || result.stdout.trim() !== sample.output.trim()) {
			return { success: false, reason: 'judge', detail: result.stderr };
		}
		return { success: true };
	} finally {
		await fs.promises.rm(binary, { force: true });
	}
}

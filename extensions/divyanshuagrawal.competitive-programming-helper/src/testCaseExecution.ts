import { Language, RunResult } from './types';
import { runCustomChecker, runTestCase } from './executions';

export type TestCaseExecutionOptions = {
    id: number;
    input: string;
    expectedOutput: string;
    checkerPath?: string;
    failOnStderr: boolean;
    maxOutputSize?: number;
    judgeOutput: (expectedOutput: string, stdout: string) => boolean;
    onChecking?: () => void;
};

/**
 * The single execution and judging path for both editable and file-backed
 * testcases. Callers only decide where the input/output text comes from.
 */
export const executeAndJudgeTestCase = async (
    language: Language,
    binPath: string,
    options: TestCaseExecutionOptions,
): Promise<RunResult> => {
    const run = await runTestCase(language, binPath, options.input, {
        logInput: false,
        maxOutputSize: options.maxOutputSize,
    });
    const stderrorFailure = options.failOnStderr && run.stderr !== '';
    const didError =
        (run.code !== null && run.code !== 0) ||
        run.signal !== null ||
        run.timeOut ||
        run.outputLimitExceeded ||
        stderrorFailure;
    let checkerRun: RunResult['checkerRun'];
    let pass: boolean | null = false;

    if (!didError && options.checkerPath) {
        options.onChecking?.();
        checkerRun = await runCustomChecker(
            options.checkerPath,
            options.input,
            run.stdout,
        );
        pass =
            checkerRun.code === 0 &&
            !checkerRun.signal &&
            !checkerRun.timeOut;
        if (checkerRun.signal) run.signal = checkerRun.signal;
    } else if (!didError) {
        pass = options.judgeOutput(options.expectedOutput, run.stdout);
    }

    return {
        ...run,
        pass,
        checkerRun,
        id: options.id,
    };
};

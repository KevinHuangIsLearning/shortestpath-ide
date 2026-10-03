import { AuxiliaryPrograms } from './auxiliaryPrograms';
import * as vscode from 'vscode';
import { testlibVerdict } from './resultEvaluator';
import { compareOutput } from './outputComparison';
import { Language, RunResult } from './types';
import { runCustomChecker, runTestCase, runInteractiveTestCase } from './executions';

export type TestCaseExecutionOptions = {
    checkCancelled?: () => void;
    artifacts?: AuxiliaryPrograms;
    id: number;
    input: string;
    inputPath?: string;
    expectedOutput: string;
    checkerPath?: string;
    interactorPath?: string;
    configurationError?: string;
    failOnStderr: boolean;
    maxOutputSize?: number;
    timeLimitMs?: number;
    memoryLimitMb?: number;
    cwd?: string;
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
    if (options.configurationError) { return { id: options.id, pass: false, stdout: '', stderr: options.configurationError, code: 1, signal: null, time: 0, timeOut: false }; }
    options.checkCancelled?.();
    const maxOutputSize = options.maxOutputSize ?? vscode.workspace.getConfiguration('judger.execution').get<number>('outputLimitMb', 16) * 1024 * 1024;
    const interactive = options.interactorPath ? await runInteractiveTestCase(language, binPath, options.interactorPath, options.input, options.timeLimitMs, options.cwd, options.checkCancelled, maxOutputSize, options.artifacts) : undefined;
    const run = interactive?.run ?? await runTestCase(language, binPath, options.input, {
        logInput: false,
        checkCancelled: options.checkCancelled,
        maxOutputSize,
        timeoutMs: options.timeLimitMs === undefined ? undefined : options.timeLimitMs + vscode.workspace.getConfiguration('judger.execution').get<number>('timeAdditionMs', 1000),
        cwd: options.cwd,
        inputPath: options.inputPath,
    });
    options.checkCancelled?.();
    if (options.timeLimitMs && run.time > options.timeLimitMs) { run.timeOut = true; }
    const memoryFailure = !!(options.memoryLimitMb && run.memoryBytes !== undefined && run.memoryBytes > options.memoryLimitMb * 1024 * 1024);
    let verdict: RunResult['verdict'];
    const outputRatio = vscode.workspace.getConfiguration('judger.execution').get<number>('outputRatioLimit', 0);
    if (!options.checkerPath && !options.interactorPath && outputRatio > 0 && Buffer.byteLength(run.stdout) > Buffer.byteLength(options.expectedOutput) * outputRatio) { run.outputLimitExceeded = true; }
    const stderrorFailure = options.failOnStderr && run.stderr !== '';
    const solutionFailure = run.timeOut ? 'TLE' : memoryFailure ? 'MLE' : run.outputLimitExceeded ? 'OLE'
        : ((run.code !== null && run.code !== 0) || run.signal !== null || stderrorFailure) ? 'RE' : undefined;
    let checkerRun: RunResult['checkerRun'] = interactive?.checker;
    const interactorVerdict = checkerRun ? checkerRun.verdict ?? testlibVerdict(checkerRun) : undefined;
    // A judge's non-AC verdict may require terminating a solution still waiting for input.
    // That cleanup signal is not a runtime error in the submitted program.
    const judgeDecided = interactive?.solutionTerminatedByJudge && interactorVerdict !== 'AC';
    if (solutionFailure && (!judgeDecided || run.timeOut || memoryFailure || run.outputLimitExceeded || stderrorFailure)) { verdict = solutionFailure; }
    else if (interactorVerdict && interactorVerdict !== 'AC') { verdict = interactorVerdict; }
    else if (options.checkerPath) {
        options.onChecking?.();
        checkerRun = await runCustomChecker(options.checkerPath, options.input, run.stdout, options.expectedOutput, options.checkCancelled, options.artifacts);
        verdict = checkerRun.verdict ?? testlibVerdict(checkerRun);
    } else { verdict = interactive ? 'AC' : compareOutput(options.expectedOutput, run.stdout); }
    const pass = verdict === 'AC' || (verdict === 'PE' && vscode.workspace.getConfiguration('judger.execution').get('acceptPresentationError', true));
    return {
        ...run,
        verdict,
        pass,
        checkerRun,
        id: options.id,
    };
};

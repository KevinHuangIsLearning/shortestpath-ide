import { AuxiliaryPrograms } from './auxiliaryPrograms';
/*---------------------------------------------------------------------------------------------
 * Copyright (c) 2026 ShortestPath IDE contributors. Licensed under GPL-3.0-or-later.
 * Stress workflow follows CPH-NG 0.7.11 by Langning Chen (GPL-3.0-or-later):
 * compile all, generate, run brute force, judge through the ordinary judge, retain the first failure.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import path from 'path';
import { Problem, Run, RunResult, StressProgramRole, TestCase } from './types';
import { compileFile } from './compiler';
import {
    clearKillRequested,
    runTestCase,
    wasKillRequested,
} from './executions';
import { getLanguage } from './utils';
import { problemLanguage, effectiveTimeLimit } from './problemOptions';
import { getIgnoreSTDERRORPref } from './preferences';
import { executeAndJudgeTestCase } from './testCaseExecution';
import { getProblemDirectory } from './parser';
import { diffOutput, diffOutputPreview } from './utils/diffOutput';

export type StressCallbacks = {
    onProgress: (iteration: number, total: number) => void;
    onStatus: (
        phase: 'compiling' | 'running',
        role?: StressProgramRole | 'target',
        iteration?: number,
        total?: number,
    ) => void;
    onFailure: (
        iteration: number,
        testcase: TestCase,
        result: RunResult,
    ) => Promise<void> | void;
};

export type StressRunResult = {
    state: 'passed' | 'found' | 'stopped';
    iteration: number;
};

export class StressFailure extends Error {
    public constructor(
        public readonly role: StressProgramRole | 'target',
        public readonly iteration: number,
        message: string,
    ) {
        super(message);
    }
}

let stressRunning = false;

export const isStressTestRunning = () => stressRunning;

const isRunFailure = (run: Run): boolean =>
    run.timeOut ||
    run.signal !== null ||
    (run.code !== null && run.code !== 0) ||
    run.outputLimitExceeded === true ||
    (!getIgnoreSTDERRORPref() && run.stderr !== '');

const describeRunFailure = (run: Run): string => {
    const reason = run.outputLimitExceeded
        ? 'output limit exceeded'
        : run.timeOut
          ? 'timed out'
          : run.signal
            ? `terminated by ${run.signal}`
            : `exited with code ${run.code ?? 'unknown'}`;
    const stderr = run.stderr.trim();
    return stderr ? `${reason}: ${stderr.slice(0, 4000)}` : reason;
};

const getTempRoot = (srcPath: string): string => {
    return path.join(getProblemDirectory(srcPath), 'stress');
};

const getStressBinaryPath = (
    sourcePath: string,
    root: string,
    role: StressProgramRole | 'target',
    language = getLanguage(sourcePath),
): string => {
    if (language.skipCompile) {
        return sourcePath;
    }
    const extension =
        language.name === 'java'
            ? '*.class'
            : language.name === 'csharp' && language.compiler.includes('dotnet')
              ? '_bin'
              : '.bin';
    return path.join(
        root,
        'bin',
        role,
        `${path.parse(sourcePath).name}${extension}`,
    );
};

const saveSource = async (sourcePath: string) => {
    const document = await vscode.workspace.openTextDocument(sourcePath);
    await document.save();
};

const stopIfRequested = (iteration: number): StressRunResult | undefined => {
    if (wasKillRequested()) {
        return { state: 'stopped', iteration };
    }
    return undefined;
};

export const runStressTest = async (
    problem: Problem,
    generatorPath: string,
    stdPath: string,
    iterations: number,
    callbacks: StressCallbacks,
): Promise<StressRunResult> => {
    if (!Number.isSafeInteger(iterations) || iterations < 0 || iterations > 100000) { throw new StressFailure('target', 0, 'Iterations must be between 0 and 100000.'); }
    if (stressRunning) {
        throw new StressFailure('target', 0, 'stress test is already running');
    }
    stressRunning = true;
    clearKillRequested();
    const tempParent = getTempRoot(problem.srcPath);
    const artifacts = new AuxiliaryPrograms();
    let root: string | undefined;
    const binaries: string[] = [];
    let lastIteration = 0;
    const checkCancelled = () => { if (wasKillRequested()) { throw new Error('Cancelled'); } };

    try {
        await fs.mkdir(tempParent, { recursive: true });
        root = await fs.mkdtemp(path.join(tempParent, 'run-'));
        await Promise.all(
            [generatorPath, stdPath, problem.srcPath].map(saveSource),
        );
        const generatorSource = generatorPath;
        const stdSource = stdPath;
        const targetSource = problem.srcPath;
        const programs = [
            {
                role: 'generator' as const,
                sourcePath: generatorSource,
            },
            { role: 'std' as const, sourcePath: stdSource },
            { role: 'target' as const, sourcePath: targetSource },
        ];

        for (const program of programs) {
            callbacks.onStatus('compiling', program.role);
            const stoppedBeforeCompile = stopIfRequested(0);
            if (stoppedBeforeCompile) {
                return stoppedBeforeCompile;
            }
            const binaryPath = getStressBinaryPath(
                program.sourcePath,
                root,
                program.role,
                program.role === 'target' ? problemLanguage(getLanguage(program.sourcePath), problem) : getLanguage(program.sourcePath),
            );
            await fs.mkdir(path.dirname(binaryPath), { recursive: true });
            if (
                !(await compileFile(program.sourcePath, {
                    silent: true,
                    instrumentation: program.role === 'target' && !problem.interactorPath,
                    useProblemExecutionSettings: program.role === 'target',
                    language: program.role === 'target' ? problemLanguage(getLanguage(program.sourcePath), problem) : undefined,
                    outputPath: binaryPath,
                    projectDirectory: path.join(
                        root,
                        'projects',
                        program.role,
                        '.cphcsrun',
                    ),
                }))
            ) {
                if (wasKillRequested()) {
                    return { state: 'stopped', iteration: 0 };
                }
                throw new StressFailure(
                    program.role,
                    0,
                    `${program.role} compilation failed`,
                );
            }
            binaries.push(binaryPath);
        }

        const generatorLanguage = getLanguage(generatorSource);
        const stdLanguage = getLanguage(stdSource);
        const targetLanguage = problemLanguage(getLanguage(targetSource), problem);
        const settings = vscode.workspace.getConfiguration('judger.stressTest');
        const outputLimit = vscode.workspace.getConfiguration('judger.execution').get<number>('outputLimitMb', 16) * 1024 * 1024;
        const generatorBinary = binaries[0];
        const stdBinary = binaries[1];
        const targetBinary = binaries[2];

        for (let iteration = 1; (iterations === 0 || iteration <= iterations); iteration++) {
            lastIteration = iteration;
            callbacks.onProgress(iteration, iterations);
            const stoppedBeforeGenerator = stopIfRequested(iteration);
            if (stoppedBeforeGenerator) return stoppedBeforeGenerator;

            callbacks.onStatus('running', 'generator', iteration, iterations);
            const generated = await runTestCase(
                generatorLanguage,
                generatorBinary,
                '',
                {
                    timeoutMs: settings.get<number>('generatorTimeLimit', 10000),
                    cwd: path.dirname(generatorSource),
                    logInput: false,
                    maxOutputSize: outputLimit,
                    checkCancelled,
                },
            );
            const stoppedAfterGenerator = stopIfRequested(iteration);
            if (stoppedAfterGenerator) return stoppedAfterGenerator;
            if (isRunFailure(generated)) {
                throw new StressFailure(
                    'generator',
                    iteration,
                    `generator ${describeRunFailure(generated)}`,
                );
            }

            const inputPath = path.join(root, 'input.in');
            await fs.writeFile(inputPath, generated.stdout);
            callbacks.onStatus('running', 'std', iteration, iterations);
            const expected = await runTestCase(
                stdLanguage,
                stdBinary,
                '',
                { inputPath, checkCancelled, logInput: false, maxOutputSize: outputLimit, timeoutMs: settings.get<number>('bruteForceTimeLimit', 60000), cwd: path.dirname(stdSource) },
            );
            const stoppedAfterStd = stopIfRequested(iteration);
            if (stoppedAfterStd) return stoppedAfterStd;
            if (isRunFailure(expected)) {
                throw new StressFailure(
                    'std',
                    iteration,
                    `standard program ${describeRunFailure(expected)}`,
                );
            }

            callbacks.onStatus('running', 'target', iteration, iterations);
            let id = Date.now() + iteration;
            while (problem.tests.some(test => test.id === id)) { id++; }
            if (problem.interactive && !problem.interactorPath?.trim()) {
                throw new StressFailure('target', iteration, 'Set an interactor before stress testing an interactive problem.');
            }
            const actual = await executeAndJudgeTestCase(targetLanguage, targetBinary, {
                checkCancelled,
                artifacts,
                id,
                input: generated.stdout,
                inputPath,
                expectedOutput: expected.stdout,
                checkerPath: problem.customCheckerPath?.trim() || undefined,
                interactorPath: problem.interactorPath?.trim() || undefined,
                failOnStderr: !getIgnoreSTDERRORPref(),
                timeLimitMs: effectiveTimeLimit(problem, 3000),
                memoryLimitMb: problem.memoryLimit,
                cwd: path.dirname(targetSource),
            });
            const stoppedAfterTarget = stopIfRequested(iteration);
            if (stoppedAfterTarget) { return stoppedAfterTarget; }
            if (actual.pass !== true) {
                // Only the failing iteration survives cleanup; large values stay file backed.
                const directory = path.join(getProblemDirectory(problem.srcPath), 'testcases', `stress-${id}`);
                const retain = async (text: string, extension: string): Promise<string | undefined> => {
                    if (Buffer.byteLength(text) <= 65536) { return undefined; }
                    await fs.mkdir(directory, { recursive: true });
                    const file = path.join(directory, `counterexample.${extension}`);
                    await fs.writeFile(file, text);
                    return file;
                };
                const retainedInput = await retain(generated.stdout, 'in');
                const retainedOutput = await retain(expected.stdout, 'out');
                const testcase: TestCase = { id, input: retainedInput ? '' : generated.stdout, output: retainedOutput ? '' : expected.stdout,
                    ...(retainedInput ? { inputPath: retainedInput } : {}), ...(retainedOutput ? { outputPath: retainedOutput } : {}) };
                const stdoutPath = await retain(actual.stdout, 'actual.out');
                const stderrPath = await retain(actual.stderr, 'err');
                const result: RunResult = { ...actual,
                    stdout: stdoutPath ? '' : actual.stdout, stderr: stderrPath ? '' : actual.stderr, stdoutPath, stderrPath,
                    diff: actual.checkerRun || actual.verdict !== 'WA' ? undefined : retainedInput || retainedOutput || stdoutPath ? diffOutputPreview(expected.stdout, actual.stdout) : diffOutput(expected.stdout, actual.stdout),
                };
                if (result.checkerRun) { result.checkerRun = { ...result.checkerRun, stdout: result.checkerRun.stdout.slice(0, 65536), stderr: result.checkerRun.stderr.slice(0, 65536) }; }
                await callbacks.onFailure(iteration, testcase, result);
                return { state: 'found', iteration };
            }
        }

        return { state: 'passed', iteration: lastIteration };
    } catch (error) {
        if (wasKillRequested()) { return { state: 'stopped', iteration: lastIteration }; }
        throw error;
    } finally {
        artifacts.dispose();
        try {
            if (root) { await fs.rm(root, {
                recursive: true,
                force: true,
                maxRetries: 3,
                retryDelay: 100,
            }); }
            // Never delete sibling runs or another process's artifacts.
            try { await fs.rmdir(tempParent); } catch (error) {
                if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code || '')) { globalThis.logger.warn('Could not remove stress temporary directory', error); }
            }
        } finally {
            stressRunning = false;
        }
    }
};

export const getStressTempRoot = getTempRoot;

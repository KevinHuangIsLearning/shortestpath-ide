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
import { getIgnoreSTDERRORPref } from './preferences';
import { diffOutput } from './utils/diffOutput';
import { isResultCorrect } from './judge';

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
const MAX_STRESS_OUTPUT_SIZE = 4 * 1024 * 1024;

export const isStressTestRunning = () => stressRunning;

const isRunFailure = (run: Run): boolean =>
    run.timeOut ||
    run.signal !== null ||
    (run.code !== null && run.code !== 0) ||
    run.outputLimitExceeded === true ||
    (!getIgnoreSTDERRORPref() && run.stderr !== '');

const describeRunFailure = (run: Run): string => {
    const reason = run.outputLimitExceeded
        ? `output exceeded ${MAX_STRESS_OUTPUT_SIZE / (1024 * 1024)} MiB`
        : run.timeOut
          ? 'timed out'
          : run.signal
            ? `terminated by ${run.signal}`
            : `exited with code ${run.code ?? 'unknown'}`;
    const stderr = run.stderr.trim();
    return stderr ? `${reason}: ${stderr.slice(0, 4000)}` : reason;
};

const getTempRoot = (srcPath: string): string => {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(
        vscode.Uri.file(srcPath),
    );
    const base = workspaceFolder?.uri.fsPath || path.dirname(srcPath);
    return path.join(base, '.shortestpath', 'cph-stress');
};

const getStressBinaryPath = (
    sourcePath: string,
    root: string,
    role: StressProgramRole | 'target',
): string => {
    const language = getLanguage(sourcePath);
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
    if (stressRunning) {
        throw new StressFailure('target', 0, 'stress test is already running');
    }
    stressRunning = true;
    clearKillRequested();
    const tempParent = getTempRoot(problem.srcPath);
    let root: string | undefined;
    const binaries: string[] = [];
    let lastIteration = 0;

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
            );
            await fs.mkdir(path.dirname(binaryPath), { recursive: true });
            if (
                !(await compileFile(program.sourcePath, {
                    silent: true,
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
        const targetLanguage = getLanguage(targetSource);
        const generatorBinary = binaries[0];
        const stdBinary = binaries[1];
        const targetBinary = binaries[2];

        for (let iteration = 1; iteration <= iterations; iteration++) {
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
                    includeLanguageArgs: false,
                    logInput: false,
                    maxOutputSize: MAX_STRESS_OUTPUT_SIZE,
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

            callbacks.onStatus('running', 'std', iteration, iterations);
            const expected = await runTestCase(
                stdLanguage,
                stdBinary,
                generated.stdout,
                { logInput: false, maxOutputSize: MAX_STRESS_OUTPUT_SIZE },
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
            const actual = await runTestCase(
                targetLanguage,
                targetBinary,
                generated.stdout,
                { logInput: false, maxOutputSize: MAX_STRESS_OUTPUT_SIZE },
            );
            const stoppedAfterTarget = stopIfRequested(iteration);
            if (stoppedAfterTarget) return stoppedAfterTarget;

            let id = Date.now() + iteration;
            while (problem.tests.some((testcase) => testcase.id === id)) {
                id++;
            }
            const testcase: TestCase = {
                id,
                input: generated.stdout,
                output: expected.stdout,
            };
            const pass =
                !isRunFailure(actual) &&
                isResultCorrect(testcase, actual.stdout);
            if (!pass) {
                const result: RunResult = {
                    ...actual,
                    id,
                    pass: false,
                    diff: isRunFailure(actual)
                        ? undefined
                        : diffOutput(expected.stdout, actual.stdout),
                };
                await callbacks.onFailure(iteration, testcase, result);
                return { state: 'found', iteration };
            }
        }

        return { state: 'passed', iteration: lastIteration };
    } finally {
        try {
            await fs.rm(tempParent, {
                recursive: true,
                force: true,
                maxRetries: 3,
                retryDelay: 100,
            });
        } finally {
            stressRunning = false;
        }
    }
};

export const getStressTempRoot = getTempRoot;

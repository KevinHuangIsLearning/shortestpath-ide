import fs from 'fs/promises';
import path from 'path';
import { getLanguage } from './utils';
import { compileFile, getBinSaveLocation } from './compiler';
import { deleteBinary, wasKillRequested } from './executions';
import { diffOutput } from './utils/diffOutput';
import { executeAndJudgeTestCase } from './testCaseExecution';
import {
    CustomCheckerRun,
    LargeSampleCase,
    LargeSampleComparisonOptions,
    LargeSampleDiagnostic,
    LargeSampleRunMode,
    Problem,
    Run,
} from './types';

export const LARGE_SAMPLE_OUTPUT_LIMIT = 16 * 1024 * 1024;

let largeSampleRunning = false;

export const isLargeSampleTestRunning = () => largeSampleRunning;

const defaultComparison: LargeSampleComparisonOptions = {
    ignoreTrailingWhitespace: true,
    ignoreBlankLines: false,
    ignoreOuterWhitespace: true,
    tokenCompare: false,
};

export type LargeSampleScanResult = {
    cases: LargeSampleCase[];
    diagnostics: LargeSampleDiagnostic[];
};

export type LargeSampleFailure = {
    testcase: LargeSampleCase;
    outputPath: string;
    stdout: string;
    stderr: string;
    answer: string;
    reason: string;
    diff?: ReturnType<typeof diffOutput>;
    checkerRun?: CustomCheckerRun;
};

export type LargeSampleCallbacks = {
    onStatus: (
        phase: 'scanning' | 'compiling' | 'running' | 'checking' | 'finished',
        index: number,
        total: number,
        name?: string,
        message?: string,
    ) => void;
    onFailure: (
        failure: LargeSampleFailure,
        index: number,
        total: number,
    ) => void | Promise<void>;
    onCaseResult?: (
        testcase: LargeSampleCase,
        index: number,
        total: number,
        state: 'passed' | 'failed',
        outputPath: string,
        reason?: string,
        time?: number,
    ) => void | Promise<void>;
};

const getArtifactRoot = (problem: Problem) =>
    path.join(
        path.dirname(problem.srcPath),
        '.shortestpath',
        'cph-large-sample',
    );

export const getLargeSampleRunRoot = (problem: Problem, runId: number) =>
    path.join(getArtifactRoot(problem), String(runId));

export const scanLargeSampleDirectory = async (
    directory: string,
    answerMode: 'auto' | 'out' | 'ans' = 'auto',
): Promise<LargeSampleScanResult> => {
    const diagnostics: LargeSampleDiagnostic[] = [];
    const cases: LargeSampleCase[] = [];
    let entries: import('fs').Dirent[];
    try {
        entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
        return {
            cases,
            diagnostics: [
                { message: `Cannot read directory: ${String(error)}` },
            ],
        };
    }

    const inputPattern = /^(.+?)(\d+)\.in$/i;
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        const match = entry.name.match(inputPattern);
        if (!match) continue;

        const [, prefix, number] = match;
        const baseName = `${prefix}${number}`;
        const inputPath = path.join(directory, entry.name);
        const outPath = path.join(directory, `${baseName}.out`);
        const ansPath = path.join(directory, `${baseName}.ans`);
        let answerPath: string | undefined;
        let answerExtension: 'out' | 'ans' | undefined;
        const candidates =
            answerMode === 'ans'
                ? [['ans', ansPath]]
                : answerMode === 'out'
                  ? [['out', outPath]]
                  : [
                        ['out', outPath],
                        ['ans', ansPath],
                    ];
        for (const [extension, candidate] of candidates as Array<
            ['out' | 'ans', string]
        >) {
            try {
                const stat = await fs.stat(candidate);
                if (stat.isFile()) {
                    answerPath = candidate;
                    answerExtension = extension;
                    break;
                }
            } catch {
                // Try the next answer extension.
            }
        }
        if (!answerPath || !answerExtension) {
            diagnostics.push({
                file: inputPath,
                message: `Missing ${
                    answerMode === 'auto' ? '.out or .ans' : `.${answerMode}`
                } answer file`,
            });
            continue;
        }
        cases.push({
            name: entry.name,
            number,
            inputPath,
            answerPath,
            answerExtension,
        });
    }

    cases.sort((a, b) => {
        const numberCompare = Number(a.number) - Number(b.number);
        return numberCompare || a.name.localeCompare(b.name);
    });
    return { cases, diagnostics };
};

const normalizeForComparison = (
    value: string,
    options: LargeSampleComparisonOptions,
): string[] => {
    let normalized = value.replace(/\r\n/g, '\n');
    if (options.ignoreOuterWhitespace) normalized = normalized.trim();
    let lines = normalized.split('\n');
    if (options.ignoreTrailingWhitespace) {
        lines = lines.map((line) => line.trimEnd());
    }
    if (options.ignoreBlankLines) {
        lines = lines.filter((line) => line.trim() !== '');
    }
    if (options.tokenCompare) {
        return lines.join('\n').split(/\s+/).filter(Boolean);
    }
    return lines;
};

export const compareLargeSampleOutput = (
    expected: string,
    received: string,
    options: LargeSampleComparisonOptions = defaultComparison,
) => {
    const expectedParts = normalizeForComparison(expected, options);
    const receivedParts = normalizeForComparison(received, options);
    return (
        expectedParts.length === receivedParts.length &&
        expectedParts.every((line, index) => line === receivedParts[index])
    );
};

const describeRunFailure = (run: Run) => {
    if (run.timeOut) return 'time limit exceeded';
    if (run.outputLimitExceeded) return 'output limit exceeded';
    if (run.signal) return `terminated by ${run.signal}`;
    if (run.code !== null && run.code !== 0) return `exit code ${run.code}`;
    return 'runtime failure';
};

export const runLargeSampleTest = async (
    problem: Problem,
    directory: string,
    runId: number,
    options: {
        comparison?: LargeSampleComparisonOptions;
        runMode?: LargeSampleRunMode;
        answerMode?: 'auto' | 'out' | 'ans';
        checkerPath?: string;
        onlyCaseName?: string;
        skippedCaseNames?: string[];
        precompiled?: boolean;
        callbacks: LargeSampleCallbacks;
    },
) => {
    if (largeSampleRunning)
        throw new Error('A large sample test is already running.');
    largeSampleRunning = true;
    const comparison = options.comparison || defaultComparison;
    const runMode = options.runMode || 'stop-on-failure';
    const root = getLargeSampleRunRoot(problem, runId);
    let binaryPath: string | undefined;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    try {
        await fs.rm(getArtifactRoot(problem), { recursive: true, force: true });
        await fs.mkdir(root, { recursive: true });
        options.callbacks.onStatus('scanning', 0, 0);
        const scan = await scanLargeSampleDirectory(
            directory,
            options.answerMode,
        );
        const skippedCaseNames = new Set(options.skippedCaseNames || []);
        const cases = scan.cases.filter(
            (testcase) =>
                !skippedCaseNames.has(testcase.name) &&
                (!options.onlyCaseName ||
                    testcase.name === options.onlyCaseName),
        );
        const total = cases.length;
        skipped = scan.cases.length - total;
        if (total === 0) {
            throw new Error('No valid large sample pairs were found.');
        }

        const language = getLanguage(problem.srcPath);
        binaryPath = getBinSaveLocation(problem.srcPath);
        if (!options.precompiled) {
            options.callbacks.onStatus(
                'compiling',
                0,
                total,
                undefined,
                'Compiling current program',
            );
            if (!(await compileFile(problem.srcPath))) {
                if (wasKillRequested()) {
                    return {
                        state: 'stopped' as const,
                        passed,
                        failed,
                        skipped: total,
                    };
                }
                throw new Error('Failed to compile current program.');
            }
        }

        for (let index = 0; index < total; index++) {
            const testcase = cases[index];
            options.callbacks.onStatus(
                'running',
                index + 1,
                total,
                testcase.name,
            );
            const input = await fs.readFile(testcase.inputPath, 'utf8');
            const answer = await fs.readFile(testcase.answerPath, 'utf8');
            const result = await executeAndJudgeTestCase(language, binaryPath, {
                id: index,
                input,
                expectedOutput: answer,
                checkerPath: options.checkerPath,
                failOnStderr: false,
                maxOutputSize: LARGE_SAMPLE_OUTPUT_LIMIT,
                judgeOutput: (expected, stdout) =>
                    compareLargeSampleOutput(expected, stdout, comparison),
                onChecking: () =>
                    options.callbacks.onStatus(
                        'checking',
                        index + 1,
                        total,
                        testcase.name,
                    ),
            });
            if (wasKillRequested()) {
                return {
                    state: 'stopped' as const,
                    passed,
                    failed,
                    skipped: total - index,
                };
            }
            const outputPath = path.join(root, `${testcase.name}.output`);
            await fs.writeFile(outputPath, result.stdout);
            const checkerRun = result.checkerRun;
            const isPassed = result.pass === true;
            let reason = '';
            if (!isPassed) {
                reason = checkerRun
                    ? `checker ${describeRunFailure(checkerRun)}`
                    : result.code !== 0 ||
                        result.signal ||
                        result.timeOut ||
                        result.outputLimitExceeded
                      ? describeRunFailure(result)
                      : 'Output differs from the answer.';
            }
            if (isPassed) {
                passed++;
                await options.callbacks.onCaseResult?.(
                    testcase,
                    index + 1,
                    total,
                    'passed',
                    outputPath,
                    undefined,
                    result.time,
                );
                continue;
            }
            failed++;
            await options.callbacks.onCaseResult?.(
                testcase,
                index + 1,
                total,
                'failed',
                outputPath,
                reason,
                result.time,
            );
            await options.callbacks.onFailure(
                {
                    testcase,
                    outputPath,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    answer,
                    reason,
                    checkerRun,
                    diff: checkerRun
                        ? undefined
                        : diffOutput(answer, result.stdout),
                },
                index + 1,
                total,
            );
            if (runMode === 'stop-on-failure') {
                skipped = total - index - 1;
                break;
            }
        }
        const stopped = wasKillRequested();
        const state = stopped
            ? ('stopped' as const)
            : failed
              ? ('failed' as const)
              : ('passed' as const);
        return { state, passed, failed, skipped };
    } finally {
        if (binaryPath && !options.precompiled)
            deleteBinary(getLanguage(problem.srcPath), binaryPath);
        largeSampleRunning = false;
    }
};

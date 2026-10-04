import { retainExecutable } from '../executableCleanup';
import { AuxiliaryPrograms } from '../auxiliaryPrograms';
import { problemLanguage, effectiveTimeLimit } from '../problemOptions';
import { Problem, RunResult } from '../types';
import { getLanguage } from '../utils';
import { getBinSaveLocation, compileFile } from '../compiler';
import { getProbSaveLocation } from '../parser';
import path from 'path';
import { wasKillRequested } from '../executions';
import { beginTestcase } from '../testcaseCancellation';
import { diffOutput, diffOutputPreview } from '../utils/diffOutput';
import { executeAndJudgeTestCase } from '../testCaseExecution';
import * as vscode from 'vscode';
import { getJudgeViewProvider } from '../extension';
import { getIgnoreSTDERRORPref, getTimeOutPref } from '../preferences';
import telmetry from '../telmetry';
import * as fs from 'fs';
import localize from '../i18n';

export const runSingleAndSave = async (
    problem: Problem,
    id: number,
    skipCompile = false,
    skipTelemetry = false,
    artifacts?: AuxiliaryPrograms,
): Promise<RunResult | undefined> => {
    if (!skipTelemetry) {
        globalThis.reporter.sendTelemetryEvent(telmetry.RUN_TESTCASE);
    }
    globalThis.logger.log('Run and save started', problem, id);
    if (problem.interactive && !problem.interactorPath?.trim()) {
        void vscode.window.showErrorMessage(localize('judger.interactor.required', 'Set an interactor path before running this interactive problem.'));
        return;
    }
    const srcPath = problem.srcPath;
    const language = problemLanguage(getLanguage(srcPath), problem);
    const binPath = getBinSaveLocation(srcPath, language);
    const idx = problem.tests.findIndex((value) => value.id === id);
    const testCase = problem.tests[idx];

    if (!skipCompile) {
    const textEditor = await vscode.workspace.openTextDocument(srcPath);
    await vscode.window.showTextDocument(textEditor, {
        viewColumn: vscode.ViewColumn.One,
        preview: false,
    });
    await textEditor.save();
    }

    if (!testCase || testCase.disabled) {
        globalThis.logger.error('Invalid id', id, problem);
        return;
    }


    const executable = skipCompile ? undefined : retainExecutable(binPath, srcPath);
    const cancellation = beginTestcase(srcPath, id);
    try {
    if (!skipCompile) {
        if (!(await compileFile(srcPath, { instrumentation: !problem.interactorPath, language }))) {
            const result: RunResult = { id, pass: false, verdict: (wasKillRequested() || cancellation.stopped()) ? 'STOP' : 'CE', stdout: '', stderr: '', code: 1, signal: null, time: 0, timeOut: false };
            getJudgeViewProvider().extensionToJudgeViewMessage({ command: 'run-single-result', result, problem });
            return result;
        }
    }

    const checkCancelled = () => { if (wasKillRequested() || cancellation.stopped()) { throw new Error('Cancelled'); } };
    checkCancelled();
    let checkerPath: string | undefined;
    let invalidCheckerPath = false;
    if (problem.customCheckerPath?.trim()) {
        checkerPath = problem.customCheckerPath.trim();
        if (!fs.existsSync(checkerPath)) {
            vscode.window.showErrorMessage(
                localize(
                    'judger.processRunSingle.invalidChecker',
                    "Custom checker script not found at '{0}'",
                    checkerPath,
                ),
            );
            checkerPath = undefined;
            invalidCheckerPath = true;
        }
    }
    // Resolve file-backed data only in the extension host at execution time.
    const input = testCase.inputPath && (checkerPath || problem.interactorPath) ? await fs.promises.readFile(testCase.inputPath, 'utf8') : testCase.input;
    const expectedOutput = testCase.outputPath ? await fs.promises.readFile(testCase.outputPath, 'utf8') : testCase.output;
    const fileBacked = !!(testCase.inputPath || testCase.outputPath);
    checkCancelled();
    const result = await executeAndJudgeTestCase(language, binPath, {
        checkCancelled,
        artifacts,
        id,
        timeLimitMs: effectiveTimeLimit(problem, getTimeOutPref()),
        memoryLimitMb: problem.memoryLimit,
        cwd: path.dirname(srcPath),
        input,
        inputPath: testCase.inputPath,
        expectedOutput,
        maxOutputSize: vscode.workspace.getConfiguration('judger.execution').get<number>('outputLimitMb', 16) * 1024 * 1024,
        checkerPath,
        interactorPath: problem.interactorPath?.trim() || undefined,
        configurationError: invalidCheckerPath ? localize('judger.processRunSingle.invalidChecker', "Custom checker script not found at '{0}'", problem.customCheckerPath) : undefined,
        failOnStderr: !getIgnoreSTDERRORPref(),
        onChecking: () =>
            getJudgeViewProvider().extensionToJudgeViewMessage({
                command: 'checking',
                id,
                problem,
            }),
    });

    // Keep the artifact for automatic/reuse compilation on the next run.
    if (wasKillRequested() || cancellation.stopped()) { result.verdict = 'STOP'; result.pass = false; }
    const fileResult = fileBacked || expectedOutput.length > 65536 || result.stdout.length > 65536;
    result.diff = result.checkerRun || invalidCheckerPath ? undefined
        : fileResult ? diffOutputPreview(expectedOutput, result.stdout)
        : result.pass === false ? diffOutput(expectedOutput, result.stdout) : undefined;

    if (fileResult) {
        const directory = path.join(`${getProbSaveLocation(srcPath)}.judger`, 'outputs');
        await fs.promises.mkdir(directory, { recursive: true });
        result.stdoutPath = path.join(directory, `${id}.out`);
        await fs.promises.writeFile(result.stdoutPath, result.stdout);
        result.stdout = '';
    }
    if (result.stderr.length > 65536) {
        const directory = path.join(`${getProbSaveLocation(srcPath)}.judger`, 'outputs');
        await fs.promises.mkdir(directory, { recursive: true });
        result.stderrPath = path.join(directory, `${id}.err`);
        await fs.promises.writeFile(result.stderrPath, result.stderr);
        result.stderr = '';
    }
    if (result.checkerRun) {
        result.checkerRun.stdout = result.checkerRun.stdout.slice(0, 65536);
        result.checkerRun.stderr = result.checkerRun.stderr.slice(0, 65536);
    }
    globalThis.logger.log('Testcase judging complete. Result:', result);
    getJudgeViewProvider().extensionToJudgeViewMessage({
        command: 'run-single-result',
        result,
        problem,
    });
    return result;
    } catch (error) {
        if (!wasKillRequested() && !cancellation.stopped()) { throw error; }
        const stopped: RunResult = { id, verdict: 'STOP', pass: false, stdout: '', stderr: '', code: null, signal: 'SIGTERM', time: 0, timeOut: false };
        getJudgeViewProvider().extensionToJudgeViewMessage({ command: 'run-single-result', problem, result: stopped });
        return stopped;
    } finally { cancellation.dispose(); executable?.dispose(); }
};

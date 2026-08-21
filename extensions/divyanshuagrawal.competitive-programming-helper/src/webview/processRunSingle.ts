import { Problem, RunResult } from '../types';
import { getLanguage } from '../utils';
import { getBinSaveLocation, compileFile } from '../compiler';
import { saveProblem } from '../parser';
import { deleteBinary } from '../executions';
import { isResultCorrect } from '../judge';
import { diffOutput } from '../utils/diffOutput';
import { executeAndJudgeTestCase } from '../testCaseExecution';
import * as vscode from 'vscode';
import { getJudgeViewProvider } from '../extension';
import { getIgnoreSTDERRORPref } from '../preferences';
import telmetry from '../telmetry';
import * as fs from 'fs';
import localize from '../i18n';

export const runSingleAndSave = async (
    problem: Problem,
    id: number,
    skipCompile = false,
    skipTelemetry = false,
): Promise<RunResult | undefined> => {
    if (!skipTelemetry) {
        globalThis.reporter.sendTelemetryEvent(telmetry.RUN_TESTCASE);
    }
    globalThis.logger.log('Run and save started', problem, id);
    const srcPath = problem.srcPath;
    const language = getLanguage(srcPath);
    const binPath = getBinSaveLocation(srcPath);
    const idx = problem.tests.findIndex((value) => value.id === id);
    const testCase = problem.tests[idx];

    const textEditor = await vscode.workspace.openTextDocument(srcPath);
    await vscode.window.showTextDocument(textEditor, {
        viewColumn: vscode.ViewColumn.One,
        preview: false,
    });
    await textEditor.save();

    if (!testCase) {
        globalThis.logger.error('Invalid id', id, problem);
        return;
    }

    saveProblem(srcPath, problem);

    if (!skipCompile) {
        if (!(await compileFile(srcPath))) {
            globalThis.logger.error('Failed to compile', problem, id);
            return;
        }
    }

    let checkerPath: string | undefined;
    let invalidCheckerPath = false;
    if (problem.customCheckerPath?.trim()) {
        checkerPath = problem.customCheckerPath.trim();
        if (!fs.existsSync(checkerPath)) {
            vscode.window.showErrorMessage(
                localize(
                    'cph.processRunSingle.invalidChecker',
                    "Custom checker script not found at '{0}'",
                    checkerPath,
                ),
            );
            checkerPath = undefined;
            invalidCheckerPath = true;
        }
    }
    const result = await executeAndJudgeTestCase(language, binPath, {
        id,
        input: testCase.input,
        expectedOutput: testCase.output,
        checkerPath,
        failOnStderr: !getIgnoreSTDERRORPref(),
        judgeOutput: (_expectedOutput, stdout) =>
            !invalidCheckerPath && isResultCorrect(testCase, stdout),
        onChecking: () =>
            getJudgeViewProvider().extensionToJudgeViewMessage({
                command: 'checking',
                id,
                problem,
            }),
    });

    if (!skipCompile) deleteBinary(language, binPath);
    result.diff =
        result.checkerRun || invalidCheckerPath || result.pass !== false
            ? undefined
            : diffOutput(testCase.output, result.stdout);

    globalThis.logger.log('Testcase judging complete. Result:', result);
    getJudgeViewProvider().extensionToJudgeViewMessage({
        command: 'run-single-result',
        result,
        problem,
    });
    return result;
};

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import localize from './i18n';
import { compileFile, getBinSaveLocation, runningCompilers, compilationsInProgress } from './compiler';
import { clearKillRequested, killRunning, runningBinaries, wasKillRequested } from './executions';
import { getProblem, saveProblem } from './parser';
import { getLanguage } from './utils';
import { getIgnoreSTDERRORPref, getTimeOutPref } from './preferences';
import { executeAndJudgeTestCase } from './testCaseExecution';
import { diffOutput, diffOutputPreview } from './utils/diffOutput';
import { IntegratedTestRequest, IntegratedTestService } from './integratedTests';
import { isStressTestRunning } from './stressTest';
import { AuxiliaryPrograms } from './auxiliaryPrograms';
import { problemLanguage, effectiveTimeLimit } from './problemOptions';
import { retainExecutable } from './executableCleanup';
import * as path from 'path';
import { updateJudgeVisibility } from './extension';

let service: IntegratedTestService;
let executable: ReturnType<typeof retainExecutable> | undefined;
let artifacts: AuxiliaryPrograms | undefined;
export function isIntegratedTestRunning(): boolean { return service?.isRunning ?? false; }
export function getIntegratedTestService(): IntegratedTestService { return service; }

export function registerIntegratedTestCommands(context: vscode.ExtensionContext, ordinaryRunBusy: () => boolean): void {
	service = new IntegratedTestService({
		read: sourcePath => {
            const problem = getProblem(sourcePath);
            return problem ? { ...problem, tests: problem.tests.map(test => ({ ...test,
                input: test.inputPath ? fs.readFileSync(test.inputPath, 'utf8') : test.input,
                output: test.outputPath ? fs.readFileSync(test.outputPath, 'utf8') : test.output,
            })) } : null;
        },
		write: problem => saveProblem(problem.srcPath, problem),
		compile: async (problem, diagnostic, isCancelled) => {
			clearKillRequested();
			const language = problemLanguage(getLanguage(problem.srcPath), problem);
            executable = retainExecutable(getBinSaveLocation(problem.srcPath, language), problem.srcPath);
            artifacts = new AuxiliaryPrograms();
            return compileFile(problem.srcPath, { silent: true, language, reportProgress: diagnostic, isCancelled });
		},
		execute: async (problem, test, checking) => {
			const checkerPath = problem.customCheckerPath?.trim() || undefined;
			if (checkerPath && !fs.existsSync(checkerPath)) { throw new Error(localize('judger.processRunSingle.invalidChecker', "Custom checker script not found at '{0}'", checkerPath)); }
			const result = await executeAndJudgeTestCase(problemLanguage(getLanguage(problem.srcPath), problem), getBinSaveLocation(problem.srcPath, problemLanguage(getLanguage(problem.srcPath), problem)), {
				id: test.id, input: test.input, inputPath: test.inputPath, expectedOutput: test.output, checkerPath, maxOutputSize: 1_000_000,
				artifacts, cwd: path.dirname(problem.srcPath),
                timeLimitMs: effectiveTimeLimit(problem, getTimeOutPref()), memoryLimitMb: problem.memoryLimit,
                checkCancelled: () => { if (wasKillRequested()) { throw new Error('Cancelled'); } },
				failOnStderr: !getIgnoreSTDERRORPref(), onChecking: checking,
			});
			if (!checkerPath && result.pass === false) { result.diff = test.output.length > 65536 || result.stdout.length > 65536 ? diffOutputPreview(test.output, result.stdout) : diffOutput(test.output, result.stdout); }
			return result;
		},
		cleanup: () => { artifacts?.dispose(); artifacts = undefined; executable?.dispose(); executable = undefined; },
		stop: killRunning,
		busy: () => ordinaryRunBusy() || compilationsInProgress > 0 || isStressTestRunning() || runningCompilers.length > 0 || runningBinaries.length > 0,
		publish: snapshot => {
			void vscode.commands.executeCommand('shortestpath.oj.localTestsChanged', snapshot).then(undefined, error => globalThis.logger.error('Local test update failed', error));
		},
	});
	context.subscriptions.push(new vscode.Disposable(() => service.dispose()));
	context.subscriptions.push(vscode.commands.registerCommand('judger.integratedTests', (request: IntegratedTestRequest) => {
		if (!request || typeof request.sourcePath !== 'string') { throw new Error('invalid-test'); }
		const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		const uri = (input as { uri?: vscode.Uri } | undefined)?.uri;
		const activeSourcePath = uri?.scheme === 'file' ? uri.fsPath : !input ? vscode.window.activeTextEditor?.document.fileName : undefined;
		if (request.action === 'load' && activeSourcePath === request.sourcePath) {
			updateJudgeVisibility(getProblem(request.sourcePath) ?? undefined);
		}
		return service.request(request);
	}));
}

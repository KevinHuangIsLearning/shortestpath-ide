/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import localize from './i18n';
import { compileFile, getBinSaveLocation, runningCompilers, compilationsInProgress } from './compiler';
import { clearKillRequested, deleteBinary, killRunning, runningBinaries } from './executions';
import { getProblem, saveProblem } from './parser';
import { getLanguage } from './utils';
import { getIgnoreSTDERRORPref } from './preferences';
import { executeAndJudgeTestCase } from './testCaseExecution';
import { diffOutput } from './utils/diffOutput';
import { IntegratedTestRequest, IntegratedTestService, areTokenOutputsEqual } from './integratedTests';
import { isStressTestRunning } from './stressTest';
import { isLargeSampleTestRunning } from './largeSampleTest';
import { updateJudgeVisibility } from './extension';

let service: IntegratedTestService;
export function isIntegratedTestRunning(): boolean { return service?.isRunning ?? false; }
export function getIntegratedTestService(): IntegratedTestService { return service; }

export function registerIntegratedTestCommands(context: vscode.ExtensionContext, ordinaryRunBusy: () => boolean): void {
	service = new IntegratedTestService({
		read: getProblem,
		write: problem => saveProblem(problem.srcPath, problem),
		compile: async (problem, diagnostic, isCancelled) => {
			clearKillRequested();
			return compileFile(problem.srcPath, { silent: true, reportProgress: diagnostic, isCancelled });
		},
		execute: async (problem, test, checking) => {
			const checkerPath = problem.customCheckerPath?.trim() || undefined;
			if (checkerPath && !fs.existsSync(checkerPath)) { throw new Error(localize('cph.processRunSingle.invalidChecker', "Custom checker script not found at '{0}'", checkerPath)); }
			const result = await executeAndJudgeTestCase(getLanguage(problem.srcPath), getBinSaveLocation(problem.srcPath), {
				id: test.id, input: test.input, expectedOutput: test.output, checkerPath,
				maxOutputSize: 1_000_000,
				failOnStderr: !getIgnoreSTDERRORPref(), judgeOutput: (_expected, stdout) => areTokenOutputsEqual(test.output, stdout), onChecking: checking,
			});
			if (!checkerPath && result.pass === false) { result.diff = diffOutput(test.output, result.stdout); }
			return result;
		},
		cleanup: problem => deleteBinary(getLanguage(problem.srcPath), getBinSaveLocation(problem.srcPath)),
		stop: killRunning,
		busy: () => ordinaryRunBusy() || compilationsInProgress > 0 || isStressTestRunning() || isLargeSampleTestRunning() || runningCompilers.length > 0 || runningBinaries.length > 0,
		publish: snapshot => {
			void vscode.commands.executeCommand('shortestpath.oj.localTestsChanged', snapshot).then(undefined, error => globalThis.logger.error('Local test update failed', error));
		},
	});
	context.subscriptions.push(new vscode.Disposable(() => service.dispose()));
	context.subscriptions.push(vscode.commands.registerCommand('cph.integratedTests', (request: IntegratedTestRequest) => {
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

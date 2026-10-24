/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { usesIntegratedTests } from './integratedTests';
import { getDefaultProblemSource, getOjMapping, getVjudgeBrowserSplitRatio, getVjudgeOpenInBrowser, getVjudgeUrlSuffix } from './preferences';
import { appendVjudgeUrlSuffix, getProblemDisplayTarget, getProblemSourceForUrl, ProblemDisplayTarget } from './problemDisplay';
import type { Problem } from './types';
import { getProblem, saveProblem } from './parser';
import * as path from 'path';

const pending = new Map<string, Promise<void>>();

/** Restore the imported page beside its source, including after closing or reloading the IDE. */
export const openProblemBrowser = async (problem: Problem, importedTarget?: ProblemDisplayTarget): Promise<void> => {
	if (usesIntegratedTests(problem)) { return; }
	if (!problem.browserProblemUrl && !/^https?:\/\//i.test(problem.url)) { return; }
	const target = importedTarget ?? getProblemDisplayTarget(
		getVjudgeOpenInBrowser(),
		getProblemSourceForUrl(problem.url, getOjMapping(), getDefaultProblemSource()),
		problem.url,
		problem.browserProblemUrl,
	);
	if (!target) { return; }
	const url = !importedTarget && problem.browserProblemUrl ? problem.browserProblemUrl : target.source === 'vjudge' ? appendVjudgeUrlSuffix(target.url, getVjudgeUrlSuffix()) : target.url;
	const key = JSON.stringify([problem.srcPath, url]);
	const existing = pending.get(key);
	if (existing) { return existing; }
	const opening = (async () => {
		await vscode.commands.executeCommand('workbench.action.browser.open', {
			url,
			openInEditor: true,
			sourceEditor: vscode.Uri.file(problem.srcPath).toString(),
			sourceEditorRatio: getVjudgeBrowserSplitRatio(),
		});
	})();
	pending.set(key, opening);
	try { await opening; } finally { if (pending.get(key) === opening) { pending.delete(key); } }
};

/** The native editor button opens a blank companion for files without a problem URL. */
export function registerProblemBrowser(context: vscode.ExtensionContext, changed: (problem: Problem) => void): void {
	context.subscriptions.push(vscode.commands.registerCommand('judger.openProblemBrowser', async (sourcePath: string) => {
		const problem = getProblem(sourcePath);
		if (usesIntegratedTests(problem)) {
			await vscode.commands.executeCommand('shortestpath.oj.showProblemForCph', problem!.url);
			return;
		}
		const url = problem?.browserProblemUrl || problem?.url;
		await vscode.commands.executeCommand('workbench.action.browser.open', {
			url: url && /^https?:\/\//i.test(url) ? url : undefined,
			openInEditor: true,
			sourceEditor: vscode.Uri.file(sourcePath).toString(),
			sourceEditorRatio: getVjudgeBrowserSplitRatio(),
		});
	}));
	context.subscriptions.push(vscode.commands.registerCommand('judger.setProblemBrowserUrl', async (sourcePath: string, url: string) => {
		if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath) || typeof url !== 'string' || !/^https?:\/\//i.test(url)) { return; }
		const parsed = new URL(url);
		if (!parsed.hostname) { return; }
		await vscode.workspace.fs.stat(vscode.Uri.file(sourcePath));
		const current = getProblem(sourcePath);
		const problem: Problem = current ?? {
			name: path.basename(sourcePath), srcPath: sourcePath, url: sourcePath, local: true, group: 'local',
			tests: [], interactive: false, memoryLimit: 1024, timeLimit: 3000,
		};
		problem.browserProblemUrl = url;
		saveProblem(sourcePath, problem);
		changed(problem);
	}));
}

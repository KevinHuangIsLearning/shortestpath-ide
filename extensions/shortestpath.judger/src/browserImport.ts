/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { registerBrowserImportCleanup } from './browserImportCleanup';
import fs from 'fs';
import path from 'path';
import { validateCompanionProblem } from './companionProtocol';
import localize from './i18n';
import { Problem } from './types';
import { isShortestPathBrowserUrl, shortestPathStartProblemScript } from './shortestpathBrowserImport';

type CDPResult = {
	targetInfos?: { targetId: string; type: string }[];
	sessionId?: string;
	frameTree?: { frame: { id: string } };
	executionContextId?: number;
	result?: { value?: unknown };
	exceptionDetails?: { text?: string; exception?: { description?: string } };
};
type CDPMessage = { id?: number; sessionId?: string; result?: CDPResult; error?: { message: string } };

/** Evaluate in a separate JS world, and always detach on completion or failure. */
async function evaluateBrowserPage(tab: vscode.BrowserTab, expression: string, expectedUrl?: string): Promise<unknown> {
	const session = await tab.startCDPSession();
	let nextId = 0;
	let closed = false;
	const pending = new Map<number, (error: Error) => void>();
	const closedListener = session.onDidClose(() => {
		closed = true;
		for (const reject of [...pending.values()]) { reject(new Error(localize('judger.browserImport.closed', 'The browser was closed.'))); }
	});
	const send = (method: string, params: object = {}, sessionId?: string): Promise<CDPResult> => new Promise((resolve, reject) => {
		if (closed) { reject(new Error(localize('judger.browserImport.closed', 'The browser was closed.'))); return; }
		const id = ++nextId;
		const finish = (error?: Error, result: CDPResult = {}) => {
			clearTimeout(timer); listener.dispose(); pending.delete(id);
			if (error) { reject(error); } else { resolve(result); }
		};
		const listener = session.onDidReceiveMessage(raw => {
			const message = raw as CDPMessage;
			if (message.id !== id || message.sessionId !== sessionId) { return; }
			const exception = message.result?.exceptionDetails;
			finish(message.error || exception ? new Error(message.error?.message || exception?.exception?.description || exception?.text) : undefined, message.result);
		});
		const timer = setTimeout(() => finish(new Error(localize('judger.browserImport.timeout', 'Problem parsing timed out.'))), method === 'Runtime.evaluate' ? 120000 : 30000);
		pending.set(id, error => finish(error));
		void Promise.resolve(session.sendMessage({ id, method, params, ...(sessionId ? { sessionId } : {}) })).catch(error => finish(error instanceof Error ? error : new Error(String(error))));
	});
	try {
		const targets = await send('Target.getTargets');
		const target = targets.targetInfos?.find(info => info.type === 'page');
		if (!target) { throw new Error(localize('judger.browserImport.noPage', 'No browser page was found.')); }
		const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
		const sid = attached.sessionId;
		if (!sid) { throw new Error(localize('judger.browserImport.noPage', 'No browser page was found.')); }
		const frames = await send('Page.getFrameTree', {}, sid);
		if (!frames.frameTree) { throw new Error(localize('judger.browserImport.noPage', 'No browser page was found.')); }
		const world = await send('Page.createIsolatedWorld', { frameId: frames.frameTree.frame.id, worldName: 'shortestpath-companion' }, sid);
		if (world.executionContextId === undefined) { throw new Error(localize('judger.browserImport.noPage', 'No browser page was found.')); }
		const checkedExpression = expectedUrl ? `(async () => { const expected = ${JSON.stringify(expectedUrl)}; if (location.href !== expected) throw new Error(${JSON.stringify(localize('judger.browserImport.pageChanged', 'The page changed during import. Please retry.'))}); const result = await (${expression}); if (location.href !== expected) throw new Error(${JSON.stringify(localize('judger.browserImport.pageChanged', 'The page changed during import. Please retry.'))}); return result; })()` : expression;
		const parsed = await send('Runtime.evaluate', { expression: checkedExpression, contextId: world.executionContextId, awaitPromise: true, returnByValue: true }, sid);
		return parsed.result?.value;
	} finally {
		closedListener.dispose();
		await session.close();
	}
}

export async function parseBrowserProblems(tab: vscode.BrowserTab, expression: string, expectedUrl?: string): Promise<Problem[]> {
	const value = await evaluateBrowserPage(tab, expression, expectedUrl);
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(localize('judger.browserImport.empty', 'Competitive Companion did not return any problems.'));
	}
	return value.map(validateCompanionProblem);
}

export async function startShortestPathBrowserProblem(tab: vscode.BrowserTab): Promise<void> {
	if (await evaluateBrowserPage(tab, shortestPathStartProblemScript()) !== true) {
		throw new Error(localize('judger.browserImport.startUnavailable', 'Open a ShortestPath OJ problem detail page and wait for its Start Solving button.'));
	}
}

export type BrowserImportResult = { count: number; error?: string; cancelled?: boolean };

export function registerBrowserImport(context: vscode.ExtensionContext, importProblem: (problem: Problem) => Promise<{ created: boolean }>): void {
	registerBrowserImportCleanup(context);
	const running = new Set<string>();
	context.subscriptions.push(vscode.commands.registerCommand('judger.importBrowserProblem', async (tabId?: string, parserId?: string, expectedUrl?: string): Promise<BrowserImportResult> => {
		const tab = tabId ? vscode.window.browserTabs?.find(candidate => candidate.id === tabId) : vscode.window.activeBrowserTab;
		if (!tab) { return { count: 0, error: localize('judger.browserImport.open', 'Open a problem in the integrated browser first.') }; }
		const shortestPath = isShortestPathBrowserUrl(tab.url);
		if (!shortestPath && !vscode.workspace.workspaceFolders?.length) { return { count: 0, error: localize('judger.companion.openFolder', 'Please open a folder first.') }; }
		if (running.has(tab.id)) { return { count: 0, cancelled: true }; }
		running.add(tab.id);
		let count = 0;
		try {
			if (shortestPath) {
				await startShortestPathBrowserProblem(tab);
				return { count: 0 };
			}
			const sourceUrl = expectedUrl ?? tab.url;
			if (!parserId) {
				const runtime = await fs.promises.readFile(path.join(context.extensionPath, 'dist/static/competitive-companion/parsers.runtime.txt'), 'utf8');
				const inspected = await evaluateBrowserPage(tab, `(() => { ${runtime}; return globalThis.ShortestPathCompanionInspect(); })()`, sourceUrl);
				const choices = Array.isArray(inspected) ? inspected.filter((choice): choice is { id: string; name: string; patterns: string[]; matched: boolean } => typeof choice?.id === 'string' && typeof choice?.name === 'string' && Array.isArray(choice?.patterns) && typeof choice?.matched === 'boolean') : [];
				parserId = choices.find(choice => choice.matched)?.id;
				if (!parserId) {
					const selected = await vscode.window.showQuickPick(choices.map(choice => ({ label: choice.name, description: choice.patterns.join(', '), parserId: choice.id })), {
					placeHolder: localize('judger.browserImport.chooseParser', 'Choose Parser…'), matchOnDescription: true,
				});
					if (!selected) { return { count: 0, cancelled: true }; }
					parserId = selected.parserId;
				}
			}
			const bundle = await fs.promises.readFile(path.join(context.extensionPath, 'dist/static/competitive-companion/parsers.bundle.txt'), 'utf8');
			const expression = `(async () => { globalThis.__shortestpathParserId = ${JSON.stringify(parserId ?? null)}; return await (${bundle}); })()`;
			const problems = await parseBrowserProblems(tab, expression, sourceUrl);
			for (const problem of problems) {
				if (tab.url !== sourceUrl) { throw new Error(localize('judger.browserImport.pageChanged', 'The page changed during import. Please retry.')); }
				if (!(await importProblem(problem)).created) { return { count, cancelled: true }; }
				count++;
			}
			return { count };
		} catch (error) {
			const message = localize('judger.browserImport.error', 'Could not import this page: {0}', String(error));
			if (shortestPath) { vscode.window.showErrorMessage(message); }
			return { count, error: message };
		}
		finally { running.delete(tab.id); }
	}));
}

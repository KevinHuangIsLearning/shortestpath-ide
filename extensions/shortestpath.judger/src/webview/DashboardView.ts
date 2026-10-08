/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { confirmAndUpdateDashboardCompletion } from '../dashboardCompletion';
import fs from 'fs/promises';
import crypto from 'crypto';
import { readDashboard, dashboardContains } from '../dashboardRepository';
import { buildDashboard, DashboardFilter, DashboardProblem, DashboardRange, validDashboardRange } from '../dashboardStats';
import { isShortestPathProblem, elapsedOjTime } from '../problemTimer';
import { getVjudgeOjNames, getSaveLocationPref } from '../preferences';
import { restoreOriginalProblemUrl } from '../problemDisplay';
import { OjTimer } from '../types';
import { webviewBootstrap } from '../webviewBootstrap';
import { translations } from './translations';
import localize from '../i18n';

/** One standalone page per extension instance; all paths and URLs come from the host snapshot. */
export function registerDashboard(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.window.registerTreeDataProvider('shortestpath.dashboard', {
		getTreeItem: (item: vscode.TreeItem) => item,
		getChildren: () => [],
	}));
	let panel: vscode.WebviewPanel | undefined;
	context.subscriptions.push(vscode.commands.registerCommand('judger.openDashboard', () => {
		if (panel) { panel.reveal(); return; }
		const current = vscode.window.createWebviewPanel('judger.dashboard', localize('judger.dashboard.title', 'Problem Dashboard'), vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')] });
		panel = current;
		let revision = 0, disposed = false;
		let problems = new Map<string, DashboardProblem>();
		const subscriptions: vscode.Disposable[] = [];
		let selection: { year?: number; filter: DashboardFilter; range?: DashboardRange } = { filter: {} };
		const load = async (year?: number, filter: DashboardFilter = {}, range?: DashboardRange) => {
			selection = { year, filter, range };
			const version = ++revision;
			try {
				const roots = vscode.workspace.workspaceFolders?.filter(folder => folder.uri.scheme === 'file').map(folder => folder.uri.fsPath) ?? [];
				const result = await readDashboard(roots, getSaveLocationPref() || undefined);
				for (const record of result.records) {
					record.originalUrl = restoreOriginalProblemUrl(record.url, getVjudgeOjNames());
					if (!isShortestPathProblem(record.url)) { continue; }
					// Existing API validates the cached problem and its source binding.
					try {
						const timer = await vscode.commands.executeCommand<OjTimer | undefined>('shortestpath.oj.getTimerForJudger', record.url, record.srcPath);
						if (timer && typeof timer.accepted === 'boolean' && Number.isFinite(timer.elapsedMs) && timer.elapsedMs >= 0) { record.serverAccepted = timer.accepted; record.serverElapsedMs = elapsedOjTime(timer); record.serverRunning = timer.mode === 'timed' && timer.running && !timer.accepted; }
					} catch { /* Missing or invalid cache has no inferred server state. */ }
					// Local completion fields are not authoritative for server problems.
					if (record.serverAccepted === undefined) { record.timeAcceptedAtUnixMs = undefined; record.timePartialAcceptedAtUnixMs = undefined; }
				}
				if (disposed || version !== revision) { return; }
				const data = { ...buildDashboard(result.records, year, filter, new Date(), range), revision: version, skipped: result.skipped };
				problems = new Map(data.problems.map(problem => [problem.id, problem]));
				await current.webview.postMessage({ command: 'dashboard-data', data });
			} catch { if (!disposed && version === revision) { await current.webview.postMessage({ command: 'dashboard-error' }); } }
		};
		subscriptions.push(current.webview.onDidReceiveMessage(async message => {
			if (!message || typeof message !== 'object') { return; }
			if (message.command === 'dashboard-load') {
				const year = message.year;
				if (year !== undefined && (!Number.isInteger(year) || year < 1970 || year > 9999)) { return; }
				const range = message.range;
				if (range !== undefined && (!range || typeof range !== 'object' || !validDashboardRange(range) || year !== undefined)) { return; }
				const filter = message.filter;
				if (filter !== undefined && (!filter || typeof filter !== 'object' || filter.source !== undefined && typeof filter.source !== 'string' || filter.status !== undefined && !['accepted', 'partial', 'pending', 'unmarked'].includes(filter.status))) { return; }
				await load(year, filter, range); return;
			}
			if (typeof message.problemId !== 'string') { return; }
			const problem = problems.get(message.problemId);
			if (!problem) { return; }
			try {
				if (message.command === 'dashboard-set-completion') {
					if (!['partial', 'accepted'].includes(message.completion)) { return; }
					const confirmationRevision = revision;
					const confirm = localize('judger.dashboard.confirmAction', 'Confirm');
					const target = message.completion === 'accepted' ? 'AC' : localize('judger.dashboard.partial', 'Partial AC');
					const changed = await confirmAndUpdateDashboardCompletion(problem, message.completion,
						() => vscode.workspace.workspaceFolders?.filter(folder => folder.uri.scheme === 'file').map(folder => folder.uri.fsPath) ?? [],
						async () => await vscode.window.showWarningMessage(localize('judger.dashboard.confirmCompletion', 'Mark "{0}" as {1}?', problem.name, target), { modal: true, detail: localize('judger.dashboard.confirmCompletionDetail', 'The timer stays at 5:00:00+ and activity remains on the creation date.') }, confirm) === confirm,
						() => !disposed && revision === confirmationRevision && problems.get(problem.id) === problem);
					if (changed) { await load(selection.year, selection.filter, selection.range); }
				} else if (message.command === 'dashboard-open-source') {
					if (problem.sourceAvailable === false) { return; }
					const real = await fs.realpath(problem.srcPath);
					const roots = vscode.workspace.workspaceFolders?.filter(folder => folder.uri.scheme === 'file') ?? [];
					const realRoots = await Promise.all(roots.map(folder => fs.realpath(folder.uri.fsPath)));
					if (!realRoots.some(root => dashboardContains(root, real))) { return; }
					await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(real)), { preview: false });
				} else if (message.command === 'dashboard-open-url') {
					const url = new URL(problem.url);
					if (/^https?:$/.test(url.protocol)) {
						await vscode.commands.executeCommand('shortestpath.mode.browse');
						await vscode.commands.executeCommand('shortestpath.browser.open', url.toString());
					}
				}
			} catch { await vscode.window.showErrorMessage(message.command === 'dashboard-set-completion' ? localize('judger.dashboard.updateFailed', 'Unable to update completion. Refresh Dashboard and retry.') : localize('judger.dashboard.openFailed', 'Unable to open the selected problem. Refresh Dashboard and retry.')); }
		}));
		subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { problems.clear(); revision++; void current.webview.postMessage({ command: 'dashboard-reload' }); }));
		current.onDidDispose(() => { disposed = true; revision++; panel = undefined; subscriptions.forEach(item => item.dispose()); });
		const nonce = crypto.randomBytes(16).toString('hex');
		const script = current.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'dashboard.module.js'));
		const style = current.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'dashboard.css'));
		const language = vscode.env.language.toLowerCase();
		const locale = language.startsWith('zh') ? 'zh-cn' : language.split('-')[0];
		current.webview.html = `<!DOCTYPE html><html lang="${locale}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${current.webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${style}"></head><body><div id="dashboard"></div><script nonce="${nonce}">${webviewBootstrap({ translations: translations[locale] || translations.en })}</script><script nonce="${nonce}" src="${script}"></script></body></html>`;
	}));
	context.subscriptions.push({ dispose: () => panel?.dispose() });
}

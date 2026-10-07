/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import localize from './i18n';
import fs from 'fs';
import path from 'path';
import { mountImportControl } from './browserImportControl';
import type { BrowserImportResult } from './browserImport';

const worldName = 'shortestpath-import-button';
const bindingName = '__shortestpathImportProblem';
const elementId = 'shortestpath-import-button';

/** A shadow root protects IDE controls from the page's styles; only the top frame gets a button. */
export function browserImportButtonScript(label: string, title: string, runtime = '', initiallyCollapsed = false): string {
	const labels = {
		add: label, choose: title,
		search: localize('judger.browserImport.search', 'Search parsers by name or domain'),
		empty: localize('judger.browserImport.noParsers', 'No matching parsers.'),
		importing: localize('judger.browserImport.importing', 'Importing…'),
		success: localize('judger.browserImport.success', 'Imported {0} problem(s).'),
		cancelled: localize('judger.browserImport.cancelled', 'Import cancelled.'),
		matched: localize('judger.browserImport.matched', 'Matched'),
		collapse: localize('judger.browserImport.collapse', 'Collapse import controls'),
		expand: localize('judger.browserImport.expand', 'Expand import controls'),
		drag: localize('judger.browserImport.drag', 'Drag to move; use arrow keys to adjust'),
		close: localize('judger.browserImport.closePicker', 'Close parser picker'),
	};
	return `(() => {
		if (window !== window.top || !/^https?:$/.test(location.protocol) || window.__shortestpathImportButtonCleanup) return;
		${runtime};
		(${mountImportControl.toString()})(${JSON.stringify(labels)}, ${JSON.stringify(initiallyCollapsed)} || window.__shortestpathImportButtonInitiallyCollapsed === true);
	})()`;
}

type Message = { id?: number; sessionId?: string; method?: string; params?: any; result?: any; error?: { message: string } };

type ImportButtonHandle = vscode.Disposable & { collapse(): Promise<void> };

export async function attachBrowserImportButton(tab: vscode.BrowserTab, importCurrent: (parserId: string, expectedUrl: string) => Promise<BrowserImportResult>, runtime = '', initiallyCollapsed = false): Promise<ImportButtonHandle> {
	const session = await tab.startCDPSession();
	let disposed = false, nextId = 0, sid: string | undefined, identifier: string | undefined, mainFrame: string | undefined;
	const contexts = new Set<number>();
	const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
	const rejectPending = () => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Browser session closed')); } pending.clear(); };
	const send = (method: string, params: object = {}, sessionId = sid): Promise<any> => new Promise((resolve, reject) => {
		if (disposed) { reject(new Error('Browser session closed')); return; }
		const id = ++nextId;
		const timer = setTimeout(() => { pending.delete(id); reject(new Error('Browser button request timed out')); }, 30000);
		pending.set(id, { resolve, reject, timer });
		void Promise.resolve(session.sendMessage({ id, method, params, ...(sessionId ? { sessionId } : {}) })).catch(error => { const request = pending.get(id); if (request) { clearTimeout(timer); pending.delete(id); reject(error); } });
	});
	let busy = false;
	let collapseRequested = initiallyCollapsed;
	const collapseExpression = 'window.__shortestpathImportButtonInitiallyCollapsed = true; window.__shortestpathImportButtonCollapse?.()';
	const listener = session.onDidReceiveMessage(raw => {
		const event = raw as Message;
		if (event.id !== undefined) {
			const request = pending.get(event.id);
			if (request) { clearTimeout(request.timer); pending.delete(event.id); event.error ? request.reject(new Error(event.error.message)) : request.resolve(event.result); }
			return;
		}
		if (event.sessionId !== sid) { return; }
		if (event.method === 'Runtime.executionContextsCleared') { contexts.clear(); }
		if (event.method === 'Runtime.executionContextDestroyed') { contexts.delete(event.params?.executionContextId); }
		const context = event.params?.context;
		if (event.method === 'Runtime.executionContextCreated' && context?.name === worldName && context.auxData?.frameId === mainFrame) {
			contexts.add(context.id);
			if (collapseRequested) { void send('Runtime.evaluate', { expression: collapseExpression, contextId: context.id }).catch(() => {}); }
		}
		if (event.method !== 'Runtime.bindingCalled' || event.params?.name !== bindingName || !contexts.has(event.params.executionContextId) || busy || disposed) { return; }
		let request: { action?: string; parserId?: string; url?: string };
		try { request = JSON.parse(event.params.payload); } catch { return; }
		if (request.action !== 'import' || typeof request.parserId !== 'string' || typeof request.url !== 'string') { return; }
		busy = true;
		const contextId = event.params.executionContextId;
		const update = (value: boolean) => send('Runtime.evaluate', { expression: `window.__shortestpathImportButtonBusy?.(${value})`, contextId }).catch(() => {});
		const report = (result: BrowserImportResult) => send('Runtime.evaluate', { expression: `window.__shortestpathImportButtonResult?.(${JSON.stringify(result)})`, contextId }).catch(() => {});
		void (async () => {
			try {
				await update(true);
				const current = await send('Runtime.evaluate', { expression: 'location.href', contextId });
				if (current.result?.value !== request.url) { return; }
				await report(await importCurrent(request.parserId!, request.url!));
			} catch (error) {
				await report({ count: 0, error: localize('judger.browserImport.error', 'Could not import this page: {0}', String(error)) });
			} finally {
				busy = false;
				if (!disposed) { await update(false); }
			}
		})();
	});
	const closed = session.onDidClose(() => { disposed = true; rejectPending(); listener.dispose(); closed.dispose(); });
	const dispose = async () => {
		if (disposed) { return; }
		try {
			if (identifier) { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
			await Promise.all([...contexts].map(contextId => send('Runtime.evaluate', { expression: 'window.__shortestpathImportButtonCleanup?.()', contextId }).catch(() => {})));
			if (sid) { await send('Runtime.removeBinding', { name: bindingName }); }
		} finally { disposed = true; rejectPending(); listener.dispose(); closed.dispose(); await session.close(); }
	};
	try {
		const targets = await send('Target.getTargets');
		const target = targets.targetInfos?.find((info: { type: string }) => info.type === 'page');
		if (!target) { throw new Error('No browser page'); }
		sid = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
		if (!sid) { throw new Error('No browser session'); }
		mainFrame = (await send('Page.getFrameTree')).frameTree?.frame.id;
		await send('Page.enable');
		await send('Runtime.enable');
		await send('Runtime.addBinding', { name: bindingName, executionContextName: worldName });
		const source = browserImportButtonScript(localize('judger.browserImport.button', '+ Add problem'), localize('judger.browserImport.chooseParser', 'Choose Parser…'), runtime, initiallyCollapsed);
		identifier = (await send('Page.addScriptToEvaluateOnNewDocument', { source, worldName, runImmediately: true })).identifier;
		return { collapse: async () => {
			if (disposed) { return; }
			const updateSource = !collapseRequested;
			collapseRequested = true;
			if (updateSource) {
				const oldIdentifier = identifier;
				const collapsedSource = browserImportButtonScript(localize('judger.browserImport.button', '+ Add problem'), localize('judger.browserImport.chooseParser', 'Choose Parser…'), runtime, true);
				identifier = (await send('Page.addScriptToEvaluateOnNewDocument', { source: collapsedSource, worldName })).identifier;
				if (oldIdentifier) { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: oldIdentifier }); }
			}
			await Promise.all([...contexts].map(contextId => send('Runtime.evaluate', { expression: collapseExpression, contextId }).catch(() => {})));
		}, dispose: () => { void dispose().catch(error => globalThis.logger?.warn('Browser button cleanup', String(error))); } };
	} catch (error) { await dispose(); throw error; }
}

export function registerBrowserImportButtons(context: vscode.ExtensionContext): void {
	const attached = new Map<string, Promise<ImportButtonHandle>>();
	let disposed = false;
	let importsInProgress = 0;
	const attach = (tab: vscode.BrowserTab) => {
		if (disposed || attached.has(tab.id)) { return; }
		const initiallyCollapsed = importsInProgress > 0;
		const task = fs.promises.readFile(path.join(context.extensionPath, 'dist/static/competitive-companion/parsers.runtime.txt'), 'utf8').then(runtime => attachBrowserImportButton(tab, async (parserId, expectedUrl) => {
			const before = new Map((vscode.window.browserTabs ?? []).map(browser => [browser.id, browser.url]));
			importsInProgress++;
			try {
				const result = await vscode.commands.executeCommand<BrowserImportResult>('judger.importBrowserProblem', tab.id, parserId, expectedUrl);
				if (result.count > 0) {
					await Promise.all((vscode.window.browserTabs ?? []).filter(browser => browser.id === tab.id || before.get(browser.id) !== browser.url).map(browser => attached.get(browser.id)?.then(handle => handle.collapse().catch(error => globalThis.logger?.warn('Browser button collapse', String(error))), () => {})));
				}
				return result;
			} finally { importsInProgress--; }
		}, runtime, initiallyCollapsed));
		attached.set(tab.id, task);
		void task.catch(error => { if (attached.get(tab.id) === task) { attached.delete(tab.id); } globalThis.logger?.warn('Browser button unavailable', String(error)); });
	};
	for (const tab of vscode.window.browserTabs ?? []) { attach(tab); }
	if (vscode.window.onDidOpenBrowserTab) { context.subscriptions.push(vscode.window.onDidOpenBrowserTab(attach)); }
	if (vscode.window.onDidChangeBrowserTabState) { context.subscriptions.push(vscode.window.onDidChangeBrowserTabState(attach)); }
	if (vscode.window.onDidCloseBrowserTab) { context.subscriptions.push(vscode.window.onDidCloseBrowserTab(tab => { const task = attached.get(tab.id); attached.delete(tab.id); void task?.then(value => value.dispose(), () => {}); })); }
	context.subscriptions.push({ dispose: () => { disposed = true; for (const task of attached.values()) { void task.then(value => value.dispose(), () => {}); } attached.clear(); } });
}

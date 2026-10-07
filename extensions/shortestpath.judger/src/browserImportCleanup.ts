/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

/** Retained browser views can still contain the old IDE-owned import control after an upgrade. */
export function browserImportCleanupScript(): string {
	return `(() => {
		if (window !== window.top) return;
		window.__shortestpathImportButtonCleanup?.();
		document.getElementById('shortestpath-import-button')?.remove();
	})()`;
}

type Result = { targetInfos?: { targetId: string; type: string }[]; sessionId?: string; frameTree?: { frame: { id: string } }; executionContextId?: number };
type Message = { id?: number; sessionId?: string; result?: Result; error?: { message: string } };

/** Use the original isolated world to stop its observers and timers as well as removing its DOM. */
export async function cleanupBrowserImportButton(tab: vscode.BrowserTab): Promise<void> {
	const session = await tab.startCDPSession();
	let id = 0;
	const pending = new Map<number, (error: Error) => void>();
	const closed = session.onDidClose(() => { for (const reject of [...pending.values()]) { reject(new Error('Browser session closed')); } });
	const send = (method: string, params: object = {}, sessionId?: string): Promise<Result> => new Promise((resolve, reject) => {
		const requestId = ++id;
		const finish = (error?: Error, result: Result = {}) => {
			clearTimeout(timer); listener.dispose(); pending.delete(requestId);
			if (error) { reject(error); } else { resolve(result); }
		};
		const listener = session.onDidReceiveMessage(raw => {
			const message = raw as Message;
			if (message.id !== requestId || message.sessionId !== sessionId) { return; }
			finish(message.error ? new Error(message.error.message) : undefined, message.result);
		});
		const timer = setTimeout(() => finish(new Error('Browser cleanup timed out')), 30000);
		pending.set(requestId, error => finish(error));
		void Promise.resolve(session.sendMessage({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) })).catch(error => finish(error instanceof Error ? error : new Error(String(error))));
	});
	try {
		const target = (await send('Target.getTargets')).targetInfos?.find(info => info.type === 'page');
		if (!target) { return; }
		const sid = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
		if (!sid) { return; }
		const frame = (await send('Page.getFrameTree', {}, sid)).frameTree?.frame.id;
		if (!frame) { return; }
		const world = await send('Page.createIsolatedWorld', { frameId: frame, worldName: 'shortestpath-import-button' }, sid);
		if (world.executionContextId === undefined) { return; }
		await send('Runtime.evaluate', { expression: browserImportCleanupScript(), contextId: world.executionContextId }, sid);
	} finally {
		closed.dispose();
		await session.close();
	}
}

/** No page controls are injected; only the native browser toolbar offers import now. */
export function registerBrowserImportCleanup(context: vscode.ExtensionContext): void {
	const running = new Set<string>();
	const cleanup = (tab: vscode.BrowserTab) => {
		if (running.has(tab.id)) { return; }
		running.add(tab.id);
		void cleanupBrowserImportButton(tab).catch(error => globalThis.logger?.warn('Browser import control cleanup', String(error))).finally(() => running.delete(tab.id));
	};
	for (const tab of vscode.window.browserTabs ?? []) { cleanup(tab); }
	if (vscode.window.onDidOpenBrowserTab) { context.subscriptions.push(vscode.window.onDidOpenBrowserTab(cleanup)); }
}

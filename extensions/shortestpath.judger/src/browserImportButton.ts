/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import localize from './i18n';
import { shortestPathBrowserHelpers } from './shortestpathBrowserImport';

const worldName = 'shortestpath-import-button';
const bindingName = '__shortestpathImportProblem';
const elementId = 'shortestpath-import-button';

/** A shadow root protects IDE controls from the page's styles; only the top frame gets a button. */
export function browserImportButtonScript(label: string, title: string): string {
	return `(() => {
		if (window !== window.top || !/^https?:$/.test(location.protocol)) return;
		if (window.__shortestpathImportButtonCleanup) return;
		${shortestPathBrowserHelpers()}
		const shortestPath = isShortestPathBrowserUrl(location.href);
		let busy = false, observer;
		const mount = () => {
			const nativeButton = shortestPath ? findShortestPathStartButton() : undefined;
			let host = document.getElementById(${JSON.stringify(elementId)});
			if (shortestPath && (!isShortestPathProblemPage(location.href) || !nativeButton)) {
				host?.remove(); return;
			}
			if (host) { update(nativeButton); return; }
			host = document.createElement('div'); host.id = ${JSON.stringify(elementId)};
			host.style.cssText = 'all:initial!important;position:fixed!important;right:24px!important;bottom:24px!important;z-index:2147483647!important;display:block!important';
			const root = host.attachShadow({mode:'closed'});
			const button = document.createElement('button'); button.type = 'button';
			button.textContent = ${JSON.stringify(label)};
			button.style.cssText = 'all:initial;display:block;box-sizing:border-box;padding:12px 18px;border:1px solid #ffffff40;border-radius:24px;background:#237b4b;color:white;box-shadow:0 4px 18px #0004;font:600 14px/20px system-ui;cursor:pointer';
			button.addEventListener('click', event => { if (event.isTrusted && !button.disabled) window[${JSON.stringify(bindingName)}]('import'); });
			update = native => {
				const disabled = busy || !!native?.disabled;
				const tooltip = native ? native.title || native.getAttribute('aria-label') : ${JSON.stringify(title)};
				if (button.title !== tooltip) button.title = tooltip;
				if (button.getAttribute('aria-label') !== tooltip) button.setAttribute('aria-label', tooltip);
				if (button.disabled !== disabled) button.disabled = disabled;
				const opacity = disabled ? '.6' : '1', cursor = disabled ? 'wait' : 'pointer';
				if (button.style.opacity !== opacity) button.style.opacity = opacity;
				if (button.style.cursor !== cursor) button.style.cursor = cursor;
			};
			root.append(button); document.documentElement.append(host);
			update(nativeButton);
		};
		let update = () => {};
		window.__shortestpathImportButtonRefresh = mount;
		window.__shortestpathImportButtonBusy = value => { busy = value; mount(); };
		const start = () => {
			if (shortestPath) {
				observer = new MutationObserver(mount);
				observer.observe(document.documentElement, {subtree:true, childList:true, attributes:true, attributeFilter:['aria-label','disabled','title']});
				window.addEventListener('popstate', mount); window.addEventListener('hashchange', mount);
			}
			mount();
		};
		window.__shortestpathImportButtonCleanup = () => {
			observer?.disconnect();
			window.removeEventListener('popstate', mount); window.removeEventListener('hashchange', mount);
			document.removeEventListener('DOMContentLoaded', start);
			document.getElementById(${JSON.stringify(elementId)})?.remove();
			delete window.__shortestpathImportButtonBusy; delete window.__shortestpathImportButtonRefresh; delete window.__shortestpathImportButtonCleanup;
		};
		if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true}); else start();
	})()`;
}

type Message = { id?: number; sessionId?: string; method?: string; params?: any; result?: any; error?: { message: string } };

export async function attachBrowserImportButton(tab: vscode.BrowserTab, importCurrent: () => Promise<unknown>): Promise<vscode.Disposable> {
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
		if (event.method === 'Page.navigatedWithinDocument' && event.params?.frameId === mainFrame) {
			for (const contextId of contexts) {
				void send('Runtime.evaluate', { expression: 'window.__shortestpathImportButtonRefresh?.()', contextId }).catch(() => {});
			}
		}
		const context = event.params?.context;
		if (event.method === 'Runtime.executionContextCreated' && context?.name === worldName && context.auxData?.frameId === mainFrame) { contexts.add(context.id); }
		if (event.method !== 'Runtime.bindingCalled' || event.params?.name !== bindingName || event.params.payload !== 'import' || !contexts.has(event.params.executionContextId) || busy || disposed) { return; }
		busy = true;
		const contextId = event.params.executionContextId;
		const update = (value: boolean) => send('Runtime.evaluate', { expression: `window.__shortestpathImportButtonBusy?.(${value})`, contextId }).catch(() => {});
		void (async () => { try { await update(true); await importCurrent(); } finally { busy = false; if (!disposed) { await update(false); } } })().catch(error => globalThis.logger?.warn('Browser import button', String(error)));
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
		const source = browserImportButtonScript(localize('judger.browserImport.button', '+ Import problem'), localize('judger.browserImport.buttonTitle', 'Import this page with Competitive Companion'));
		identifier = (await send('Page.addScriptToEvaluateOnNewDocument', { source, worldName, runImmediately: true })).identifier;
		return { dispose: () => { void dispose().catch(error => globalThis.logger?.warn('Browser button cleanup', String(error))); } };
	} catch (error) { await dispose(); throw error; }
}

export function registerBrowserImportButtons(context: vscode.ExtensionContext): void {
	const attached = new Map<string, Promise<vscode.Disposable>>();
	let disposed = false;
	const attach = (tab: vscode.BrowserTab) => {
		if (disposed || attached.has(tab.id)) { return; }
		const task = attachBrowserImportButton(tab, () => Promise.resolve(vscode.commands.executeCommand('judger.importBrowserProblem', tab.id)));
		attached.set(tab.id, task);
		void task.catch(error => { if (attached.get(tab.id) === task) { attached.delete(tab.id); } globalThis.logger?.warn('Browser button unavailable', String(error)); });
	};
	for (const tab of vscode.window.browserTabs ?? []) { attach(tab); }
	if (vscode.window.onDidOpenBrowserTab) { context.subscriptions.push(vscode.window.onDidOpenBrowserTab(attach)); }
	if (vscode.window.onDidChangeBrowserTabState) { context.subscriptions.push(vscode.window.onDidChangeBrowserTabState(attach)); }
	if (vscode.window.onDidCloseBrowserTab) { context.subscriptions.push(vscode.window.onDidCloseBrowserTab(tab => { const task = attached.get(tab.id); attached.delete(tab.id); void task?.then(value => value.dispose(), () => {}); })); }
	context.subscriptions.push({ dispose: () => { disposed = true; for (const task of attached.values()) { void task.then(value => value.dispose(), () => {}); } attached.clear(); } });
}

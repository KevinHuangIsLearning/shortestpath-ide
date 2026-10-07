/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { expandLocalHeaders } from './localHeaders';
import * as vscode from 'vscode';
import * as path from 'path';
import { getCustomSubmitScripts, getOjMapping, getVjudgeOjNames } from './preferences';
import { defaultSubmissionTemplates, replaceSubmissionPlaceholders, resolveSubmission, submissionAliases, submissionUrl, SubmissionTemplate, SubmissionValues, vjudgeSubmitScript } from './submissionTemplates';
import { Problem } from './types';
import localize from './i18n';
import { parseUserScript, userScriptBootstrap } from './userScripts';
import { resolveUserSubmission, registerUserScriptCommands } from './submissionUserScripts';
import crypto from 'crypto';
import { loadScriptResources } from './userScriptResources';
import { handleScriptRequest, ScriptRequest } from './userScriptBridge';

let submissionOutput: vscode.OutputChannel | undefined;

export function logSubmission(message: string): void {
	const line = `[Submission] ${message}`;
	globalThis.logger?.info?.(line);
	submissionOutput?.appendLine(`${new Date().toISOString()} ${line}`);
}

async function confirmSubmission(): Promise<boolean> {
	logSubmission('Form filled; waiting for submission confirmation');
	const answer = await vscode.window.showInformationMessage(localize('judger.browserSubmit.confirm', 'Confirm submission?'), { modal: true }, 'OK');
	logSubmission(answer === 'OK' ? 'Submission confirmed' : 'Submission cancelled; form left unchanged');
	return answer === 'OK';
}

function submissionPage(url: string): string {
	try {
		const parsed = new URL(url);
		return parsed.origin + parsed.pathname + parsed.hash;
	} catch { return '(invalid URL)'; }
}

type CDPResult = { frameTree?: { frame: { id: string } }; identifier?: string; targetInfos?: { targetId: string; type: string }[]; sessionId?: string; result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } }; errorText?: string };
type CDPMessage = { method?: string; params?: { name?: string; payload?: string; args?: { value?: unknown }[]; executionContextId?: number; context?: { id: number; name: string; origin: string; auxData?: { frameId?: string } } }; id?: number; sessionId?: string; result?: CDPResult; error?: { message: string } };

export async function executeSubmissionScript(template: SubmissionTemplate, values: SubmissionValues): Promise<void> {
	if (!vscode.workspace.isTrusted) { throw new Error(localize('judger.browserSubmit.trust', 'Trust this workspace before running submission scripts.')); }
	if (!template || typeof template.urlTemplate !== 'string' || typeof template.script !== 'string' || !values || Object.values(values).some(value => typeof value !== 'string')) {
		throw new Error(localize('judger.browserSubmit.invalid', 'Invalid submission script configuration.'));
	}
	const url = submissionUrl(template.urlTemplate, values);
	logSubmission(`Opening ${submissionPage(url)}`);
	if (!vscode.window.openBrowserTab) { throw new Error(localize('judger.browserSubmit.unavailable', 'The integrated browser API is unavailable.')); }
	// Attach before navigating so script execution cannot race the initial page load.
	await vscode.commands.executeCommand('shortestpath.mode.browse');
	const tab = await vscode.window.openBrowserTab('about:blank', { preserveFocus: false });
	logSubmission('Browser tab opened; attaching CDP');
	const session = await tab.startCDPSession();
	let nextId = 0;
	let sessionClosed = false;
	const pending = new Map<number, { reject: (reason: Error) => void }>();
	const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<CDPResult> => new Promise((resolve, reject) => {
		if (sessionClosed) { reject(new Error(localize('judger.browserSubmit.closed', 'The browser was closed.'))); return; }
		const id = ++nextId;
		const finish = (error?: Error, result: CDPResult = {}) => { clearTimeout(timer); listener.dispose(); pending.delete(id); if (error) { reject(error); } else { resolve(result); } };
		const listener = session.onDidReceiveMessage(raw => {
			const message = raw as CDPMessage;
			if (message.id !== id || message.sessionId !== sessionId) { return; }
			const exception = message.result?.exceptionDetails;
			if (message.error || exception) { logSubmission(`${method} failed: ${message.error?.message || exception?.exception?.description || exception?.text}`); }
			finish(message.error || exception ? new Error(message.error?.message || exception?.exception?.description || exception?.text) : undefined, message.result);
		});
		const timer = setTimeout(() => finish(new Error(localize('judger.browserSubmit.timeout', 'Browser script execution timed out.'))), 30000);
		pending.set(id, { reject: error => finish(error) });
		void Promise.resolve(session.sendMessage({ id, method, params, ...(sessionId ? { sessionId } : {}) })).catch(error => finish(error instanceof Error ? error : new Error(String(error))));
	});
	const closed = session.onDidClose(() => { sessionClosed = true; for (const request of [...pending.values()]) { request.reject(new Error(localize('judger.browserSubmit.closed', 'The browser was closed.'))); } });
	let bridgeListener: vscode.Disposable | undefined;
	let consoleListener: vscode.Disposable | undefined;
	let injected: { identifier: string; sid: string } | undefined;
	try {
		const targets = await send('Target.getTargets');
		const target = targets.targetInfos?.find(info => info.type === 'page');
		if (!target) { throw new Error(localize('judger.browserSubmit.noPage', 'No browser page was found.')); }
		const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
		if (!attached.sessionId) { throw new Error(localize('judger.browserSubmit.noPage', 'No browser page was found.')); }
		const sid = attached.sessionId;
		logSubmission('CDP attached to page');
		consoleListener = session.onDidReceiveMessage(raw => {
			const event = raw as CDPMessage;
			if (event.sessionId !== sid || event.method !== 'Runtime.consoleAPICalled') { return; }
			const value = event.params?.args?.[0]?.value;
			if (typeof value === 'string' && value.startsWith('[Judger submission] ')) {
				logSubmission(value.slice('[Judger submission] '.length));
			}
		});
		const userscript = template.script.includes('==UserScript==') ? parseUserScript(template.script) : undefined;
		logSubmission(userscript ? `Userscript: ${userscript.name}; run-at=${userscript.runAt}` : 'Plain submission script');
		const stateKey = `__judger_${crypto.randomBytes(16).toString('hex')}`;
		const isolated = userscript?.grants.some(grant => !['none', 'unsafeWindow'].includes(grant)) ?? false;
		let scriptContext: number | undefined;
		const pageChangedMessage = localize('judger.browserSubmit.pageChanged', 'The submission page changed. Fill the form again.');
		const executeConfirmedAction = async () => {
			await send('Runtime.evaluate', {
				expression: `(async () => { const action = window[${JSON.stringify(stateKey + '_submit')}]; if (typeof action !== 'function') { throw new Error(${JSON.stringify(pageChangedMessage)}); } delete window[${JSON.stringify(stateKey + '_submit')}]; await action(); })()`,
				awaitPromise: true, returnByValue: true,
				...(isolated ? { contextId: scriptContext } : {}),
			}, sid);
		};
		if (userscript) {
			// Chromium accepts registration while Page is disabled, but never runs it.
			await send('Page.enable', {}, sid);
			logSubmission('Page domain enabled for document-start injection');
			const bindingName = stateKey + '_request';
			const worldName = stateKey + '_world';
			const frames = isolated ? await send('Page.getFrameTree', {}, sid) : undefined;
			const mainFrame = frames?.frameTree?.frame.id;
			if (isolated && !mainFrame) { throw new Error('Could not identify submission page frame'); }
			const storageKey = 'userscript:' + crypto.createHash('sha256').update(userscript.namespace + ':' + userscript.name).digest('hex');
			const storage = isolated ? globalThis.extensionContext.globalState.get<Record<string, unknown>>(storageKey, {}) : {};
			bridgeListener = session.onDidReceiveMessage(raw => {
				const event = raw as CDPMessage;
				if (event.sessionId === sid && event.method === 'Runtime.executionContextsCleared') { scriptContext = undefined; }
				const context = event.params?.context;
				if (isolated && event.sessionId === sid && event.method === 'Runtime.executionContextCreated' && context?.name === worldName && context.auxData?.frameId === mainFrame) { scriptContext = context.id; }
				if (!isolated || event.params?.executionContextId !== scriptContext || event.method !== 'Runtime.bindingCalled' || event.sessionId !== sid || event.params?.name !== bindingName || !event.params.payload) { return; }
				const params = event.params;
				void (async () => {
					let request: ScriptRequest;
					try { request = JSON.parse(params.payload!) as ScriptRequest; } catch { return; }
					if (!Number.isSafeInteger(request.id) || !request.args) { return; }
					let value: unknown, error: string | undefined;
					try {
						const grants: Record<string, string[]> = { setValue: ['GM_setValue', 'GM.setValue'], deleteValue: ['GM_deleteValue', 'GM.deleteValue'], clipboard: ['GM_setClipboard', 'GM.setClipboard'], notification: ['GM_notification', 'GM.notification'], request: ['GM_xmlhttpRequest', 'GM.xmlHttpRequest'] };
						if (!grants[request.operation]?.some(grant => userscript.grants.includes(grant))) { throw new Error('Userscript operation requires @grant'); }
						if (request.operation === 'request') {
							const host = new URL(String(request.args.url)).hostname;
							if (host !== new URL(url).hostname && !userscript.connects.some(allowed => allowed === '*' || allowed === host)) { throw new Error('Cross-origin requests require an explicit @connect host'); }
						}
						value = await handleScriptRequest(request, storageKey, storage);
					} catch (failure) { error = String(failure); }
					await send('Runtime.evaluate', { expression: `window[${JSON.stringify(stateKey + '_reply')}]?.(${request.id}, ${JSON.stringify(error ?? null)}, ${JSON.stringify(value ?? null)})`, contextId: params.executionContextId }, sid);
				})().catch(error => globalThis.logger?.warn('Userscript context closed', String(error)));
			});
			await send('Runtime.enable', {}, sid);
			if (isolated) { await send('Runtime.addBinding', { name: bindingName, executionContextName: worldName }, sid); }
			const result = await send('Page.addScriptToEvaluateOnNewDocument', { source: userScriptBootstrap(userscript, values, stateKey, await loadScriptResources(userscript), { name: bindingName, storage }), ...(isolated ? { worldName } : {}) }, sid);
			logSubmission(`Userscript registered before navigation; isolated=${isolated}; identifier=${result.identifier ?? 'missing'}`);
			if (result.identifier) { injected = { identifier: result.identifier, sid }; }
		}
		logSubmission('Navigating submission page');
		const navigation = await send('Page.navigate', { url }, sid);
		if (navigation.errorText) { throw new Error(navigation.errorText); }
		// Userscript bootstrap owns @run-at; polling must not wait for window.load.
		if (!userscript) {
			const deadline = Date.now() + 30000;
			let loaded = false;
			while (Date.now() < deadline) {
				try {
					const ready = await send('Runtime.evaluate', {
						expression: template.script === vjudgeSubmitScript
							? 'location.href !== "about:blank" && !!document.getElementById("btn-submit") && !document.getElementById("btn-submit").disabled'
							: 'location.href !== "about:blank" && document.readyState !== "loading"', returnByValue: true
					}, sid);
					if (ready.result?.value === true) { loaded = true; break; }
				} catch (error) {
					if (!(error instanceof Error) || !/context|navigat/i.test(error.message)) { throw error; }
				}
				await new Promise(resolve => setTimeout(resolve, 100));
			}
			if (!loaded) { throw new Error(localize('judger.browserSubmit.loadTimeout', 'Timed out waiting for the submission page to load.')); }
		}
		if (userscript) {
			let deadline = Date.now() + 30000;
			let started = false;
			let finished = false;
			let lastState: string | undefined;
			while (Date.now() < deadline) {
				if (isolated && scriptContext === undefined) { await new Promise(resolve => setTimeout(resolve, 100)); continue; }
				let status: CDPResult;
				try {
					status = await send('Runtime.evaluate', { expression: `window[${JSON.stringify(stateKey)}]`, returnByValue: true, ...(isolated ? { contextId: scriptContext } : {}) }, sid);
				} catch (error) {
					if (!(error instanceof Error) || !/execution context was destroyed|cannot find context|cannot find.*context.*id/i.test(error.message)) { throw error; }
					await new Promise(resolve => setTimeout(resolve, 100));
					continue;
				}
				const value = status.result?.value as { state?: string; message?: string; canSubmit?: boolean } | undefined;
				const currentState = value?.state ?? 'not injected or URL did not match';
				if (currentState !== lastState) {
					logSubmission(`Userscript state: ${currentState}${value?.message ? '; ' + value.message : ''}`);
					lastState = currentState;
				}
				// Give execution its own budget after the declared run-at event.
				if (value?.state === 'running' && !started) { started = true; deadline = Date.now() + 30000; }
				if (value?.state === 'error') { throw new Error(value.message); }
				if (value?.state === 'done') {
					if (value.canSubmit) {
						if (await confirmSubmission()) {
							await executeConfirmedAction();
						}
					}
					finished = true;
					break;
				}
				await new Promise(resolve => setTimeout(resolve, 100));
			}
			if (!finished) { logSubmission(`Userscript timed out; last state: ${lastState ?? 'no execution context'}`); throw new Error(localize('judger.browserSubmit.timeout', 'Browser script execution timed out.')); }
		} else {
			const legacyConfirmation = template.script === vjudgeSubmitScript && values.confirmBeforeSubmit === 'true';
			const unavailableMessage = localize('judger.browserSubmit.submitUnavailable', 'VJudge submit button is unavailable.');
			const finalAction = legacyConfirmation
				? `window[${JSON.stringify(stateKey + '_submit')}] = async () => { const deadline = Date.now() + 25000; while (Date.now() < deadline) { const button = document.querySelector('#submitModal #btn-submit'); if (button && !button.disabled) { button.click(); return; } await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(${JSON.stringify(unavailableMessage)}); };`
				: '';
			await send('Runtime.evaluate', { expression: `(async () => {\n${replaceSubmissionPlaceholders(template.script, values, true)}\n${finalAction}\n})()`, awaitPromise: true, returnByValue: true }, sid);
			if (legacyConfirmation && await confirmSubmission()) { await executeConfirmedAction(); }

		}
		logSubmission('Script completed');
	} finally {
		consoleListener?.dispose();
		bridgeListener?.dispose();
		if (injected && !sessionClosed) { try { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier }, injected.sid); } catch { /* the tab may be gone */ } }
		closed.dispose();
		for (const request of [...pending.values()]) { request.reject(new Error('Session closed')); }
		await session.close();
	}
}

export function getBrowserSubmission(url: string) {
	const legacy = resolveSubmission(url, getOjMapping() || {}, getVjudgeOjNames() || {}, getCustomSubmitScripts());
	return legacy?.kind === 'custom' ? legacy : resolveUserSubmission(url) ?? legacy;
}

let submitting = false;
export async function fillBrowserSubmission(problem: Problem): Promise<void> {
	logSubmission(`Fill requested for ${submissionPage(problem.url)}`);
	if (submitting) { logSubmission('Ignored: another submission is still running'); return; }
	submitting = true;
	try {
		const resolved = getBrowserSubmission(problem.url);
		logSubmission(resolved ? `Resolved ${resolved.kind} route: ${submissionPage(submissionUrl(resolved.template.urlTemplate, resolved.values))}` : 'No submission route resolved');
		if (!resolved) { throw new Error(localize('judger.browserSubmit.noMapping', 'No submission script or VJudge mapping is configured for this OJ.')); }
		const document = await vscode.workspace.openTextDocument(problem.srcPath);
		await executeSubmissionScript(resolved.template, { ...resolved.values, code: vscode.workspace.getConfiguration('judger.submission', document.uri).get('expandLocalHeaders', false) && /\.(cpp|cc|cxx)$/i.test(document.fileName) ? expandLocalHeaders(document.fileName, document.getText()) : document.getText(), language: document.languageId, fileName: path.basename(document.fileName), confirmBeforeSubmit: 'true' });
	} catch (error) {
		logSubmission(`Failed: ${error instanceof Error ? error.message : String(error)}`);
		void vscode.window.showErrorMessage(localize('judger.browserSubmit.failed', 'Could not fill the submission form: {0}', error instanceof Error ? error.message : String(error)));
	} finally { submitting = false; }
}

export function registerBrowserSubmission(context: vscode.ExtensionContext): void {
	submissionOutput = vscode.window.createOutputChannel('Judger Submission');
	context.subscriptions.push(submissionOutput);
	logSubmission('Submission logging ready');
	registerUserScriptCommands(context);
	context.subscriptions.push(vscode.commands.registerCommand('judger.runSubmitScript', executeSubmissionScript));
	context.subscriptions.push(vscode.commands.registerCommand('judger.getSubmitScriptAliases', () => submissionAliases(getOjMapping() || {}, getVjudgeOjNames() || {})));
	context.subscriptions.push(vscode.commands.registerCommand('judger.getSubmitScriptDefaults', () => ({
		'*': { urlTemplate: '{vjudgeUrl}', script: vjudgeSubmitScript },
		...defaultSubmissionTemplates(getVjudgeOjNames() || {}),
	})));
}

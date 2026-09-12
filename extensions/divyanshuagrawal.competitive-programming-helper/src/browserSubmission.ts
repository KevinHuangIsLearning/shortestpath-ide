/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import { getCustomSubmitScripts, getOjMapping, getVjudgeOjNames } from './preferences';
import { defaultSubmissionTemplates, replaceSubmissionPlaceholders, resolveSubmission, submissionAliases, submissionUrl, SubmissionTemplate, SubmissionValues, vjudgeSubmitScript } from './submissionTemplates';
import { Problem } from './types';
import localize from './i18n';

type CDPResult = { targetInfos?: { targetId: string; type: string }[]; sessionId?: string; result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } }; errorText?: string };
type CDPMessage = { id?: number; sessionId?: string; result?: CDPResult; error?: { message: string } };

export async function executeSubmissionScript(template: SubmissionTemplate, values: SubmissionValues): Promise<void> {
	if (!vscode.workspace.isTrusted) { throw new Error(localize('cph.browserSubmit.trust', 'Trust this workspace before running submission scripts.')); }
	if (!template || typeof template.urlTemplate !== 'string' || typeof template.script !== 'string' || !values || Object.values(values).some(value => typeof value !== 'string')) {
		throw new Error(localize('cph.browserSubmit.invalid', 'Invalid submission script configuration.'));
	}
	const url = submissionUrl(template.urlTemplate, values);
	if (!vscode.window.openBrowserTab) { throw new Error(localize('cph.browserSubmit.unavailable', 'The integrated browser API is unavailable.')); }
	// Attach before navigating so script execution cannot race the initial page load.
	const tab = await vscode.window.openBrowserTab('about:blank', { modal: true, preserveFocus: false });
	const session = await tab.startCDPSession();
	let nextId = 0;
	let sessionClosed = false;
	const pending = new Map<number, { reject: (reason: Error) => void }>();
	const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<CDPResult> => new Promise((resolve, reject) => {
		if (sessionClosed) { reject(new Error(localize('cph.browserSubmit.closed', 'The browser was closed.'))); return; }
		const id = ++nextId;
		const finish = (error?: Error, result: CDPResult = {}) => { clearTimeout(timer); listener.dispose(); pending.delete(id); if (error) { reject(error); } else { resolve(result); } };
		const listener = session.onDidReceiveMessage(raw => {
			const message = raw as CDPMessage;
			if (message.id !== id || message.sessionId !== sessionId) { return; }
			const exception = message.result?.exceptionDetails;
			finish(message.error || exception ? new Error(message.error?.message || exception?.exception?.description || exception?.text) : undefined, message.result);
		});
		const timer = setTimeout(() => finish(new Error(localize('cph.browserSubmit.timeout', 'Browser script execution timed out.'))), 30000);
		pending.set(id, { reject: error => finish(error) });
		void Promise.resolve(session.sendMessage({ id, method, params, ...(sessionId ? { sessionId } : {}) })).catch(error => finish(error instanceof Error ? error : new Error(String(error))));
	});
	const closed = session.onDidClose(() => { sessionClosed = true; for (const request of [...pending.values()]) { request.reject(new Error(localize('cph.browserSubmit.closed', 'The browser was closed.'))); } });
	try {
		const targets = await send('Target.getTargets');
		const target = targets.targetInfos?.find(info => info.type === 'page');
		if (!target) { throw new Error(localize('cph.browserSubmit.noPage', 'No browser page was found.')); }
		const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
		if (!attached.sessionId) { throw new Error(localize('cph.browserSubmit.noPage', 'No browser page was found.')); }
		const sid = attached.sessionId;
		const navigation = await send('Page.navigate', { url }, sid);
		if (navigation.errorText) { throw new Error(navigation.errorText); }
		const deadline = Date.now() + 30000;
		let loaded = false;
		while (Date.now() < deadline) {
			try {
				const ready = await send('Runtime.evaluate', { expression: 'location.href !== "about:blank" && document.readyState === "complete"', returnByValue: true }, sid);
				if (ready.result?.value === true) { loaded = true; break; }
			} catch (error) {
				if (!(error instanceof Error) || !/context|navigat/i.test(error.message)) { throw error; }
			}
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		if (!loaded) { throw new Error(localize('cph.browserSubmit.loadTimeout', 'Timed out waiting for the submission page to load.')); }
		await send('Runtime.evaluate', { expression: `(async () => {\n${replaceSubmissionPlaceholders(template.script, values, true)}\n})()`, awaitPromise: true, returnByValue: true }, sid);
	} finally {
		closed.dispose();
		for (const request of [...pending.values()]) { request.reject(new Error('Session closed')); }
		await session.close();
	}
}

export function getBrowserSubmission(url: string) {
	return resolveSubmission(url, getOjMapping() || {}, getVjudgeOjNames() || {}, getCustomSubmitScripts());
}

let submitting = false;
export async function fillBrowserSubmission(problem: Problem): Promise<void> {
	if (submitting) { return; }
	submitting = true;
	try {
		const resolved = getBrowserSubmission(problem.url);
		if (!resolved) { throw new Error(localize('cph.browserSubmit.noMapping', 'No submission script or VJudge mapping is configured for this OJ.')); }
		const document = await vscode.workspace.openTextDocument(problem.srcPath);
		await executeSubmissionScript(resolved.template, { ...resolved.values, code: document.getText(), language: document.languageId, fileName: path.basename(document.fileName) });
	} catch (error) {
		void vscode.window.showErrorMessage(localize('cph.browserSubmit.failed', 'Could not fill the submission form: {0}', error instanceof Error ? error.message : String(error)));
	} finally { submitting = false; }
}

export function registerBrowserSubmission(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.commands.registerCommand('cph.runSubmitScript', executeSubmissionScript));
	context.subscriptions.push(vscode.commands.registerCommand('cph.getSubmitScriptAliases', () => submissionAliases(getOjMapping() || {}, getVjudgeOjNames() || {})));
	context.subscriptions.push(vscode.commands.registerCommand('cph.getSubmitScriptDefaults', () => ({
		'*': { urlTemplate: '{vjudgeUrl}', script: vjudgeSubmitScript },
		...defaultSubmissionTemplates(getVjudgeOjNames() || {}),
	})));
}

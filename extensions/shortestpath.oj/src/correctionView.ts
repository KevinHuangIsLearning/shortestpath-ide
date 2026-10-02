/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { localize } from './localization';
import type { BridgeCorrectionSnapshot } from './generated/ide-bridge-contract';

export class CorrectionView implements vscode.Disposable {
	private panel: vscode.WebviewPanel | undefined;
	private task: BridgeCorrectionSnapshot | undefined;

	show(task: BridgeCorrectionSnapshot): void {
		this.task = task;
		if (!this.panel) {
			this.panel = vscode.window.createWebviewPanel('shortestpath.correction', localize('AI 订正'), vscode.ViewColumn.Beside, { enableScripts: true });
			this.panel.onDidDispose(() => { this.panel = undefined; });
			this.panel.webview.onDidReceiveMessage(async message => {
				if (message?.command !== 'openCandidate') { return; }
				const code = this.task?.latest_attempt?.corrected_code;
				if (code) { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'cpp', content: code })); }
			});
		}
		const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[char]!));
		const attempt = task.latest_attempt;
		const diagnosis = attempt?.protocol?.diagnosis;
		const nonce = randomBytes(16).toString('base64');
		this.panel.webview.html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:var(--vscode-font-family);color:var(--vscode-editor-foreground);padding:1rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:.5rem}</style></head><body><h1>${localize('AI 订正')}</h1><p>${escape(task.status)} · ${escape(task.stage)} · ${task.current_round}/${task.max_rounds}</p><p>${task.cost_amount} ${escape(task.cost_currency)} / ${localize('退款')} ${task.refund_amount}</p><p>${escape(task.error_message ?? '')}</p><section data-i18n-ignore><h2>${localize('诊断')}</h2><p>${escape(diagnosis?.summary ?? '')}</p><ul>${(diagnosis?.issue ?? []).map(issue => `<li>${escape(issue)}</li>`).join('')}</ul><p>${escape(attempt?.verification_verdict ?? '')}</p><pre>${escape(attempt?.unified_diff ?? '')}</pre></section>${attempt?.corrected_code ? `<button id="candidate">${localize('另存订正源码')}</button><pre data-i18n-ignore>${escape(attempt.corrected_code)}</pre>` : ''}<script nonce="${nonce}">const vscode=acquireVsCodeApi();document.getElementById('candidate')?.addEventListener('click',()=>vscode.postMessage({command:'openCandidate'}));</script></body></html>`;
	}

	dispose(): void { this.panel?.dispose(); this.panel = undefined; }
}

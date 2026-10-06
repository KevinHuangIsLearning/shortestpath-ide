/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { localize, localizeWebviewHtml } from './localization';
type SubmitScript = { urlTemplate: string; script: string };
const setting = 'customSubmitScripts';
export function registerBrowserScriptTester(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.openCustomSubmitScripts', openPage));
}
async function openPage(): Promise<void> {
	let defaults: Record<string, SubmitScript>;
	try { defaults = await vscode.commands.executeCommand<Record<string, SubmitScript>>('judger.getSubmitScriptDefaults') || {}; }
	catch { void vscode.window.showErrorMessage(localize('\u8bf7\u5148\u542f\u7528 ShortestPath Judger \u63d2\u4ef6\u3002')); return; }
	const config = () => vscode.workspace.getConfiguration('judger.general');
	const configured = config().get<Record<string, SubmitScript>>(setting) ?? {};
	const aliases = await vscode.commands.executeCommand<Record<string, string>>('judger.getSubmitScriptAliases') || {};
	const canonical = (name: string) => aliases[name.toLowerCase()] || name;
	const names = new Set(['*', ...Object.keys(configured), ...Object.keys(defaults), ...Object.values(aliases)].map(canonical));
	const canonicalDefaults: Record<string, SubmitScript> = Object.create(null);
	const canonicalConfigured: Record<string, SubmitScript> = Object.create(null);
	// Prefer the long VJudge name over its short alias for the built-in URL.
	for (const key of Object.keys(defaults).sort((a, b) => a.length - b.length || a.localeCompare(b))) { canonicalDefaults[canonical(key)] = defaults[key]; }
	for (const key of Object.keys(configured).sort((a, b) => Number(a === canonical(a)) - Number(b === canonical(b)) || b.localeCompare(a))) { canonicalConfigured[canonical(key)] = configured[key]; }
	const panel = vscode.window.createWebviewPanel('shortestpath.customSubmitScripts', localize('Judger \u81ea\u5b9a\u4e49\u63d0\u4ea4\u811a\u672c'), vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, modal: true });
	panel.webview.html = localizeWebviewHtml(html(canonicalConfigured, canonicalDefaults, [...names].sort(), aliases));
	let busy = false;
	const messages = panel.webview.onDidReceiveMessage(async message => {
		if (!['save', 'test', 'reset'].includes(message?.type) || busy) { return; }
		busy = true;
		try {
			const oj = typeof message.oj === 'string' ? canonical(message.oj.trim()) : '';
			if (!oj || ['__proto__', 'constructor', 'prototype'].includes(oj)) { throw new Error(localize('\u8bf7\u8f93\u5165\u6709\u6548\u7684 OJ \u540d\u79f0\u3002')); }
			const template: SubmitScript = { urlTemplate: String(message.url ?? '').trim(), script: String(message.script ?? '') };
			if (message.type !== 'reset') {
				const preview = template.urlTemplate.replace(/\{(?:oj|ojName|contestId|problemId|code|language|fileName)\}/g, 'test').replace(/\{(?:url|vjudgeUrl)\}/g, 'https://vjudge.net/');
				if (!['http:', 'https:'].includes(new URL(preview).protocol) || /\{\w+\}/.test(preview)) { throw new Error(localize('URL \u5fc5\u987b\u4f7f\u7528 HTTP \u6216 HTTPS\uff0c\u5e76\u4f7f\u7528\u652f\u6301\u7684\u5360\u4f4d\u7b26\u3002')); }
			}
			if (message.type === 'test') {
				await vscode.commands.executeCommand('judger.runSubmitScript', template, { oj, ojName: oj, contestId: String(message.contestId ?? ''), problemId: String(message.problemId ?? ''), code: String(message.code ?? ''), url: String(message.originalUrl ?? ''), vjudgeUrl: String(message.vjudgeUrl ?? ''), language: 'cpp', fileName: 'main.cpp' });
				await panel.webview.postMessage({ type: 'status', value: localize('\u5df2\u6253\u5f00\u9875\u9762\u5e76\u6267\u884c\u811a\u672c\u3002') });
			} else {
				const scripts = { ...(config().get<Record<string, SubmitScript>>(setting) ?? {}) };
				for (const key of Object.keys(scripts)) { if (canonical(key) === oj) { delete scripts[key]; } }
				if (message.type !== 'reset') { scripts[oj] = template; }
				await config().update(setting, scripts, vscode.ConfigurationTarget.Global);
				await panel.webview.postMessage({ type: 'saved', oj, template: message.type === 'reset' ? null : template, value: localize('\u5df2\u4fdd\u5b58\u3002') });
			}
		} catch (error) { await panel.webview.postMessage({ type: 'error', value: error instanceof Error ? error.message : String(error) }); }
		finally { busy = false; await panel.webview.postMessage({ type: 'idle' }); }
	});
	const disposed = panel.onDidDispose(() => { messages.dispose(); disposed.dispose(); });
}
function html(configured: Record<string, SubmitScript>, defaults: Record<string, SubmitScript>, ojs: string[], aliases: Record<string, string>): string {
	const json = (value: object) => JSON.stringify(value).replace(/</g, '\\u003c');
	return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';script-src 'unsafe-inline'"><style>body{margin:0;background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family)}main{max-width:900px;margin:auto;padding:32px 28px}.row{display:grid;grid-template-columns:150px 1fr;gap:14px;margin:14px 0}input,select,textarea{box-sizing:border-box;width:100%;padding:8px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);font:inherit}textarea{min-height:180px}button{padding:8px 14px;border:0;margin-right:8px;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}.hint{font-size:12px;color:var(--vscode-descriptionForeground)}#status{color:var(--vscode-testing-iconPassed)}#error{color:var(--vscode-errorForeground);white-space:pre-wrap}</style></head><body><main><h1>Judger \u81ea\u5b9a\u4e49\u63d0\u4ea4\u811a\u672c</h1><p class="hint">\u6309 OJ \u4fdd\u5b58\uff1b\u70b9\u51fb Judger \u7684\u586b\u5199\u63d0\u4ea4\u8868\u5355\u6309\u94ae\u65f6\u6267\u884c\u3002\u9ed8\u8ba4 VJudge \u811a\u672c\u53ea\u586b\u5199\u8868\u5355\uff0c\u6700\u7ec8\u63d0\u4ea4\u7531\u4f60\u786e\u8ba4\u3002</p><p class="hint">URL \u652f\u6301 {oj}\u3001{ojName}\u3001{contestId}\u3001{problemId}\u3001{url}\u3001{vjudgeUrl}\u3002JavaScript \u8fd8\u652f\u6301 {code}\u3001{language}\u3001{fileName}\uff1b\u5360\u4f4d\u7b26\u66ff\u6362\u4e3a\u5b57\u7b26\u4e32\u5b57\u9762\u91cf\uff0c\u4e0d\u8981\u989d\u5916\u52a0\u5f15\u53f7\uff0c\u4f8b\u5982 editor.setValue({code})\u3002</p><div class="row"><label for="oj">OJ</label><select id="oj"></select></div><div class="row"><label for="url">\u63d0\u4ea4\u9875\u9762 URL \u6a21\u677f</label><input id="url"></div><div class="row"><label for="script">\u63d0\u4ea4 JavaScript</label><textarea id="script" data-i18n-ignore></textarea></div><details><summary>\u6d4b\u8bd5\u53c2\u6570</summary><div class="row"><label for="contestId">\u6bd4\u8d5b ID</label><input id="contestId"></div><div class="row"><label for="problemId">\u9898\u76ee ID</label><input id="problemId"></div><div class="row"><label for="originalUrl">\u6d4b\u8bd5\u9898\u76ee URL</label><input id="originalUrl"></div><div class="row"><label for="vjudgeUrl">\u6d4b\u8bd5 VJudge URL</label><input id="vjudgeUrl"></div><div class="row"><label for="code">\u6d4b\u8bd5\u4ee3\u7801</label><textarea id="code" data-i18n-ignore>int main() { return 0; }</textarea></div></details><button id="save">\u4fdd\u5b58\u6b64 OJ</button><button id="reset">\u6062\u590d\u9ed8\u8ba4\u811a\u672c</button><button id="test">\u6253\u5f00\u5e76\u6267\u884c</button><span id="status" role="status"></span><div id="error" role="alert"></div></main><script>
const vscode=acquireVsCodeApi(), byId=id=>document.getElementById(id), configured=${json(configured)}, defaults=${json(defaults)}, ojs=${json(ojs)}, aliases=${json(aliases)};
ojs.sort((a,b)=>Number(b==='*')-Number(a==='*')||a.localeCompare(b)).forEach(oj=>{const option=document.createElement('option');option.value=oj;option.textContent=oj==='*'?'\u9ed8\u8ba4\uff08\u6240\u6709 VJudge \u6620\u5c04 OJ\uff09':oj;byId('oj').append(option)});
byId('oj').value=ojs[0]||'';
function load(){const name=byId('oj').value.trim(),oj=aliases[name.toLowerCase()]||name;byId('oj').value=oj;const value=configured[oj]||defaults[oj];byId('url').value=value?.urlTemplate||'';byId('script').value=value?.script||''}
byId('oj').onchange=load;
function setBusy(value){document.querySelectorAll('button,input,textarea').forEach(node=>node.disabled=value)}
function send(type){byId('error').textContent='';byId('status').textContent='\u6b63\u5728\u5904\u7406\u2026';setBusy(true);vscode.postMessage({type,oj:byId('oj').value,url:byId('url').value,script:byId('script').value,contestId:byId('contestId').value,problemId:byId('problemId').value,originalUrl:byId('originalUrl').value,vjudgeUrl:byId('vjudgeUrl').value,code:byId('code').value})}
['save','reset','test'].forEach(type=>byId(type).onclick=()=>send(type));
window.addEventListener('message',e=>{const data=e.data;if(data?.type==='saved'){if(data.template)configured[data.oj]=data.template;else delete configured[data.oj];load();byId('status').textContent=data.value}if(data?.type==='status')byId('status').textContent=data.value;if(data?.type==='error'){byId('status').textContent='';byId('error').textContent=data.value}if(data?.type==='idle')setBusy(false)});load();
</script></body></html>`;
}

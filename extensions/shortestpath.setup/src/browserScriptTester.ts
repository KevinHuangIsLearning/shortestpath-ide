/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
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
	try { defaults = await vscode.commands.executeCommand<Record<string, SubmitScript>>('cph.getSubmitScriptDefaults') || {}; }
	catch { void vscode.window.showErrorMessage(localize('请先启用 CPH Plus 插件。')); return; }
	const config = () => vscode.workspace.getConfiguration('cph.general');
	const configured = config().get<Record<string, SubmitScript>>(setting) ?? {};
	const aliases = await vscode.commands.executeCommand<Record<string, string>>('cph.getSubmitScriptAliases') || {};
	const canonical = (name: string) => aliases[name.toLowerCase()] || name;
	const names = new Set(['*', ...Object.keys(configured), ...Object.keys(defaults), ...Object.values(aliases)].map(canonical));
	const canonicalDefaults: Record<string, SubmitScript> = Object.create(null);
	const canonicalConfigured: Record<string, SubmitScript> = Object.create(null);
	// Prefer the long VJudge name over its short alias for the built-in URL.
	for (const key of Object.keys(defaults).sort((a, b) => a.length - b.length || a.localeCompare(b))) { canonicalDefaults[canonical(key)] = defaults[key]; }
	for (const key of Object.keys(configured).sort((a, b) => Number(a === canonical(a)) - Number(b === canonical(b)) || b.localeCompare(a))) { canonicalConfigured[canonical(key)] = configured[key]; }
	const panel = vscode.window.createWebviewPanel('shortestpath.customSubmitScripts', localize('CPH 自定义提交脚本'), vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, modal: true });
	panel.webview.html = localizeWebviewHtml(html(canonicalConfigured, canonicalDefaults, [...names].sort(), aliases));
	let busy = false;
	const messages = panel.webview.onDidReceiveMessage(async message => {
		if (!['save', 'test', 'reset'].includes(message?.type) || busy) { return; }
		busy = true;
		try {
			const oj = typeof message.oj === 'string' ? canonical(message.oj.trim()) : '';
			if (!oj || ['__proto__', 'constructor', 'prototype'].includes(oj)) { throw new Error(localize('请输入有效的 OJ 名称。')); }
			const template: SubmitScript = { urlTemplate: String(message.url ?? '').trim(), script: String(message.script ?? '') };
			if (message.type !== 'reset') {
				const preview = template.urlTemplate.replace(/\{(?:oj|ojName|contestId|problemId|code|language|fileName)\}/g, 'test').replace(/\{(?:url|vjudgeUrl)\}/g, 'https://vjudge.net/');
				if (!['http:', 'https:'].includes(new URL(preview).protocol) || /\{\w+\}/.test(preview)) { throw new Error(localize('URL 必须使用 HTTP 或 HTTPS，并使用支持的占位符。')); }
			}
			if (message.type === 'test') {
				await vscode.commands.executeCommand('cph.runSubmitScript', template, { oj, ojName: oj, contestId: String(message.contestId ?? ''), problemId: String(message.problemId ?? ''), code: String(message.code ?? ''), url: String(message.originalUrl ?? ''), vjudgeUrl: String(message.vjudgeUrl ?? ''), language: 'cpp', fileName: 'main.cpp' });
				await panel.webview.postMessage({ type: 'status', value: localize('已打开页面并执行脚本。') });
			} else {
				const scripts = { ...(config().get<Record<string, SubmitScript>>(setting) ?? {}) };
				for (const key of Object.keys(scripts)) { if (canonical(key) === oj) { delete scripts[key]; } }
				if (message.type !== 'reset') { scripts[oj] = template; }
				await config().update(setting, scripts, vscode.ConfigurationTarget.Global);
				await panel.webview.postMessage({ type: 'saved', oj, template: message.type === 'reset' ? null : template, value: localize('已保存。') });
			}
		} catch (error) { await panel.webview.postMessage({ type: 'error', value: error instanceof Error ? error.message : String(error) }); }
		finally { busy = false; await panel.webview.postMessage({ type: 'idle' }); }
	});
	const disposed = panel.onDidDispose(() => { messages.dispose(); disposed.dispose(); });
}
function html(configured: Record<string, SubmitScript>, defaults: Record<string, SubmitScript>, ojs: string[], aliases: Record<string, string>): string {
	const json = (value: object) => JSON.stringify(value).replace(/</g, '\\u003c');
	return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';script-src 'unsafe-inline'"><style>body{margin:0;background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family)}main{max-width:900px;margin:auto;padding:32px 28px}.row{display:grid;grid-template-columns:150px 1fr;gap:14px;margin:14px 0}input,select,textarea{box-sizing:border-box;width:100%;padding:8px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);font:inherit}textarea{min-height:180px}button{padding:8px 14px;border:0;margin-right:8px;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}.hint{font-size:12px;color:var(--vscode-descriptionForeground)}#status{color:var(--vscode-testing-iconPassed)}#error{color:var(--vscode-errorForeground);white-space:pre-wrap}</style></head><body><main><h1>CPH 自定义提交脚本</h1><p class="hint">按 OJ 保存；点击 CPH 的填写提交表单按钮时执行。默认 VJudge 脚本只填写表单，最终提交由你确认。</p><p class="hint">URL 支持 {oj}、{ojName}、{contestId}、{problemId}、{url}、{vjudgeUrl}。JavaScript 还支持 {code}、{language}、{fileName}；占位符替换为字符串字面量，不要额外加引号，例如 editor.setValue({code})。</p><div class="row"><label for="oj">OJ</label><select id="oj"></select></div><div class="row"><label for="url">提交页面 URL 模板</label><input id="url"></div><div class="row"><label for="script">提交 JavaScript</label><textarea id="script" data-i18n-ignore></textarea></div><details><summary>测试参数</summary><div class="row"><label for="contestId">比赛 ID</label><input id="contestId"></div><div class="row"><label for="problemId">题目 ID</label><input id="problemId"></div><div class="row"><label for="originalUrl">测试题目 URL</label><input id="originalUrl"></div><div class="row"><label for="vjudgeUrl">测试 VJudge URL</label><input id="vjudgeUrl"></div><div class="row"><label for="code">测试代码</label><textarea id="code" data-i18n-ignore>int main() { return 0; }</textarea></div></details><button id="save">保存此 OJ</button><button id="reset">恢复默认脚本</button><button id="test">打开并执行</button><span id="status" role="status"></span><div id="error" role="alert"></div></main><script>
const vscode=acquireVsCodeApi(), byId=id=>document.getElementById(id), configured=${json(configured)}, defaults=${json(defaults)}, ojs=${json(ojs)}, aliases=${json(aliases)};
ojs.sort((a,b)=>Number(b==='*')-Number(a==='*')||a.localeCompare(b)).forEach(oj=>{const option=document.createElement('option');option.value=oj;option.textContent=oj==='*'?'默认（所有 VJudge 映射 OJ）':oj;byId('oj').append(option)});
byId('oj').value=ojs[0]||'';
function load(){const name=byId('oj').value.trim(),oj=aliases[name.toLowerCase()]||name;byId('oj').value=oj;const value=configured[oj]||defaults[oj];byId('url').value=value?.urlTemplate||'';byId('script').value=value?.script||''}
byId('oj').onchange=load;
function setBusy(value){document.querySelectorAll('button,input,textarea').forEach(node=>node.disabled=value)}
function send(type){byId('error').textContent='';byId('status').textContent='正在处理…';setBusy(true);vscode.postMessage({type,oj:byId('oj').value,url:byId('url').value,script:byId('script').value,contestId:byId('contestId').value,problemId:byId('problemId').value,originalUrl:byId('originalUrl').value,vjudgeUrl:byId('vjudgeUrl').value,code:byId('code').value})}
['save','reset','test'].forEach(type=>byId(type).onclick=()=>send(type));
window.addEventListener('message',e=>{const data=e.data;if(data?.type==='saved'){if(data.template)configured[data.oj]=data.template;else delete configured[data.oj];load();byId('status').textContent=data.value}if(data?.type==='status')byId('status').textContent=data.value;if(data?.type==='error'){byId('status').textContent='';byId('error').textContent=data.value}if(data?.type==='idle')setBusy(false)});load();
</script></body></html>`;
}

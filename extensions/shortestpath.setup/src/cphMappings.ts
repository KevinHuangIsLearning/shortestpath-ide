import * as vscode from 'vscode';

type Field = { key: string; label: string; hint?: string };
type Mapping = Record<string, Record<string, string>>;

const ojFields: Field[] = [
	{ key: 'host', label: '域名（键）' }, { key: 'oj', label: 'OJ 代号' }, { key: 'ojName', label: 'OJ 名称' },
	{ key: 'contestIdRegex', label: '比赛 ID 正则' }, { key: 'problemIdRegex', label: '题目 ID 正则' }
];
const vjudgeFields: Field[] = [
	{ key: 'name', label: 'VJudge OJ 名称（键）' }, { key: 'urlTemplate', label: '原题 URL 模板', hint: '可用 {contestId}、{problemId}' },
	{ key: 'problemIdRegex', label: '题号正则' }, { key: 'compositeFormat', label: '组合题号格式' }, { key: 'vjudgeUrlKey', label: 'VJudge URL 名称覆盖' }
];

export function openOjMappings(): void { open('在线评测映射', 'ojMapping', ojFields); }
export function openVjudgeMappings(): void { open('VJudge 映射', 'vjudgeOjNames', vjudgeFields); }

function open(title: string, setting: 'ojMapping' | 'vjudgeOjNames', fields: readonly Field[]): void {
	const current = vscode.workspace.getConfiguration('cph.general').get<Record<string, unknown>>(setting) ?? {};
	const entries = Object.entries(current).map(([name, value]) => ({ [fields[0].key]: name, ...(objectStrings(value)) }));
	const panel = vscode.window.createWebviewPanel(`shortestpath.${setting}`, title, vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
	panel.webview.html = html(title, fields, entries);
	panel.webview.onDidReceiveMessage(async message => {
		if (message?.type !== 'save' || !Array.isArray(message.entries)) { return; }
		try {
			const result: Mapping = {};
			for (const input of message.entries as Record<string, unknown>[]) {
				const name = string(input[fields[0].key]);
				if (!name) { throw new Error(`“${fields[0].label}”不能为空。`); }
				if (result[name]) { throw new Error(`“${name}”重复。`); }
				const item: Record<string, string> = {};
				for (const field of fields.slice(1)) { const value = string(input[field.key]); if (value) { item[field.key] = value; } }
				result[name] = item;
			}
			await vscode.workspace.getConfiguration('cph.general').update(setting, result, vscode.ConfigurationTarget.Global);
			await panel.webview.postMessage({ type: 'saved' });
		} catch (error) { await panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
	});
}

function objectStrings(value: unknown): Record<string, string> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) { return {}; }
	return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => typeof item === 'string' ? [[key, item]] : []));
}
function string(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

function html(title: string, fields: readonly Field[], entries: readonly Record<string, string>[]): string {
	const initial = JSON.stringify(entries).replace(/</g, '\\u003c');
	const fieldData = JSON.stringify(fields).replace(/</g, '\\u003c');
	return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';"><style>body{background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family)}main{max-width:1050px;margin:auto;padding:34px 28px}.entry{border:1px solid var(--vscode-editorWidget-border);border-radius:6px;padding:12px;margin:12px 0}.row{display:grid;grid-template-columns:210px 1fr;gap:12px;align-items:center;padding:6px 0}.hint{font-size:12px;color:var(--vscode-descriptionForeground)}input{width:100%;box-sizing:border-box;padding:7px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border)}button{padding:7px 12px;border:0;margin-right:8px;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}.danger{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}#error{color:var(--vscode-errorForeground)}@media(max-width:650px){.row{grid-template-columns:1fr}}</style></head><body><main><h1>${title}</h1><p>以条目方式配置；留空的可选字段不会写入。正则请使用捕获组表示比赛和题目 ID。</p><div id="entries"></div><button id="add">新增映射</button><button id="save">保存</button><span id="status"></span><p id="error"></p></main><script>const vscode=acquireVsCodeApi(),fields=${fieldData},entries=${initial},root=document.getElementById('entries'),esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');function render(){root.innerHTML='';entries.forEach((entry,index)=>{const card=document.createElement('div');card.className='entry';card.innerHTML=fields.map((field,i)=>'<div class="row"><div><b>'+esc(field.label)+'</b>'+(field.hint?'<div class="hint">'+esc(field.hint)+'</div>':'')+'</div><input data-key="'+esc(field.key)+'" value="'+esc(entry[field.key])+'"></div>').join('')+'<button class="danger">删除此映射</button>';card.querySelectorAll('input').forEach(input=>input.oninput=()=>entry[input.dataset.key]=input.value);card.querySelector('button').onclick=()=>{entries.splice(index,1);render()};root.append(card)})}document.getElementById('add').onclick=()=>{entries.push({});render()};document.getElementById('save').onclick=()=>vscode.postMessage({type:'save',entries});window.onmessage=e=>{if(e.data?.type==='saved'){document.getElementById('status').textContent='已保存';document.getElementById('error').textContent=''}if(e.data?.type==='error')document.getElementById('error').textContent=e.data.message};render();</script></body></html>`;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { openOjMappings, openVjudgeMappings } from './cphMappings';
import { localize, localizeWebviewHtml } from './localization';

type State = Record<string, string | number | boolean | string[]> & { availableOjNames: string[] };
const fields = ['saveLocation', 'timeOut', 'defaultLanguage', 'hideStderrorWhenCompiledOK', 'ignoreSTDERROR', 'defaultOnlineJudge', 'includeProblemIndex', 'autoShowJudge', 'collectProblemsInRoot', 'fileNameTemplate', 'fileNameTemplateOverrides', 'useShortAtCoderName', 'useShortCodeForcesName', 'useShortLuoguName', 'vjudgeOpenInBrowser', 'defaultProblemSource', 'vjudgeUrlSuffix', 'vjudgeBrowserSplitRatio'] as const;
const defaultFileNameTemplate = '{ojName}/{contestId}/{problemId}.{ext}';
const defaultFileNameTemplateOverrides: Record<string, string> = {
	CSES: '{ojName}/{problemId}_{slug}.{ext}',
	AT: '{ojName}/{contestId}/{problemId}.{ext}',
	CF: '{ojName}/{contestId}/{problemId}.{ext}',
	LG: '{ojName}/{problemId}.{ext}',
	VJ: '{ojName}/{problemId}{slug}.{ext}',
	'牛客': 'NowCoder/{problemId}.{ext}'
};

export function registerCphSettings(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('shortestpath.configureCph', openCphSettings),
		vscode.commands.registerCommand('shortestpath.configureOjMappings', openOjMappings),
		vscode.commands.registerCommand('shortestpath.configureVjudgeMappings', openVjudgeMappings)
	);
}

function getState(): State {
	const c = vscode.workspace.getConfiguration('cph.general');
	const ojMapping = c.get<Record<string, { oj?: unknown }>>('ojMapping') ?? {};
	const vjudgeOjNames = c.get<Record<string, unknown>>('vjudgeOjNames') ?? {};
	const availableOjNames = [...new Set([
		...Object.values(ojMapping).flatMap(mapping => typeof mapping.oj === 'string' ? [mapping.oj] : []),
		...Object.keys(vjudgeOjNames)
	])].sort((a, b) => a.localeCompare(b));
	return {
		saveLocation: c.get<string>('saveLocation') ?? '', timeOut: c.get<number>('timeOut') ?? 3000, defaultLanguage: c.get<string>('defaultLanguage') ?? 'cpp',
		hideStderrorWhenCompiledOK: c.get<boolean>('hideStderrorWhenCompiledOK') ?? true, ignoreSTDERROR: c.get<boolean>('ignoreSTDERROR') ?? false,
		defaultOnlineJudge: c.get<boolean>('defaultOnlineJudge') ?? false, includeProblemIndex: c.get<boolean>('includeProblemIndex') ?? false,
		autoShowJudge: c.get<boolean>('autoShowJudge') ?? true, collectProblemsInRoot: c.get<boolean>('collectProblemsInRoot') ?? true,
		fileNameTemplate: c.get<string>('fileNameTemplate') ?? defaultFileNameTemplate,
		fileNameTemplateOverrides: JSON.stringify(c.get<Record<string, string>>('fileNameTemplateOverrides') ?? defaultFileNameTemplateOverrides, undefined, 2),
		useShortAtCoderName: c.get<boolean>('useShortAtCoderName') ?? false, useShortCodeForcesName: c.get<boolean>('useShortCodeForcesName') ?? false, useShortLuoguName: c.get<boolean>('useShortLuoguName') ?? false,
		vjudgeOpenInBrowser: c.get<boolean>('vjudgeOpenInBrowser') ?? false, defaultProblemSource: c.get<string>('defaultProblemSource') === 'original' ? 'original' : 'vjudge', vjudgeUrlSuffix: c.get<string>('vjudgeUrlSuffix') ?? '', vjudgeBrowserSplitRatio: c.get<number>('vjudgeBrowserSplitRatio') ?? 65,
		availableOjNames
	};
}

async function save(value: State): Promise<void> {
	const c = vscode.workspace.getConfiguration('cph.general');
	let fileNameTemplateOverrides: Record<string, string>;
	try {
		const parsed = JSON.parse(String(value.fileNameTemplateOverrides ?? '{}'));
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some(template => typeof template !== 'string')) {
			throw new Error('invalid template overrides');
		}
		fileNameTemplateOverrides = parsed as Record<string, string>;
	} catch {
		void vscode.window.showWarningMessage(localize('文件名模板覆盖必须是一个 JSON 对象，OJ 简称为键、模板字符串为值。'));
		return;
	}
	await Promise.all([
		c.update('saveLocation', String(value.saveLocation ?? '').trim(), true), c.update('timeOut', clamp(value.timeOut, 100, 120000, 3000), true),
		c.update('defaultLanguage', String(value.defaultLanguage || 'cpp'), true), c.update('hideStderrorWhenCompiledOK', value.hideStderrorWhenCompiledOK !== false, true),
		c.update('ignoreSTDERROR', value.ignoreSTDERROR === true, true), c.update('defaultOnlineJudge', value.defaultOnlineJudge === true, true),
		c.update('includeProblemIndex', value.includeProblemIndex === true, true), c.update('autoShowJudge', value.autoShowJudge !== false, true),
		c.update('collectProblemsInRoot', value.collectProblemsInRoot !== false, true), c.update('vjudgeOpenInBrowser', value.vjudgeOpenInBrowser === true, true), c.update('defaultProblemSource', value.defaultProblemSource === 'original' ? 'original' : 'vjudge', true),
		c.update('fileNameTemplate', String(value.fileNameTemplate ?? '').trim(), true), c.update('fileNameTemplateOverrides', fileNameTemplateOverrides, true),
		c.update('useShortAtCoderName', value.useShortAtCoderName === true, true), c.update('useShortCodeForcesName', value.useShortCodeForcesName === true, true), c.update('useShortLuoguName', value.useShortLuoguName === true, true),
		c.update('vjudgeUrlSuffix', String(value.vjudgeUrlSuffix ?? ''), true), c.update('vjudgeBrowserSplitRatio', clamp(value.vjudgeBrowserSplitRatio, 10, 90, 65), true)
	]);
}
function clamp(value: unknown, min: number, max: number, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback; }

function openCphSettings(): void {
	let saving = false;
	const panel = vscode.window.createWebviewPanel('shortestpath.cphSettings', localize('CPH 设置'), vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
	panel.webview.html = localizeWebviewHtml(getCphSettingsHtml(getState()));
	panel.webview.onDidReceiveMessage(async message => {
		if (message?.type === 'save') { saving = true; try { await save(message.value); } finally { saving = false; } }
		if (message?.type === 'ojMapping') { await vscode.commands.executeCommand('shortestpath.configureOjMappings'); }
		if (message?.type === 'vjudgeMapping') { await vscode.commands.executeCommand('shortestpath.configureVjudgeMappings'); }
	});
	const listener = vscode.workspace.onDidChangeConfiguration(event => { if (!saving && event.affectsConfiguration('cph.general')) { void panel.webview.postMessage({ type: 'state', value: getState() }); } });
	panel.onDidDispose(() => listener.dispose());
}

function getCphSettingsHtml(state: State): string {
	const value = JSON.stringify(state).replace(/</g, '\\u003c');
	return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';"><style>body{margin:0;background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family)}main{max-width:850px;margin:auto;padding:36px 28px 64px}.card{border:1px solid var(--vscode-editorWidget-border);border-radius:7px;padding:0 18px;margin:18px 0}.row{display:grid;grid-template-columns:250px minmax(0,1fr);gap:16px;padding:14px 0;border-bottom:1px solid var(--vscode-editorWidget-border);align-items:center}.row:last-child{border:0}.hint{font-size:12px;color:var(--vscode-descriptionForeground);margin-top:4px;line-height:1.5}input,select,textarea{box-sizing:border-box;width:100%;padding:7px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);font:inherit}input[type=checkbox]{width:auto}.toggle{display:flex;gap:9px}.template-preview{font-family:var(--vscode-editor-font-family);padding:8px 10px;background:var(--vscode-textCodeBlock-background);border-radius:5px;overflow-wrap:anywhere}button{padding:7px 12px;border:0;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}.mapping-row{display:grid;grid-template-columns:110px minmax(0,1fr) auto;gap:8px;margin-top:8px}@media(max-width:650px){.row{grid-template-columns:1fr}}</style></head><body><main><h1>CPH 设置</h1><p>更改会自动保存。编译器与编译选项请在 ShortestPath IDE 主设置页统一修改。</p><section class="card"><h2>运行</h2><div class="row"><label>单个测试点超时（毫秒）</label><input id="timeOut" type="number"></div><div class="row"><label>编译成功时隐藏 stderr</label><label class="toggle"><input id="hideStderrorWhenCompiledOK" type="checkbox">启用</label></div><div class="row"><label>忽略运行时 stderr</label><label class="toggle"><input id="ignoreSTDERROR" type="checkbox">启用</label></div></section><section class="card"><h2>题目与文件</h2><div class="row"><div>新导入题目的默认语言<div class="hint">不指定时每次导入询问。</div></div><select id="defaultLanguage"><option value="cpp">C++</option><option value="c">C</option><option value="python">Python</option><option value="rust">Rust</option><option value="java">Java</option><option value="js">JavaScript</option><option value="none">不指定</option></select></div><div class="row"><label>测试数据与可执行文件目录</label><input id="saveLocation"></div><div class="row"><label>将 .cph 元数据集中到工作目录根目录</label><label class="toggle"><input id="collectProblemsInRoot" type="checkbox">启用</label></div><div class="row"><label>新题文件名包含导入序号</label><label class="toggle"><input id="includeProblemIndex" type="checkbox">启用</label></div><div class="row"><label>打开关联题目文件时自动显示 Judge</label><label class="toggle"><input id="autoShowJudge" type="checkbox">启用</label></div><div class="row"><label>默认定义 ONLINE_JUDGE 宏</label><label class="toggle"><input id="defaultOnlineJudge" type="checkbox">启用</label></div></section><section class="card"><h2>文件名</h2><div class="row"><div>文件名模板<div class="hint">选择预设；仅选择“自定义”后才能手动输入。</div></div><div><select id="fileNameTemplatePreset"><option value="{ojName}/{contestId}/{problemId}.{ext}">ShortestPath 推荐：&lt;OJ 名称&gt;/&lt;比赛 ID&gt;/&lt;题目编号&gt;</option><option value="{oj}/{contestId}/{problemId}_{slug}.{ext}">&lt;OJ 简称&gt;/&lt;比赛 ID&gt;/&lt;题目编号&gt;_&lt;题目名&gt;</option><option value="{contestId}_{problemId}_{slug}.{ext}">&lt;比赛 ID&gt;_&lt;题目编号&gt;_&lt;题目名&gt;</option><option value="custom">自定义</option></select><input id="fileNameTemplate" placeholder="例如：{oj}/{contestId}/{problemId}_{slug}.{ext}" hidden><div id="fileNameTemplateHelp" class="hint" hidden>{oj} OJ 简称；{ojName} OJ 全称；{contestId} 比赛 ID；{problemId} 题号；{slug} 题名简写；{name} 题名；{index} 导入序号；{group} 分组；{url} 链接；{ext} 扩展名；{lang} 语言。</div></div></div><div class="row"><div>命名效果示例<div class="hint">以 Codeforces 第 2078 场 A 题、C++ 为例；实时预览上方通用模板。</div></div><div id="fileNameTemplateExample" class="template-preview"></div></div><div class="row"><div>文件名模板覆盖<div class="hint">为不同 OJ 设置专用模板，匹配时优先于通用模板。</div></div><div><div class="hint">可用 OJ 简称：${state.availableOjNames.join('、') || '未解析到，请在在线评测映射中添加'}</div><input id="fileNameTemplateOverrides" type="hidden"><div id="fileNameTemplateOverridesEditor"></div><button id="addFileNameTemplateOverride" type="button" style="margin-top:8px">添加 OJ 规则</button></div></div><div class="row"><label>AtCoder 使用短文件名</label><label class="toggle"><input id="useShortAtCoderName" type="checkbox">启用</label></div><div class="row"><label>Codeforces 使用短文件名</label><label class="toggle"><input id="useShortCodeForcesName" type="checkbox">启用</label></div><div class="row"><label>洛谷使用短文件名</label><label class="toggle"><input id="useShortLuoguName" type="checkbox">启用</label></div></section><section class="card"><h2>题面</h2><div class="row"><label>在浏览器中自动显示题目</label><label class="toggle"><input id="vjudgeOpenInBrowser" type="checkbox">启用</label></div><div class="row"><div>默认题面来源<div class="hint">可在“在线评测映射”中为单个 OJ 覆盖。</div></div><select id="defaultProblemSource"><option value="vjudge">VJudge</option><option value="original">原 OJ</option></select></div><div class="row"><label>VJudge URL 后缀</label><input id="vjudgeUrlSuffix"></div><div class="row"><label>浏览器分栏比例（10–90）</label><input id="vjudgeBrowserSplitRatio" type="number"></div></section><section class="card"><h2>映射</h2><div class="row"><div>在线评测映射<div class="hint">可为每个 OJ 设置题面来源。</div></div><button id="ojMapping">配置在线评测映射</button></div><div class="row"><div>VJudge 映射</div><button id="vjudgeMapping">配置 VJudge 映射</button></div></section></main><script>const vscode=acquireVsCodeApi(),fields=${JSON.stringify(fields)},el=id=>document.getElementById(id);let state=${value},timer;function parseOverrides(){try{const value=JSON.parse(el('fileNameTemplateOverrides').value||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?Object.entries(value).filter(([,template])=>typeof template==='string'):[]}catch{return[]}}function collectOverrides(){const rows=[...el('fileNameTemplateOverridesEditor').children].map(row=>({oj:row.querySelector('.override-oj').value.trim(),template:row.querySelector('.override-template').value.trim()}));return Object.fromEntries(rows.filter(row=>row.oj&&row.template).map(row=>[row.oj,row.template]))}function renderOverrides(){const editor=el('fileNameTemplateOverridesEditor');editor.replaceChildren();parseOverrides().forEach(([oj,template])=>addOverrideRow(oj,template))}function addOverrideRow(oj='',template=''){const row=document.createElement('div');row.className='mapping-row';const ojInput=document.createElement('input');ojInput.className='override-oj';ojInput.value=oj;ojInput.placeholder='OJ 简称';const templateInput=document.createElement('input');templateInput.className='override-template';templateInput.value=template;templateInput.placeholder='{ojName}/{contestId}/{problemId}.{ext}';const remove=document.createElement('button');remove.type='button';remove.textContent='删除';remove.onclick=()=>{row.remove();saveOverrides()};row.append(ojInput,templateInput,remove);el('fileNameTemplateOverridesEditor').append(row)}function renderTemplate(){const input=el('fileNameTemplate'),preset=el('fileNameTemplatePreset'),matched=[...preset.options].some(option=>option.value!=='custom'&&option.value===input.value);preset.value=matched?input.value:'custom';input.hidden=matched;el('fileNameTemplateHelp').hidden=matched;const template=input.value;const sample={oj:'CF',ojName:'Codeforces',contestId:'2078',problemId:'A',slug:'Sample_Problem',name:'Sample Problem',index:'A',group:'Codeforces Round 2078',url:'https://codeforces.com/contest/2078/problem/A',ext:'cpp',lang:'cpp'};el('fileNameTemplateExample').textContent=template.replace(/\\{(oj|ojName|contestId|problemId|slug|name|index|group|url|ext|lang)\\}/g,(_,key)=>sample[key])}function render(){fields.forEach(id=>{const node=el(id);node.type==='checkbox'?node.checked=!!state[id]:node.value=state[id]??''});renderOverrides();renderTemplate()}function save(){clearTimeout(timer);timer=setTimeout(()=>vscode.postMessage({type:'save',value:Object.fromEntries(fields.map(id=>[id,el(id).type==='checkbox'?el(id).checked:el(id).type==='number'?Number(el(id).value):el(id).value]))}),180)}function saveOverrides(){el('fileNameTemplateOverrides').value=JSON.stringify(collectOverrides(),undefined,2);renderTemplate();save()}fields.filter(id=>id!=='fileNameTemplateOverrides').forEach(id=>{el(id).oninput=()=>{renderTemplate();save()};el(id).onchange=()=>{renderTemplate();save()}});el('fileNameTemplatePreset').onchange=()=>{const preset=el('fileNameTemplatePreset'),input=el('fileNameTemplate'),custom=preset.value==='custom';input.hidden=!custom;el('fileNameTemplateHelp').hidden=!custom;if(custom)input.focus();else{input.value=preset.value;renderTemplate();save()}};el('fileNameTemplateOverridesEditor').oninput=event=>{if(event.target.matches('.override-oj,.override-template'))saveOverrides()};el('addFileNameTemplateOverride').onclick=()=>{addOverrideRow();el('fileNameTemplateOverridesEditor').lastElementChild.querySelector('.override-oj').focus()};el('ojMapping').onclick=()=>vscode.postMessage({type:'ojMapping'});el('vjudgeMapping').onclick=()=>vscode.postMessage({type:'vjudgeMapping'});window.onmessage=e=>{if(e.data?.type==='state'){state=e.data.value;render()}};render();</script></body></html>`;
}

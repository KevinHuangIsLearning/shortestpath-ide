import * as vscode from 'vscode';
import { openOjMappings, openVjudgeMappings } from './cphMappings';

type State = Record<string, string | number | boolean>;
const fields = ['saveLocation', 'timeOut', 'defaultLanguage', 'hideStderrorWhenCompiledOK', 'ignoreSTDERROR', 'defaultOnlineJudge', 'includeProblemIndex', 'autoShowJudge', 'collectProblemsInRoot', 'vjudgeOpenInBrowser', 'vjudgeUrlSuffix', 'vjudgeBrowserSplitRatio'] as const;

export function registerCphSettings(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('shortestpath.configureCph', openCphSettings),
		vscode.commands.registerCommand('shortestpath.configureOjMappings', openOjMappings),
		vscode.commands.registerCommand('shortestpath.configureVjudgeMappings', openVjudgeMappings)
	);
}

function getState(): State {
	const c = vscode.workspace.getConfiguration('cph.general');
	return {
		saveLocation: c.get<string>('saveLocation') ?? '', timeOut: c.get<number>('timeOut') ?? 3000, defaultLanguage: c.get<string>('defaultLanguage') ?? 'cpp',
		hideStderrorWhenCompiledOK: c.get<boolean>('hideStderrorWhenCompiledOK') ?? true, ignoreSTDERROR: c.get<boolean>('ignoreSTDERROR') ?? false,
		defaultOnlineJudge: c.get<boolean>('defaultOnlineJudge') ?? false, includeProblemIndex: c.get<boolean>('includeProblemIndex') ?? false,
		autoShowJudge: c.get<boolean>('autoShowJudge') ?? true, collectProblemsInRoot: c.get<boolean>('collectProblemsInRoot') ?? true,
		vjudgeOpenInBrowser: c.get<boolean>('vjudgeOpenInBrowser') ?? false, vjudgeUrlSuffix: c.get<string>('vjudgeUrlSuffix') ?? '', vjudgeBrowserSplitRatio: c.get<number>('vjudgeBrowserSplitRatio') ?? 65
	};
}

async function save(value: State): Promise<void> {
	const c = vscode.workspace.getConfiguration('cph.general');
	await Promise.all([
		c.update('saveLocation', String(value.saveLocation ?? '').trim(), true), c.update('timeOut', clamp(value.timeOut, 100, 120000, 3000), true),
		c.update('defaultLanguage', String(value.defaultLanguage || 'cpp'), true), c.update('hideStderrorWhenCompiledOK', value.hideStderrorWhenCompiledOK !== false, true),
		c.update('ignoreSTDERROR', value.ignoreSTDERROR === true, true), c.update('defaultOnlineJudge', value.defaultOnlineJudge === true, true),
		c.update('includeProblemIndex', value.includeProblemIndex === true, true), c.update('autoShowJudge', value.autoShowJudge !== false, true),
		c.update('collectProblemsInRoot', value.collectProblemsInRoot !== false, true), c.update('vjudgeOpenInBrowser', value.vjudgeOpenInBrowser === true, true),
		c.update('vjudgeUrlSuffix', String(value.vjudgeUrlSuffix ?? ''), true), c.update('vjudgeBrowserSplitRatio', clamp(value.vjudgeBrowserSplitRatio, 10, 90, 65), true)
	]);
}
function clamp(value: unknown, min: number, max: number, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback; }

function openCphSettings(): void {
	let saving = false;
	const panel = vscode.window.createWebviewPanel('shortestpath.cphSettings', 'CPH 设置', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
	panel.webview.html = html(getState());
	panel.webview.onDidReceiveMessage(async message => {
		if (message?.type === 'save') { saving = true; try { await save(message.value); } finally { saving = false; } }
		if (message?.type === 'ojMapping') { await vscode.commands.executeCommand('shortestpath.configureOjMappings'); }
		if (message?.type === 'vjudgeMapping') { await vscode.commands.executeCommand('shortestpath.configureVjudgeMappings'); }
	});
	const listener = vscode.workspace.onDidChangeConfiguration(event => { if (!saving && event.affectsConfiguration('cph.general')) { void panel.webview.postMessage({ type: 'state', value: getState() }); } });
	panel.onDidDispose(() => listener.dispose());
}

function html(state: State): string {
	const value = JSON.stringify(state).replace(/</g, '\\u003c');
	return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';"><style>body{background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family)}main{max-width:850px;margin:auto;padding:36px 28px}.card{border:1px solid var(--vscode-editorWidget-border);border-radius:7px;padding:0 18px;margin:18px 0}.row{display:grid;grid-template-columns:250px 1fr;gap:16px;padding:14px 0;border-bottom:1px solid var(--vscode-editorWidget-border);align-items:center}.row:last-child{border:0}.hint{font-size:12px;color:var(--vscode-descriptionForeground);margin-top:4px}input,select{box-sizing:border-box;width:100%;padding:7px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border)}input[type=checkbox]{width:auto}.toggle{display:flex;gap:9px}button{padding:7px 12px;border:0;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}@media(max-width:650px){.row{grid-template-columns:1fr}}</style></head><body><main><h1>CPH 设置</h1><p>更改会自动保存。编译器与编译选项请在 ShortestPath IDE 主设置页统一修改。</p><section class="card"><h2>运行</h2><div class="row"><label>单个测试点超时（毫秒）</label><input id="timeOut" type="number"></div><div class="row"><label>编译成功时隐藏 stderr</label><label class="toggle"><input id="hideStderrorWhenCompiledOK" type="checkbox">启用</label></div><div class="row"><div>忽略运行时 stderr<div class="hint">一般不建议启用。</div></div><label class="toggle"><input id="ignoreSTDERROR" type="checkbox">启用</label></div></section><section class="card"><h2>题目与文件</h2><div class="row"><div>新导入题目的默认语言<div class="hint">不指定时每次导入询问。</div></div><select id="defaultLanguage"><option value="cpp">C++</option><option value="c">C</option><option value="python">Python</option><option value="rust">Rust</option><option value="java">Java</option><option value="js">JavaScript</option><option value="none">不指定</option></select></div><div class="row"><div>测试数据与可执行文件目录<div class="hint">保存 .tcs 与 .bin；留空在源文件目录。</div></div><input id="saveLocation"></div><div class="row"><div>将 .cph 元数据集中到工作目录根目录</div><label class="toggle"><input id="collectProblemsInRoot" type="checkbox">启用</label></div><div class="row"><div>新题文件名包含导入序号</div><label class="toggle"><input id="includeProblemIndex" type="checkbox">启用</label></div><div class="row"><div>打开关联题目文件时自动显示 Judge</div><label class="toggle"><input id="autoShowJudge" type="checkbox">启用</label></div><div class="row"><div>默认定义 ONLINE_JUDGE 宏</div><label class="toggle"><input id="defaultOnlineJudge" type="checkbox">启用</label></div></section><section class="card"><h2>VJudge</h2><div class="row"><label>在浏览器中显示题目</label><label class="toggle"><input id="vjudgeOpenInBrowser" type="checkbox">启用</label></div><div class="row"><label>VJudge URL 后缀</label><input id="vjudgeUrlSuffix"></div><div class="row"><label>浏览器分栏比例（10–90）</label><input id="vjudgeBrowserSplitRatio" type="number"></div></section><section class="card"><h2>映射</h2><div class="row"><div>在线评测映射<div class="hint">域名、OJ 名称和题号正则。</div></div><button id="ojMapping">配置在线评测映射</button></div><div class="row"><div>VJudge 映射<div class="hint">OJ 名称、原题链接模板和题号正则。</div></div><button id="vjudgeMapping">配置 VJudge 映射</button></div></section></main><script>const vscode=acquireVsCodeApi(),fields=${JSON.stringify(fields)},el=id=>document.getElementById(id);let state=${value},timer;function render(){fields.forEach(id=>{const n=el(id);n.type==='checkbox'?n.checked=!!state[id]:n.value=state[id]??''})}function save(){clearTimeout(timer);timer=setTimeout(()=>vscode.postMessage({type:'save',value:Object.fromEntries(fields.map(id=>[id,el(id).type==='checkbox'?el(id).checked:el(id).type==='number'?Number(el(id).value):el(id).value]))}),180)}fields.forEach(id=>{el(id).oninput=save;el(id).onchange=save});el('ojMapping').onclick=()=>vscode.postMessage({type:'ojMapping'});el('vjudgeMapping').onclick=()=>vscode.postMessage({type:'vjudgeMapping'});window.onmessage=e=>{if(e.data?.type==='state'){state=e.data.value;render()}};render();</script></body></html>`;
}

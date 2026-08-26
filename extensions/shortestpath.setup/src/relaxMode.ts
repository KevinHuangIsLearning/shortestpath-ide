/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { localize, localizeWebviewHtml } from './localization';

type RelaxSource = {
	id: string;
	name: string;
	url: string;
	builtin?: boolean;
};

type RelaxModeState = {
	enabled: boolean;
	sources: RelaxSource[];
	lastBrowserUrl?: string;
	relaxBrowserIds?: string[];
	browserInAuxiliaryWindow?: boolean;
};

const stateKey = 'shortestpath.relaxMode.state';
const unlockedKey = 'shortestpath.relaxMode.unlocked';
const unlockedContextKey = 'shortestpath.relaxMode.unlocked';
const legacyStateKey = 'shortestpath.fishMode.state';
const legacyUnlockedKey = 'shortestpath.fishMode.unlocked';
const defaultSources: readonly RelaxSource[] = [
	{ id: 'bilibili', name: '哔哩哔哩', url: 'https://www.bilibili.com/', builtin: true },
	{ id: 'poki', name: 'Poki', url: 'https://poki.com/', builtin: true }
];

let settingsPanel: vscode.WebviewPanel | undefined;
let modePanel: vscode.WebviewPanel | undefined;
let lastRelaxBrowserTab: vscode.BrowserTab | undefined;
const relaxBrowserIds = new Set<string>();
let sourceId = 0;
let hideAttempt = 0;
const hideFailureRates = [5, 20, 40, 80, 100] as const;

export function registerRelaxMode(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('shortestpath.relaxMode.openSettings', () => openRelaxSettings(context)),
		vscode.commands.registerCommand('shortestpath.relaxMode.open', () => openRelaxMode(context)),
		vscode.commands.registerCommand('shortestpath.relaxMode.toggleVisibility', () => toggleRelaxVisibility(context)),
		vscode.commands.registerCommand('shortestpath.relaxMode.minimizeWindow', () => minimizeRelaxWindow(context)),
		vscode.window.onDidOpenBrowserTab(tab => {
			if (tab.parentId && relaxBrowserIds.has(tab.parentId)) {
				void (async () => {
					await rememberRelaxBrowser(context, tab);
					if (getState(context).browserInAuxiliaryWindow) {
						await tab.minimizeWindow();
					}
				})();
			}
		}),
		vscode.window.onDidCloseBrowserTab(tab => {
			relaxBrowserIds.delete(tab.id);
			if (tab === lastRelaxBrowserTab) {
				void forgetLastRelaxBrowser(context);
			}
		}),
		vscode.window.onDidChangeBrowserTabState(tab => {
			if (tab === lastRelaxBrowserTab) {
				void rememberRelaxBrowser(context, tab);
			}
		})
	);
	for (const id of getState(context).relaxBrowserIds ?? []) {
		relaxBrowserIds.add(id);
	}
	lastRelaxBrowserTab = findLastRelaxBrowserTab(context);
	void vscode.commands.executeCommand('setContext', unlockedContextKey, isUnlocked(context));
}

export async function unlockRelaxMode(context: vscode.ExtensionContext): Promise<void> {
	await context.globalState.update(unlockedKey, true);
	await vscode.commands.executeCommand('setContext', unlockedContextKey, true);
	openRelaxSettings(context);
}

function isUnlocked(context: vscode.ExtensionContext): boolean {
	return context.globalState.get<boolean>(unlockedKey) === true || context.globalState.get<boolean>(legacyUnlockedKey) === true;
}

function getState(context: vscode.ExtensionContext): RelaxModeState {
	const stored = context.globalState.get<unknown>(stateKey) ?? context.globalState.get<unknown>(legacyStateKey);
	if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
		return { enabled: false, sources: [...defaultSources] };
	}
	const value = stored as { enabled?: unknown; sources?: unknown; lastBrowserUrl?: unknown; relaxBrowserIds?: unknown; fishBrowserIds?: unknown; browserInAuxiliaryWindow?: unknown };
	const sources = Array.isArray(value.sources)
		? value.sources.flatMap((item, index) => normalizeStoredSource(item, index))
		: [];
	const lastBrowserUrl = normalizeUrl(value.lastBrowserUrl);
	const browserIds = value.relaxBrowserIds ?? value.fishBrowserIds;
	const storedRelaxBrowserIds = Array.isArray(browserIds) ? browserIds.filter((id): id is string => typeof id === 'string') : [];
	return {
		enabled: value.enabled === true,
		sources: sources.length ? sources : [...defaultSources],
		...(lastBrowserUrl ? { lastBrowserUrl } : {}),
		...(storedRelaxBrowserIds.length ? { relaxBrowserIds: storedRelaxBrowserIds } : {}),
		...(value.browserInAuxiliaryWindow === true ? { browserInAuxiliaryWindow: true } : {})
	};
}

function normalizeStoredSource(value: unknown, index: number): RelaxSource[] {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return [];
	}
	const source = value as Partial<RelaxSource>;
	const url = normalizeUrl(source.url);
	if (!url) {
		return [];
	}
	const name = typeof source.name === 'string' && source.name.trim() ? source.name.trim() : new URL(url).hostname;
	const id = typeof source.id === 'string' && source.id.trim() ? source.id.trim() : `source-${index}`;
	return [{ id, name: name.slice(0, 80), url, builtin: source.builtin === true }];
}

async function saveState(context: vscode.ExtensionContext, state: RelaxModeState): Promise<void> {
	await context.globalState.update(stateKey, {
		enabled: state.enabled,
		sources: state.sources.slice(0, 100),
		...(state.lastBrowserUrl ? { lastBrowserUrl: state.lastBrowserUrl } : {}),
		...(state.relaxBrowserIds?.length ? { relaxBrowserIds: state.relaxBrowserIds.slice(0, 100) } : {}),
		...(state.browserInAuxiliaryWindow ? { browserInAuxiliaryWindow: true } : {})
	});
}

async function toggleRelaxVisibility(context: vscode.ExtensionContext): Promise<void> {
	const tab = findLastRelaxBrowserTab(context);
	if (tab) {
		const state = getState(context);
		const relatedTabs = getRelaxBrowserTabs(context);
		if (state.browserInAuxiliaryWindow) {
			await tab.moveToMainWindow(relatedTabs.filter(candidate => candidate !== tab));
			delete state.browserInAuxiliaryWindow;
			await saveState(context, state);
		} else {
			const failureRate = hideFailureRates[hideAttempt++ % hideFailureRates.length];
			if (Math.random() * 100 < failureRate) {
				return;
			}
			await tab.moveToNewWindow({ additionalTabs: relatedTabs.filter(candidate => candidate !== tab), minimize: true });
			hideRelaxWebviewPanels();
			state.browserInAuxiliaryWindow = true;
			await saveState(context, state);
		}
		return;
	}

	const state = getState(context);
	if (!state.enabled) {
		state.enabled = true;
		await saveState(context, state);
	}
	await openRelaxBrowser(context, state.lastBrowserUrl ?? state.sources[0]?.url);
}

function hideRelaxWebviewPanels(): void {
	modePanel?.dispose();
	settingsPanel?.dispose();
}

async function minimizeRelaxWindow(context: vscode.ExtensionContext): Promise<void> {
	if (vscode.window.activeBrowserTab !== findLastRelaxBrowserTab(context)) {
		return;
	}

	await vscode.commands.executeCommand('workbench.action.minimizeWindow');
}

async function startRelaxMode(context: vscode.ExtensionContext): Promise<void> {
	if (!isUnlocked(context)) {
		return;
	}
	const state = getState(context);
	if (!state.enabled) {
		state.enabled = true;
		await saveState(context, state);
	}
	openRelaxMode(context);
	postState(state);
}

function openRelaxSettings(context: vscode.ExtensionContext): void {
	if (!isUnlocked(context)) {
		return;
	}
	if (settingsPanel) {
		settingsPanel.reveal(vscode.ViewColumn.Active);
		postState(getState(context));
		return;
	}
	const panel = vscode.window.createWebviewPanel(
		'shortestpath.relaxSettings',
		localize('放松模式设置'),
		vscode.ViewColumn.Active,
		{ enableScripts: true, retainContextWhenHidden: true }
	);
	settingsPanel = panel;
	panel.webview.html = localizeWebviewHtml(getSettingsHtml(getState(context)));
	panel.webview.onDidReceiveMessage(async message => {
		if (message?.type === 'openMain') {
			await startRelaxMode(context);
		} else if (message?.type === 'configureShortcut') {
			await vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', '@command:shortestpath.relaxMode.toggleVisibility');
		}
	}, undefined, context.subscriptions);
	panel.onDidDispose(() => {
		if (settingsPanel === panel) {
			settingsPanel = undefined;
		}
	}, undefined, context.subscriptions);
}

function openRelaxMode(context: vscode.ExtensionContext): void {
	if (!isUnlocked(context) || !getState(context).enabled) {
		return;
	}
	if (modePanel) {
		modePanel.reveal(vscode.ViewColumn.Active);
		postState(getState(context));
		return;
	}
	const panel = vscode.window.createWebviewPanel(
		'shortestpath.relaxMode',
		localize('放松模式'),
		vscode.ViewColumn.Active,
		{ enableScripts: true, retainContextWhenHidden: true }
	);
	modePanel = panel;
	panel.webview.html = localizeWebviewHtml(getModeHtml(getState(context)));
	panel.webview.onDidReceiveMessage(async message => {
		if (message?.type === 'openSource') {
			await openSource(context, message.id);
		} else if (message?.type === 'addSource') {
			await addSource(context, message.name, message.url, panel);
		} else if (message?.type === 'removeSource') {
			await removeSource(context, message.id);
		} else if (message?.type === 'resetSources') {
			const state = getState(context);
			state.sources = [...defaultSources];
			await saveState(context, state);
			postState(state);
		} else if (message?.type === 'settings') {
			openRelaxSettings(context);
		}
	}, undefined, context.subscriptions);
	panel.onDidDispose(() => {
		if (modePanel === panel) {
			modePanel = undefined;
		}
	}, undefined, context.subscriptions);
}

async function openSource(context: vscode.ExtensionContext, id: unknown): Promise<void> {
	if (!getState(context).enabled || typeof id !== 'string') {
		return;
	}
	const source = getState(context).sources.find(item => item.id === id);
	if (!source) {
		return;
	}
	await openRelaxBrowser(context, source.url);
}

async function openRelaxBrowser(context: vscode.ExtensionContext, url: string | undefined): Promise<void> {
	if (!url) {
		openRelaxMode(context);
		return;
	}
	try {
		const tab = await vscode.window.openBrowserTab(url, { viewColumn: vscode.ViewColumn.Active, preserveFocus: false });
		const state = getState(context);
		delete state.browserInAuxiliaryWindow;
		await saveState(context, state);
		await rememberRelaxBrowser(context, tab);
	} catch (error) {
		void vscode.window.showErrorMessage(`无法打开放松源：${error instanceof Error ? error.message : String(error)}`);
	}
}

function findLastRelaxBrowserTab(context: vscode.ExtensionContext): vscode.BrowserTab | undefined {
	if (lastRelaxBrowserTab && vscode.window.browserTabs.includes(lastRelaxBrowserTab)) {
		return lastRelaxBrowserTab;
	}
	lastRelaxBrowserTab = undefined;
	const storedId = getState(context).relaxBrowserIds?.find(id => vscode.window.browserTabs.some(tab => tab.id === id));
	if (storedId) {
		lastRelaxBrowserTab = vscode.window.browserTabs.find(tab => tab.id === storedId);
		return lastRelaxBrowserTab;
	}
	const lastBrowserUrl = getState(context).lastBrowserUrl;
	if (!lastBrowserUrl) {
		return undefined;
	}
	lastRelaxBrowserTab = vscode.window.browserTabs.find(tab => tab.url === lastBrowserUrl);
	return lastRelaxBrowserTab;
}

function getRelaxBrowserTabs(context: vscode.ExtensionContext): vscode.BrowserTab[] {
	for (const id of getState(context).relaxBrowserIds ?? []) {
		relaxBrowserIds.add(id);
	}
	let changed = true;
	while (changed) {
		changed = false;
		for (const tab of vscode.window.browserTabs) {
			if (tab.parentId && relaxBrowserIds.has(tab.parentId) && !relaxBrowserIds.has(tab.id)) {
				relaxBrowserIds.add(tab.id);
				changed = true;
			}
		}
	}
	return vscode.window.browserTabs.filter(tab => relaxBrowserIds.has(tab.id));
}

async function rememberRelaxBrowser(context: vscode.ExtensionContext, tab: vscode.BrowserTab): Promise<void> {
	const url = normalizeUrl(tab.url);
	if (!url) {
		return;
	}
	lastRelaxBrowserTab = tab;
	const state = getState(context);
	relaxBrowserIds.add(tab.id);
	state.lastBrowserUrl = url;
	state.relaxBrowserIds = [...relaxBrowserIds];
	await saveState(context, state);
}

async function forgetLastRelaxBrowser(context: vscode.ExtensionContext): Promise<void> {
	lastRelaxBrowserTab = undefined;
	const state = getState(context);
	if (!state.lastBrowserUrl) {
		return;
	}
	delete state.lastBrowserUrl;
	state.relaxBrowserIds = [...relaxBrowserIds];
	delete state.browserInAuxiliaryWindow;
	await saveState(context, state);
}

async function addSource(context: vscode.ExtensionContext, nameValue: unknown, urlValue: unknown, panel: vscode.WebviewPanel): Promise<void> {
	const url = normalizeUrl(urlValue);
	if (!url) {
		await panel.webview.postMessage({ type: 'error', message: '请输入有效的 HTTP 或 HTTPS 网站地址。' });
		return;
	}
	const state = getState(context);
	if (state.sources.some(source => source.url === url)) {
		await panel.webview.postMessage({ type: 'error', message: '这个放松源已经添加过了。' });
		return;
	}
	const name = typeof nameValue === 'string' && nameValue.trim() ? nameValue.trim() : new URL(url).hostname;
	state.sources.push({ id: `source-${Date.now()}-${sourceId++}`, name: name.slice(0, 80), url });
	await saveState(context, state);
	postState(state);
}

async function removeSource(context: vscode.ExtensionContext, id: unknown): Promise<void> {
	if (typeof id !== 'string') {
		return;
	}
	const state = getState(context);
	const next = state.sources.filter(source => source.id !== id);
	if (next.length === state.sources.length) {
		return;
	}
	state.sources = next.length ? next : [...defaultSources];
	await saveState(context, state);
	postState(state);
}

function normalizeUrl(value: unknown): string | undefined {
	if (typeof value !== 'string' || !value.trim()) {
		return undefined;
	}
	const raw = value.trim();
	const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
	try {
		const url = new URL(candidate);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return undefined;
		}
		return url.toString();
	} catch {
		return undefined;
	}
}

function postState(state: RelaxModeState): void {
	void settingsPanel?.webview.postMessage({ type: 'state', value: state });
	void modePanel?.webview.postMessage({ type: 'state', value: state });
}

function getSettingsHtmlMarkup(state: RelaxModeState): string {
	const serializedState = JSON.stringify(state).replace(/</g, '\\u003c');
	return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';"><style>${sharedStyle()} .settings{max-width:760px;margin:0 auto;padding:48px 28px 80px}.hero{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}.eyebrow{color:var(--vscode-textLink-foreground);font-size:12px;letter-spacing:.12em;font-weight:700}h1{font-size:30px;margin:8px 0}.hint{color:var(--vscode-descriptionForeground);line-height:1.6}.card{border:1px solid var(--vscode-editorWidget-border);border-radius:12px;padding:20px;margin-top:24px;background:var(--vscode-editorWidget-background,var(--vscode-editor-background))}.row{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:16px 0;border-bottom:1px solid var(--vscode-editorWidget-border)}.row:last-child{border-bottom:0}.status{padding:7px 11px;border-radius:999px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);font-size:12px}.actions{display:flex;gap:10px;margin-top:24px;flex-wrap:wrap}button{${buttonStyle()}}button.secondary{${secondaryButtonStyle()}}.relax-emoji{font-size:52px;filter:drop-shadow(0 8px 15px color-mix(in srgb,var(--vscode-textLink-foreground) 25%,transparent))}</style></head><body><main class="settings"><div class="hero"><div><div class="eyebrow">RELAX / EASTER EGG</div><h1>放松模式设置</h1><p class="hint">这里可以把 IDE 变成一个合法放松入口。普通编辑器、终端和题目功能不会被改变。</p></div><div class="relax-emoji">🌿</div></div><section class="card"><div class="row"><div><b>放松模式</b><div class="hint">启动后可以用快捷键一键隐藏/显示；隐藏时不会关闭放松源或 Integrated Browser 标签。</div></div><span class="status" id="status">尚未启动</span></div><div class="actions"><button id="openMain">启动/显示放松模式</button><button id="hide" class="secondary">隐藏放松模式</button><button id="shortcut" class="secondary">自定义快捷键</button></div><p class="hint">默认快捷键：Cmd/Ctrl + Alt + F。点击“自定义快捷键”可在 VS Code 键盘快捷方式中修改。</p></section><section class="card"><b>放松源在哪里管理？</b><p class="hint">进入放松模式主页后，可以添加任意 HTTP / HTTPS 网站。默认已经准备好 bilibili.com 和 poki.com。</p></section></main><script>const vscode=acquireVsCodeApi(),byId=id=>document.getElementById(id);function apply(state){byId('status').textContent=state.enabled?'已启动':'尚未启动'}byId('openMain').onclick=()=>vscode.postMessage({type:'openMain'});byId('hide').onclick=()=>vscode.postMessage({type:'hide'});byId('shortcut').onclick=()=>vscode.postMessage({type:'configureShortcut'});window.onmessage=e=>{if(e.data?.type==='state')apply(e.data.value)};apply(${serializedState});</script></body></html>`;
}

function getSettingsHtml(state: RelaxModeState): string {
	return getSettingsHtmlMarkup(state)
		.replace('启动后可以用快捷键一键隐藏/显示；隐藏时不会关闭放松源或 Integrated Browser 标签。', '快捷键会直接打开独立窗口中的放松网页；网页和网络连接会继续运行。')
		.replace('<button id="hide" class="secondary">隐藏放松模式</button>', '')
		.replace('默认快捷键：Cmd/Ctrl + Alt + F。点击“自定义快捷键”可在 VS Code 键盘快捷方式中修改。', '默认快捷键：Cmd/Ctrl + Alt + F。首次按下会在当前编辑组打开默认放松源；之后会回到同一个网页。')
		// eslint-disable-next-line local/code-no-unexternalized-strings
		.replace("byId('hide').onclick=()=>vscode.postMessage({type:'hide'});", '');
}

function getModeHtmlMarkup(state: RelaxModeState): string {
	const serializedState = JSON.stringify(state).replace(/</g, '\\u003c');
	return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';"><style>${sharedStyle()}body{overflow:auto}.mode{max-width:1050px;margin:0 auto;padding:42px 28px 70px}.hero{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:28px}.eyebrow{color:var(--vscode-textLink-foreground);font-size:12px;letter-spacing:.14em;font-weight:700}h1{font-size:36px;margin:8px 0}.hint{color:var(--vscode-descriptionForeground);line-height:1.6}.hero-actions,.actions{display:flex;gap:8px;flex-wrap:wrap}button{${buttonStyle()}}button.secondary{${secondaryButtonStyle()}}button.danger{color:var(--vscode-errorForeground);background:transparent}.status{padding:7px 11px;border-radius:999px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);font-size:12px;white-space:nowrap}.relax-pond{position:relative;min-height:110px;overflow:hidden;border:1px solid var(--vscode-editorWidget-border);border-radius:16px;padding:20px;margin:24px 0;background:linear-gradient(135deg,color-mix(in srgb,var(--vscode-textLink-foreground) 16%,var(--vscode-editor-background)),var(--vscode-editor-background))}.relax-pond:before,.relax-pond:after{content:'~';position:absolute;color:color-mix(in srgb,var(--vscode-textLink-foreground) 60%,transparent);font-size:56px;opacity:.45;animation:wave 4s ease-in-out infinite}.relax-pond:before{right:18%;top:10px}.relax-pond:after{right:42%;bottom:-5px;animation-delay:1.2s}@keyframes wave{50%{transform:translateX(18px) rotate(4deg)}}.relax{font-size:42px;animation:swim 5s ease-in-out infinite;display:inline-block}@keyframes swim{50%{transform:translateX(50px) translateY(-8px) rotate(-4deg)}}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(255px,1fr));gap:14px}.source{display:flex;flex-direction:column;min-height:150px;padding:18px;border:1px solid var(--vscode-editorWidget-border);border-radius:12px;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));box-shadow:0 10px 28px color-mix(in srgb,var(--vscode-editor-background) 65%,transparent)}.source h2{font-size:18px;margin:0 0 7px}.source-url{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vscode-descriptionForeground);font-size:12px}.source .actions{margin-top:auto;padding-top:22px;justify-content:space-between;align-items:center}.builtin{font-size:11px;color:var(--vscode-textLink-foreground)}.form-card{margin-top:25px;padding:18px;border:1px dashed var(--vscode-editorWidget-border);border-radius:12px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}label{display:block;color:var(--vscode-descriptionForeground);font-size:12px;margin-bottom:6px}input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--vscode-input-border);border-radius:5px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);font:inherit}.form-actions{display:flex;gap:8px;margin-top:12px;align-items:center}#error{color:var(--vscode-errorForeground);font-size:12px}.empty{color:var(--vscode-descriptionForeground);padding:28px;text-align:center}@media(max-width:650px){.hero{display:block}.hero-actions{margin-top:18px}.form-grid{grid-template-columns:1fr}}</style></head><body><main class="mode"><header class="hero"><div><div class="eyebrow">SHORTESTPATH / RELAX MODE</div><h1>放松模式 🌿</h1><p class="hint">写题累了就放松一会儿。点击一个放松源，它会在 Integrated Browser 中打开。</p></div><div class="hero-actions"><span class="status" id="status">放松模式已启动</span><button id="settings" class="secondary">放松设置</button><button id="hide" class="secondary">隐藏模式</button></div></header><section class="relax-pond"><span class="relax">🌿</span><p>今日放松宣言：编译器可以等，快乐不能等。</p></section><section><div class="hero"><div><h2>放松源</h2><p class="hint">默认源和自定义源都只会在 IDE 自己的浏览器标签中打开。</p></div><button id="reset" class="secondary">恢复默认源</button></div><div id="sources" class="grid"></div></section><section class="form-card"><b>添加新的放松源</b><div class="form-grid"><div><label for="name">名称（可选）</label><input id="name" placeholder="例如：知乎、猫猫图片"></div><div><label for="url">网站地址</label><input id="url" placeholder="https://example.com"></div></div><div class="form-actions"><button id="add">加入放松源</button><span id="error" role="status"></span></div></section></main><script>const vscode=acquireVsCodeApi(),byId=id=>document.getElementById(id);let state=${serializedState};const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));function render(){byId('status').textContent=state.enabled?'放松模式已启动':'放松模式尚未启动';const root=byId('sources');root.replaceChildren();if(!state.sources.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='还没有放松源，先添加一个吧。';root.append(empty);return}state.sources.forEach(source=>{const card=document.createElement('article');card.className='source';card.innerHTML='<h2>'+esc(source.name)+'</h2><div class="source-url" title="'+esc(source.url)+'">'+esc(source.url)+'</div><div class="actions"><span class="builtin">'+(source.builtin?'内置放松源':'自定义放松源')+'</span><span><button class="open">打开</button> <button class="danger remove">移除</button></span></div>';card.querySelector('.open').onclick=()=>vscode.postMessage({type:'openSource',id:source.id});card.querySelector('.remove').onclick=()=>vscode.postMessage({type:'removeSource',id:source.id});root.append(card)})}byId('add').onclick=()=>{byId('error').textContent='';vscode.postMessage({type:'addSource',name:byId('name').value,url:byId('url').value});};byId('reset').onclick=()=>vscode.postMessage({type:'resetSources'});byId('settings').onclick=()=>vscode.postMessage({type:'settings'});byId('hide').onclick=()=>vscode.postMessage({type:'hide'});window.onmessage=e=>{if(e.data?.type==='state'){state=e.data.value;render()}if(e.data?.type==='error')byId('error').textContent=e.data.message};render();</script></body></html>`;
}

function getModeHtml(state: RelaxModeState): string {
	return getModeHtmlMarkup(state)
		.replace('<button id="hide" class="secondary">隐藏模式</button>', '')
		// eslint-disable-next-line local/code-no-unexternalized-strings
		.replace("byId('hide').onclick=()=>vscode.postMessage({type:'hide'});", '');
}

function sharedStyle(): string {
	return 'body{margin:0;color:var(--vscode-foreground);background:var(--vscode-editor-background);font-family:var(--vscode-font-family)}button:focus,input:focus{outline:1px solid var(--vscode-focusBorder);outline-offset:1px}';
}

function buttonStyle(): string {
	return 'border:0;border-radius:6px;padding:8px 13px;font:inherit;cursor:pointer;color:var(--vscode-button-foreground);background:var(--vscode-button-background)';
}

function secondaryButtonStyle(): string {
	return 'color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)';
}

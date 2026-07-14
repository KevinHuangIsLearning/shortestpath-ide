import * as vscode from 'vscode';

type CppStandard = 'c++11' | 'c++14' | 'c++17' | 'c++20' | 'c++23';

type ThemeOption = {
	id: string;
	label: string;
};

const defaultCompilerFlags = `-std=c++23 -O2 -g -Wall -Wextra -D_GLIBCXX_DEBUG${process.platform === 'win32' ? ' -static' : ''}`;

type SimpleSettingsState = {
	fontFamily: string;
	fontLigatures: boolean;
	fontSize: number;
	cppStandard: CppStandard;
	compilerFlags: string;
	executableCleanupEnabled: boolean;
	executableCleanupDelaySeconds: number;
	colorTheme: string;
	autoDetectColorScheme: boolean;
	autoSave: string;
	themes: ThemeOption[];
};

export function registerSimpleSettings(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.openSettings', () => openSimpleSettings(context)));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.configureCppSnippets', () => openCppSnippets(context)));
}

const defaultCppSnippets = `{
	// Place your snippets for cpp here. Each snippet is defined under a snippet name and has a prefix, body and
	// description. The prefix is what is used to trigger the snippet and the body will be expanded and inserted. Possible variables are:
	// $1, $2 for tab stops, $0 for the final cursor position, and \${1:label}, \${2:another} for placeholders. Placeholders with the
	// same ids are connected.
	// Example:
	// "Print to console": {
	// \t"prefix": "log",
	// \t"body": [
	// \t\t"console.log('$1');",
	// \t\t"$2"
	// \t],
	// \t"description": "Log output to console"
	// }
	//
	// You can also restrict snippets to specific files using include/exclude patterns:
	// "Test snippet": {
	// \t"prefix": "test",
	// \t"body": "test('$1', () => {\\n\\t$0\\n});",
	// \t"include": ["**/*.test.ts", "*.spec.ts"],
	// \t"exclude": ["**/temp/*.ts"],
	// \t"description": "Insert test block"
	// }
}`;

type SnippetEntry = {
	name: string;
	prefix: string;
	body: string;
	description: string;
	include: string;
	exclude: string;
};

function getCppSnippetsFile(context: vscode.ExtensionContext): vscode.Uri {
	return vscode.Uri.joinPath(context.globalStorageUri, '..', '..', 'snippets', 'cpp.json');
}

async function ensureCppSnippetsFile(context: vscode.ExtensionContext): Promise<vscode.Uri> {
	const snippetsFile = getCppSnippetsFile(context);
	try {
		await vscode.workspace.fs.stat(snippetsFile);
	} catch {
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(context.globalStorageUri, '..', '..', 'snippets'));
		await vscode.workspace.fs.writeFile(snippetsFile, Buffer.from(defaultCppSnippets, 'utf8'));
	}
	return snippetsFile;
}

function parseJsonc(text: string): unknown {
	let result = '';
	let inString = false;
	let escaping = false;
	for (let index = 0; index < text.length; index++) {
		const character = text[index];
		if (inString) {
			result += character;
			if (escaping) {
				escaping = false;
			} else if (character === '\\') {
				escaping = true;
			} else if (character === '"') {
				inString = false;
			}
		} else if (character === '"') {
			inString = true;
			result += character;
		} else if (character === '/' && text[index + 1] === '/') {
			while (index < text.length && text[index] !== '\n') {
				index++;
			}
			result += '\n';
		} else if (character === '/' && text[index + 1] === '*') {
			index += 2;
			while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) {
				index++;
			}
			index++;
		} else {
			result += character;
		}
	}
	return JSON.parse(result);
}

async function readCppSnippets(context: vscode.ExtensionContext): Promise<SnippetEntry[]> {
	const snippetsFile = await ensureCppSnippetsFile(context);
	try {
		const parsed = parseJsonc(Buffer.from(await vscode.workspace.fs.readFile(snippetsFile)).toString('utf8'));
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return [];
		}
		return Object.entries(parsed).flatMap(([name, value]) => {
			if (!value || typeof value !== 'object' || Array.isArray(value)) {
				return [];
			}
			const snippet = value as Record<string, unknown>;
			const prefix = Array.isArray(snippet.prefix) ? snippet.prefix.join(', ') : snippet.prefix;
			const body = Array.isArray(snippet.body) ? snippet.body.join('\n') : snippet.body;
			return [{ name, prefix: typeof prefix === 'string' ? prefix : '', body: typeof body === 'string' ? body : '', description: typeof snippet.description === 'string' ? snippet.description : '', include: Array.isArray(snippet.include) ? snippet.include.join(', ') : '', exclude: Array.isArray(snippet.exclude) ? snippet.exclude.join(', ') : '' }];
		});
	} catch {
		void vscode.window.showWarningMessage('无法读取 cpp.json。请检查 JSON 格式。');
		return [];
	}
}

async function writeCppSnippets(context: vscode.ExtensionContext, entries: readonly SnippetEntry[]): Promise<void> {
	const snippets: Record<string, Record<string, unknown>> = {};
	for (const entry of entries) {
		const baseName = entry.name.trim() || 'Untitled Snippet';
		let name = baseName;
		let suffix = 2;
		while (snippets[name]) {
			name = `${baseName} ${suffix++}`;
		}
		const snippet: Record<string, unknown> = { prefix: entry.prefix.trim(), body: entry.body.split('\n') };
		if (entry.description.trim()) { snippet.description = entry.description.trim(); }
		const include = entry.include.split(',').map(value => value.trim()).filter(Boolean);
		if (include.length) { snippet.include = include; }
		const exclude = entry.exclude.split(',').map(value => value.trim()).filter(Boolean);
		if (exclude.length) { snippet.exclude = exclude; }
		snippets[name] = snippet;
	}
	await vscode.workspace.fs.writeFile(await ensureCppSnippetsFile(context), Buffer.from(`${JSON.stringify(snippets, undefined, '\t')}\n`, 'utf8'));
}

async function openCppSnippets(context: vscode.ExtensionContext): Promise<void> {
	const panel = vscode.window.createWebviewPanel('shortestpath.cppSnippets', 'C++ 代码模板', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
	panel.webview.html = getCppSnippetsHtml(await readCppSnippets(context));
	panel.webview.onDidReceiveMessage(async message => {
		if (message?.type === 'save' && Array.isArray(message.entries)) {
			await writeCppSnippets(context, message.entries as SnippetEntry[]);
		} else if (message?.type === 'openJson') {
			await vscode.window.showTextDocument(await ensureCppSnippetsFile(context), { preview: false });
		}
	}, undefined, context.subscriptions);
}

function openSimpleSettings(context: vscode.ExtensionContext): void {
	let isSaving = false;
	const panel = vscode.window.createWebviewPanel(
		'shortestpath.settings',
		'ShortestPath IDE 设置',
		vscode.ViewColumn.Active,
		{ enableScripts: true, retainContextWhenHidden: true }
	);
	panel.webview.html = getHtml(getState());
	panel.webview.onDidReceiveMessage(async message => {
		if (message?.type === 'save') {
			isSaving = true;
			try {
				await saveState(message.value);
			} finally {
				isSaving = false;
			}
		} else if (message?.type === 'advanced') {
			await vscode.commands.executeCommand('workbench.action.openSettings2');
		} else if (message?.type === 'snippets') {
			await vscode.commands.executeCommand('shortestpath.configureCppSnippets');
		}
	}, undefined, context.subscriptions);
	const configurationListener = vscode.workspace.onDidChangeConfiguration(event => {
		if (!isSaving && (event.affectsConfiguration('editor.fontFamily')
			|| event.affectsConfiguration('editor.fontLigatures')
			|| event.affectsConfiguration('editor.fontSize')
			|| event.affectsConfiguration('cph.language.cpp.Args')
			|| event.affectsConfiguration('c-cpp-compile-run.cpp-flags')
			|| event.affectsConfiguration('shortestpath.executableCleanupEnabled')
			|| event.affectsConfiguration('shortestpath.executableCleanupDelaySeconds')
			|| event.affectsConfiguration('workbench.colorTheme')
			|| event.affectsConfiguration('window.autoDetectColorScheme')
			|| event.affectsConfiguration('files.autoSave'))) {
			void panel.webview.postMessage({ type: 'state', value: getState() });
		}
	});
	panel.onDidDispose(() => configurationListener.dispose(), undefined, context.subscriptions);
}

function getState(): SimpleSettingsState {
	const editor = vscode.workspace.getConfiguration('editor');
	const files = vscode.workspace.getConfiguration('files');
	const workbench = vscode.workspace.getConfiguration('workbench');
	const windowConfiguration = vscode.workspace.getConfiguration('window');
	const cphFlags = vscode.workspace.getConfiguration('cph.language.cpp').get<string>('Args');
	const compileRunFlags = vscode.workspace.getConfiguration('c-cpp-compile-run').get<string>('cpp-flags');
	const compilerFlags = cphFlags || compileRunFlags || defaultCompilerFlags;
	const executableCleanupEnabled = vscode.workspace.getConfiguration('shortestpath').get<boolean>('executableCleanupEnabled') ?? true;
	const executableCleanupDelaySeconds = vscode.workspace.getConfiguration('shortestpath').get<number>('executableCleanupDelaySeconds') ?? 60;
	const colorTheme = workbench.get<string>('colorTheme') ?? 'Default Dark Modern';
	return {
		fontFamily: editor.get<string>('fontFamily') ?? '',
		fontLigatures: editor.get<boolean | string>('fontLigatures') === true || editor.get<boolean | string>('fontLigatures') === 'true',
		fontSize: editor.get<number>('fontSize') ?? 14,
		cppStandard: findCppStandard(compilerFlags),
		compilerFlags,
		executableCleanupEnabled,
		executableCleanupDelaySeconds,
		colorTheme,
		autoDetectColorScheme: windowConfiguration.get<boolean>('autoDetectColorScheme') ?? false,
		autoSave: files.get<string>('autoSave') ?? 'off',
		themes: getThemeOptions(colorTheme)
	};
}

function getThemeOptions(currentTheme: string): ThemeOption[] {
	const themes = new Map<string, string>([[currentTheme, currentTheme]]);
	for (const extension of vscode.extensions.all) {
		const contributedThemes = extension.packageJSON?.contributes?.themes;
		if (!Array.isArray(contributedThemes)) {
			continue;
		}
		for (const theme of contributedThemes) {
			if (typeof theme?.id === 'string') {
				themes.set(theme.id, typeof theme.label === 'string' ? theme.label : theme.id);
			}
		}
	}
	return [...themes].map(([id, label]) => ({ id, label })).sort((left, right) => left.label.localeCompare(right.label));
}

function findCppStandard(flags: string): CppStandard {
	const match = /-std=(?:gnu\+\+|c\+\+)(11|14|17|20|23)\b/.exec(flags);
	return match ? `c++${match[1]}` as CppStandard : 'c++23';
}

function applyCppStandard(flags: string, cppStandard: CppStandard): string {
	const withoutStandard = flags.replace(/(^|\s)-std=(?:gnu\+\+|c\+\+)\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
	return `-std=${cppStandard}${withoutStandard ? ` ${withoutStandard}` : ''}`;
}

async function saveState(value: Partial<SimpleSettingsState>): Promise<void> {
	const cppStandard = isCppStandard(value.cppStandard) ? value.cppStandard : 'c++23';
	const compilerFlags = applyCppStandard(typeof value.compilerFlags === 'string' ? value.compilerFlags : '', cppStandard);
	const executableCleanupDelaySeconds = typeof value.executableCleanupDelaySeconds === 'number'
		? Math.max(0, Math.min(86_400, Math.floor(value.executableCleanupDelaySeconds)))
		: 60;
	const settings = vscode.workspace.getConfiguration();
	await Promise.all([
		settings.update('editor.fontFamily', typeof value.fontFamily === 'string' ? value.fontFamily : '', vscode.ConfigurationTarget.Global),
		settings.update('editor.fontLigatures', value.fontLigatures === true, vscode.ConfigurationTarget.Global),
		settings.update('editor.fontSize', typeof value.fontSize === 'number' && value.fontSize > 0 ? value.fontSize : 14, vscode.ConfigurationTarget.Global),
		settings.update('cph.language.cpp.Args', compilerFlags, vscode.ConfigurationTarget.Global),
		settings.update('c-cpp-compile-run.cpp-flags', compilerFlags, vscode.ConfigurationTarget.Global),
		settings.update('shortestpath.executableCleanupEnabled', value.executableCleanupEnabled !== false, vscode.ConfigurationTarget.Global),
		settings.update('shortestpath.executableCleanupDelaySeconds', executableCleanupDelaySeconds, vscode.ConfigurationTarget.Global),
		settings.update('workbench.colorTheme', typeof value.colorTheme === 'string' ? value.colorTheme : 'Default Dark Modern', vscode.ConfigurationTarget.Global),
		settings.update('window.autoDetectColorScheme', value.autoDetectColorScheme === true, vscode.ConfigurationTarget.Global),
		settings.update('files.autoSave', typeof value.autoSave === 'string' ? value.autoSave : 'off', vscode.ConfigurationTarget.Global)
	]);
}

function isCppStandard(value: unknown): value is CppStandard {
	return value === 'c++11' || value === 'c++14' || value === 'c++17' || value === 'c++20' || value === 'c++23';
}

function getHtml(state: SimpleSettingsState): string {
	const serializedState = JSON.stringify(state).replace(/</g, '\\u003c');
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>ShortestPath IDE 设置</title>
<style>
body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); margin: 0; }
main { max-width: 760px; margin: 0 auto; padding: 40px 28px 64px; }
h1 { font-size: 28px; margin: 0 0 8px; } p { color: var(--vscode-descriptionForeground); margin: 0 0 28px; }
.card { border: 1px solid var(--vscode-editorWidget-border); border-radius: 8px; padding: 4px 20px; margin: 14px 0; }
.row { display: grid; grid-template-columns: 190px 1fr; gap: 18px; align-items: center; padding: 15px 0; border-bottom: 1px solid var(--vscode-editorWidget-border); }
.row:last-child { border: 0; } label { font-weight: 600; } .hint { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 4px; }
input, select { width: 100%; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 7px 9px; border-radius: 3px; font: inherit; }
input[type="checkbox"] { width: auto; transform: scale(1.15); } .toggle { display: flex; align-items: center; gap: 10px; }
.font-preview { color: var(--vscode-editor-foreground); background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-editorWidget-border); border-radius: 4px; font-size: 16px; line-height: 1.65; margin: -4px 0 14px 208px; padding: 10px 12px; white-space: pre; }
.fallback-list { display: grid; gap: 7px; }.fallback-row { display: grid; grid-template-columns: 1fr auto auto auto; gap: 6px; align-items: center; }.fallback-row .icon { min-width: 28px; padding: 5px; }.add-fallback { margin-top: 8px; }
.actions { display: flex; align-items: center; gap: 12px; margin-top: 24px; } button { border: 0; border-radius: 3px; padding: 8px 14px; font: inherit; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); } button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); } #saved { color: var(--vscode-testing-iconPassed); }
</style>
</head>
<body><main>
<h1>ShortestPath IDE 设置</h1><p>只保留竞赛编程常用选项。更改会自动保存；其他设置可在高级设置中调整。</p>
<section class="card">
<div class="row"><div><label for="fontFamily">代码字体</label><div class="hint">首选字体仅列出等宽字体。</div></div><select id="fontFamily"></select></div>
<div id="fontPreview" class="font-preview">#include &lt;bits/stdc++.h&gt;
int main() { std::cout &lt;&lt; "Hello, OI!"; }</div>
<div class="row"><div><label>回退字体</label><div class="hint">字形缺失时按顺序回退；可选择非等宽中文或 Emoji 字体。</div></div><div><div id="fallbackFonts" class="fallback-list"></div><button id="addFallback" class="secondary add-fallback" type="button">添加回退字体</button></div></div>
<div class="row"><div><label for="fontLigatures">启用字体连字</label></div><label class="toggle"><input id="fontLigatures" type="checkbox"><span>启用</span></label></div>
<div class="row"><div><label for="fontSize">字体大小</label></div><input id="fontSize" type="number" min="1" step="1"></div>
</section>
<section class="card">
<div class="row"><div><label for="cppStandard">C++ 版本</label></div><select id="cppStandard"><option>c++11</option><option>c++14</option><option>c++17</option><option>c++20</option><option>c++23</option></select></div>
<div class="row"><div><label for="compilerFlags">编译选项</label><div class="hint">同时应用到 CPH 和 C/C++ Compile Run。</div></div><input id="compilerFlags" type="text"></div>
<div class="row"><div><label for="executableCleanupEnabled">自动清理生成文件</label><div class="hint">同时作用于 CPH 和 C/C++ Compile Run。</div></div><label class="toggle"><input id="executableCleanupEnabled" type="checkbox"><span>启用</span></label></div>
<div class="row"><div><label for="executableCleanupDelaySeconds">生成文件保留时间</label><div class="hint">程序运行结束后自动删除 exe。单位：秒；0 表示立即删除。</div></div><input id="executableCleanupDelaySeconds" type="number" min="0" max="86400" step="1"></div>
</section>
<section class="card">
<div class="row"><div><label for="colorTheme">主题</label></div><select id="colorTheme"></select></div>
<div class="row"><div><label for="autoDetectColorScheme">同步系统主题</label></div><label class="toggle"><input id="autoDetectColorScheme" type="checkbox"><span>启用</span></label></div>
<div class="row"><div><label for="autoSave">自动保存</label></div><select id="autoSave"><option value="off">关闭</option><option value="afterDelay">延迟后自动保存</option><option value="onFocusChange">切换焦点时保存</option><option value="onWindowChange">切换窗口时保存</option></select></div>
</section>
<section class="card"><div class="row"><div><label>代码模板</label><div class="hint">配置 C++ 用户代码片段。</div></div><button id="snippets" class="secondary">配置代码模板</button></div></section>
<div class="actions"><button id="advanced" class="secondary">高级设置</button><span id="saved" aria-live="polite"></span></div>
</main>
<script>
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
const monospaceFonts = ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Cascadia Mono', 'Consolas', 'Menlo', 'Monaco', 'SF Mono', 'Source Code Pro', 'Ubuntu Mono', 'Roboto Mono', 'Iosevka', 'Hack', 'Inconsolata', 'DejaVu Sans Mono', 'Courier New', 'monospace'];
const fallbackFonts = ['PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC', 'WenQuanYi Micro Hei', 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', 'sans-serif'];
let selectedFonts = [];
const normalizeFont = font => font.trim().replace(/^['"]|['"]$/g, '');
const serializeFontStack = fonts => fonts.map(font => font === 'monospace' ? font : /\s/.test(font) ? '"' + font + '"' : font).join(', ');
function setPreview() { byId('fontPreview').style.fontFamily = serializeFontStack(selectedFonts); }
function addOptions(select, fonts, label) { const group = document.createElement('optgroup'); group.label = label; fonts.forEach(font => { const option = document.createElement('option'); option.value = font; option.textContent = font; option.style.fontFamily = serializeFontStack([font]); group.append(option); }); select.append(group); }
function fontSelect(font, allowFallback) { const select = document.createElement('select'); addOptions(select, monospaceFonts, '等宽字体'); if (allowFallback) addOptions(select, fallbackFonts, '回退字体（可非等宽）'); if (![...select.options].some(option => option.value === font)) { const custom = document.createElement('option'); custom.value = font; custom.textContent = font + '（当前自定义字体）'; select.prepend(custom); } select.value = font; select.style.fontFamily = serializeFontStack([font]); return select; }
function renderFonts() {
  const primary = byId('fontFamily'); primary.replaceChildren();
  const primarySelect = fontSelect(selectedFonts[0], false); [...primarySelect.children].forEach(child => primary.append(child)); primary.value = selectedFonts[0]; primary.style.fontFamily = serializeFontStack([selectedFonts[0]]);
  const fallback = byId('fallbackFonts'); fallback.replaceChildren();
  selectedFonts.slice(1).forEach((font, index) => { const row = document.createElement('div'); row.className = 'fallback-row'; const select = fontSelect(font, true); select.onchange = () => { selectedFonts[index + 1] = select.value; renderFonts(); setPreview(); save(0); }; const up = document.createElement('button'); up.type = 'button'; up.className = 'secondary icon'; up.textContent = '↑'; up.disabled = index === 0; up.onclick = () => { [selectedFonts[index], selectedFonts[index + 1]] = [selectedFonts[index + 1], selectedFonts[index]]; renderFonts(); setPreview(); save(0); }; const down = document.createElement('button'); down.type = 'button'; down.className = 'secondary icon'; down.textContent = '↓'; down.disabled = index === selectedFonts.length - 2; down.onclick = () => { [selectedFonts[index + 1], selectedFonts[index + 2]] = [selectedFonts[index + 2], selectedFonts[index + 1]]; renderFonts(); setPreview(); save(0); }; const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary icon'; remove.textContent = '×'; remove.onclick = () => { selectedFonts.splice(index + 1, 1); renderFonts(); setPreview(); save(0); }; row.append(select, up, down, remove); fallback.append(row); });
}
function apply(state) {
  selectedFonts = (state.fontFamily || '').split(',').map(normalizeFont).filter(Boolean);
  if (!selectedFonts.length) selectedFonts = ['Consolas', 'monospace'];
  byId('fontLigatures').checked = !!state.fontLigatures;
  byId('fontSize').value = state.fontSize;
  byId('cppStandard').value = state.cppStandard;
  byId('compilerFlags').value = state.compilerFlags;
  byId('executableCleanupEnabled').checked = !!state.executableCleanupEnabled;
  byId('executableCleanupDelaySeconds').value = state.executableCleanupDelaySeconds;
  const theme = byId('colorTheme'); theme.replaceChildren();
  state.themes.forEach(item => { const option = document.createElement('option'); option.value = item.id; option.textContent = item.label; theme.append(option); });
  theme.value = state.colorTheme;
  byId('autoDetectColorScheme').checked = !!state.autoDetectColorScheme;
  byId('autoSave').value = state.autoSave;
  setPreview(); renderFonts();
}
function value() { return { fontFamily: serializeFontStack(selectedFonts), fontLigatures: byId('fontLigatures').checked, fontSize: Number(byId('fontSize').value), cppStandard: byId('cppStandard').value, compilerFlags: byId('compilerFlags').value, executableCleanupEnabled: byId('executableCleanupEnabled').checked, executableCleanupDelaySeconds: Number(byId('executableCleanupDelaySeconds').value), colorTheme: byId('colorTheme').value, autoDetectColorScheme: byId('autoDetectColorScheme').checked, autoSave: byId('autoSave').value }; }
let saveTimer;
function save(delay) { clearTimeout(saveTimer); saveTimer = setTimeout(() => { vscode.postMessage({ type: 'save', value: value() }); byId('saved').textContent = '已自动保存'; setTimeout(() => byId('saved').textContent = '', 1200); }, delay); }
document.querySelectorAll('input, select').forEach(control => {
  const immediate = control.type === 'checkbox' || control.tagName === 'SELECT';
  control.addEventListener('input', () => save(immediate ? 0 : 250));
  control.addEventListener('change', () => save(0));
});
byId('fontFamily').addEventListener('change', () => { selectedFonts[0] = byId('fontFamily').value; setPreview(); save(0); });
byId('addFallback').addEventListener('click', () => { selectedFonts.push(fallbackFonts[0]); renderFonts(); setPreview(); save(0); });
byId('cppStandard').addEventListener('change', () => { const flags = byId('compilerFlags'); const standard = byId('cppStandard').value; const withoutStandard = flags.value.replace(/(^|\\s)-std=(?:gnu\\+\\+|c\\+\\+)\\d+\\b/g, ' ').replace(/\\s+/g, ' ').trim(); flags.value = '-std=' + standard + (withoutStandard ? ' ' + withoutStandard : ''); save(0); });
byId('advanced').addEventListener('click', () => vscode.postMessage({ type: 'advanced' }));
byId('snippets').addEventListener('click', () => vscode.postMessage({ type: 'snippets' }));
window.addEventListener('message', event => { if (event.data?.type === 'state') apply(event.data.value); });
apply(${serializedState});
</script></body></html>`;
}

function getCppSnippetsHtml(entries: readonly SnippetEntry[]): string {
	const serializedEntries = JSON.stringify(entries).replace(/</g, '\\u003c');
	return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); } main { display: grid; grid-template-columns: 230px minmax(0, 1fr); height: 100vh; }.sidebar { border-right: 1px solid var(--vscode-editorWidget-border); padding: 16px; overflow: auto; }.editor { padding: 30px; overflow: auto; max-width: 760px; }.header { display: flex; align-items: center; justify-content: space-between; gap: 8px; } h1 { font-size: 22px; margin: 0 0 6px; } h2 { font-size: 15px; margin: 22px 0 8px; } p { color: var(--vscode-descriptionForeground); margin: 0 0 14px; }.snippet { width: 100%; border: 0; border-radius: 3px; background: transparent; color: var(--vscode-foreground); text-align: left; padding: 8px; cursor: pointer; }.snippet:hover, .snippet.active { background: var(--vscode-list-hoverBackground); }.snippet small { display: block; color: var(--vscode-descriptionForeground); margin-top: 3px; } label { display: block; font-weight: 600; margin: 14px 0 6px; } input, textarea { width: 100%; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 3px; padding: 7px 9px; font: inherit; } textarea { min-height: 180px; resize: vertical; font-family: var(--vscode-editor-font-family); }.two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; } button { border: 0; border-radius: 3px; padding: 7px 10px; font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; } button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); } button.danger { color: var(--vscode-errorForeground); }.actions { display: flex; gap: 9px; margin-top: 22px; align-items: center; } #saved { color: var(--vscode-testing-iconPassed); }.empty { color: var(--vscode-descriptionForeground); padding: 28px 0; }
</style></head><body><main>
<aside class="sidebar"><div class="header"><strong>模板列表</strong><button id="add" title="新建模板">＋</button></div><div id="snippetList"></div></aside>
<section class="editor"><h1>C++ 代码模板</h1><p>更改会自动保存到 <code>cpp.json</code>。输入触发前缀后，可在 C++ 文件中使用补全展开模板。</p><div id="form"></div><div class="actions"><button id="delete" class="secondary danger">删除模板</button><button id="openJson" class="secondary">打开 JSON</button><span id="saved" aria-live="polite"></span></div></section>
</main><script>
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
let entries = ${serializedEntries};
let selected = entries.length ? 0 : -1;
let saveTimer;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { vscode.postMessage({ type: 'save', entries }); byId('saved').textContent = '已自动保存'; setTimeout(() => byId('saved').textContent = '', 1200); }, 250); }
function select(index) { selected = index; render(); }
function renderList() { const list = byId('snippetList'); list.replaceChildren(); entries.forEach((entry, index) => { const button = document.createElement('button'); button.className = 'snippet' + (index === selected ? ' active' : ''); button.textContent = entry.name || '未命名模板'; const prefix = document.createElement('small'); prefix.textContent = entry.prefix ? '触发：' + entry.prefix : '尚未设置触发前缀'; button.append(prefix); button.onclick = () => select(index); list.append(button); }); }
function field(label, key, multiline) { const wrapper = document.createElement('div'); const title = document.createElement('label'); title.textContent = label; const control = document.createElement(multiline ? 'textarea' : 'input'); control.value = entries[selected][key] || ''; control.oninput = () => { entries[selected][key] = control.value; if (key === 'name' || key === 'prefix') renderList(); save(); }; wrapper.append(title, control); return wrapper; }
function renderForm() { const form = byId('form'); form.replaceChildren(); if (selected < 0) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '还没有模板。点击左侧 ＋ 新建一个。'; form.append(empty); return; } form.append(field('模板名称', 'name'), field('触发前缀', 'prefix'), field('模板内容', 'body', true), field('说明（可选）', 'description')); const patterns = document.createElement('div'); patterns.className = 'two'; patterns.append(field('Include（逗号分隔，可选）', 'include'), field('Exclude（逗号分隔，可选）', 'exclude')); form.append(patterns); }
function render() { renderList(); renderForm(); byId('delete').disabled = selected < 0; }
byId('add').onclick = () => { entries.push({ name: '新模板', prefix: '', body: '', description: '', include: '', exclude: '' }); selected = entries.length - 1; render(); save(); };
byId('delete').onclick = () => { if (selected < 0) return; entries.splice(selected, 1); selected = Math.min(selected, entries.length - 1); render(); save(); };
byId('openJson').onclick = () => vscode.postMessage({ type: 'openJson' });
render();
</script></body></html>`;
}

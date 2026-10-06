/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { localize, localizeFormat, localizeWebviewHtml } from './localization';
import { getSystemFonts } from './systemFonts';
import { getCppSnippetsHtml, type SnippetEntry, type SnippetsState } from './snippetsView';
import { defaultCppTemplate, type PreviewToken } from './firstRunPreview';
import { installBundledCppSnippets } from './bundledSnippets';

export type CppStandard = 'c++11' | 'c++14' | 'c++17' | 'c++20' | 'c++23';

export type ThemeOption = {
	id: string;
	label: string;
};

export const defaultCompilerFlags = '-std=c++20 -O2 -g -Wall -Wextra -DDEBUG';
const fontPreviewSource = [
	'#include <bits/stdc++.h>',
	'',
	'int main() {',
	'  auto valid = [](int x) -> bool {',
	'    return x >= 0 && x <= 10 && x != 5;',
	'  };',
	'  for (int i = 0; i <= 10; ++i) {',
	'    if (valid(i) || i == 5) {',
	'      std::cout << i << " => OK\\n";',
	'    }',
	'  }',
	'}',
].join('\n');

type SimpleSettingsState = {
	fontFamily: string;
	fontLigatures: boolean;
	fontSize: number;
	autoFormat: boolean;
	cppStandard: CppStandard;
	compilerFlags: string;
	cppTemplate: string;
	clangdVariableTypeHints: boolean;
	errorLensCodeLensEnabled: boolean;
	executableCleanupEnabled: boolean;
	executableCleanupDelaySeconds: number;
	colorTheme: string;
	autoDetectColorScheme: boolean;
	autoSave: string;
	displayLanguage: string;
	useExtensionMarketplace: boolean;
	shortestPathCppSubmissionLanguage: string;
	defaultSubmitMethod: string;
	themes: ThemeOption[];
};

// A compact support action sits in the settings header. Dismissing it hides
// the action for a week; the deadline is persisted so
// it survives window reloads and restarts.
const buyMeACoffeeUrl = 'https://kevinhuang.feishu.cn/wiki/Z6a6w3M9riOFXXkXLAoc1G7inJd';
const buyMeACoffeeDismissedUntilKey = 'shortestpath.buyMeACoffee.dismissedUntil';
const buyMeACoffeeHideDuration = 7 * 24 * 60 * 60 * 1000;

function isBuyMeACoffeeVisible(context: vscode.ExtensionContext): boolean {
	const dismissedUntil = context.globalState.get<unknown>(buyMeACoffeeDismissedUntilKey);
	return typeof dismissedUntil !== 'number' || !Number.isFinite(dismissedUntil) || Date.now() >= dismissedUntil;
}

async function openBuyMeACoffeePage(): Promise<void> {
	try {
		await vscode.window.openBrowserTab(buyMeACoffeeUrl, { viewColumn: vscode.ViewColumn.Active, preserveFocus: false });
	} catch (error) {
		void vscode.window.showErrorMessage(localizeFormat('无法打开支持页面：{0}', error instanceof Error ? error.message : String(error)));
	}
}

// The documentation entry opens the ShortestPath IDE user guide in the
// system browser.
const documentationUrl = 'https://kevinhuang.feishu.cn/wiki/LLBBwJQQGil2NnkJXWxcAeaLndd';

async function openDocumentationPage(): Promise<void> {
	try {
		await vscode.env.openExternal(vscode.Uri.parse(documentationUrl));
	} catch (error) {
		void vscode.window.showErrorMessage(localizeFormat('无法打开文档页面：{0}', error instanceof Error ? error.message : String(error)));
	}
}

let snippetsPanel: vscode.WebviewPanel | undefined;
let settingsPanel: vscode.WebviewPanel | undefined;

export function registerSimpleSettings(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.openSettings', () => openSimpleSettings(context)));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.configureCppSnippets', () => openCppSnippets(context)));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.configureAutoFormat', () => openAutoFormatSettings()));
}

function defaultLanguageSnippets(language: string): string {
	return `{
	// Place your snippets for ${language} here. Each snippet is defined under a snippet name and has a prefix, body and
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
}

async function getSnippetsFile(language: string): Promise<vscode.Uri> {
	const snippetsHome = await vscode.commands.executeCommand<string>('_shortestpath.snippetsHome');
	if (!snippetsHome) { throw new Error('Current profile snippets directory is unavailable'); }
	return vscode.Uri.joinPath(vscode.Uri.parse(snippetsHome), `${language}.json`);
}

export async function initializeCppSnippets(context: vscode.ExtensionContext): Promise<void> {
	await installBundledCppSnippets((await getSnippetsFile('cpp')).fsPath, context.extensionPath);
}

async function ensureSnippetsFile(context: vscode.ExtensionContext, language: string): Promise<vscode.Uri> {
	const snippetsFile = await getSnippetsFile(language);
	try {
		await vscode.workspace.fs.stat(snippetsFile);
	} catch {
		if (language === 'cpp') {
			await initializeCppSnippets(context);
			return snippetsFile;
		}
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(snippetsFile, '..'));
		await vscode.workspace.fs.writeFile(snippetsFile, Buffer.from(defaultLanguageSnippets(language), 'utf8'));
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

async function readSnippets(context: vscode.ExtensionContext, language: string): Promise<SnippetEntry[]> {
	const snippetsFile = await ensureSnippetsFile(context, language);
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
		void vscode.window.showWarningMessage(localizeFormat('无法读取 {0}.json。请检查 JSON 格式。', language));
		return [];
	}
}

async function writeSnippets(context: vscode.ExtensionContext, language: string, entries: readonly SnippetEntry[]): Promise<void> {
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
	await vscode.workspace.fs.writeFile(await ensureSnippetsFile(context, language), Buffer.from(`${JSON.stringify(snippets, undefined, '\t')}\n`, 'utf8'));
}

async function openCppSnippets(context: vscode.ExtensionContext): Promise<void> {
	if (snippetsPanel) {
		snippetsPanel.reveal();
		return;
	}
	const language = 'cpp';
	const getTabSize = () => {
		const tabSize = vscode.workspace.getConfiguration('editor', { languageId: language }).get<unknown>('tabSize');
		return typeof tabSize === 'number' && tabSize > 0 ? tabSize : 2;
	};
	const state: SnippetsState = { language, tabSize: getTabSize(), entries: await readSnippets(context, language) };
	const panel = vscode.window.createWebviewPanel('shortestpath.cppSnippets', localize('代码片段'), vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
	context.subscriptions.push(panel);
	snippetsPanel = panel;
	const disposables: vscode.Disposable[] = [];
	panel.onDidDispose(() => {
		if (snippetsPanel === panel) { snippetsPanel = undefined; }
		for (const disposable of disposables) { disposable.dispose(); }
	}, undefined, context.subscriptions);
	let saves = Promise.resolve();
	disposables.push(panel.webview.onDidReceiveMessage(async message => {
		if (message?.type === 'save' && message.language === language && Array.isArray(message.entries)) {
			saves = saves.then(async () => {
				await writeSnippets(context, language, message.entries as SnippetEntry[]);
				await panel.webview.postMessage({ type: 'saved', revision: message.revision });
			}).catch(async error => {
				await panel.webview.postMessage({ type: 'saved', revision: message.revision, error: localizeFormat('无法保存模板：{0}', String(error)) });
			});
		} else if (message?.type === 'highlight' && typeof message.source === 'string' && typeof message.requestId === 'number') {
			try {
				const lines = await vscode.commands.executeCommand<PreviewToken[][]>('_shortestpath.cppPreviewTokens', message.source);
				if (!lines) { throw new Error(localize('无法加载代码预览。')); }
				await panel.webview.postMessage({ type: 'highlight', requestId: message.requestId, source: message.source, lines });
			} catch (error) {
				await panel.webview.postMessage({ type: 'highlight', requestId: message.requestId, source: message.source, error: localizeFormat('无法加载代码预览：{0}', String(error)) });
			}
		} else if (message?.type === 'confirmDelete' && message.language === language && typeof message.name === 'string' && typeof message.requestId === 'number') {
			const deleteLabel = localize('删除模板');
			const action = await vscode.window.showWarningMessage(
				localizeFormat('确定删除模板“{0}”吗？删除后会立即保存到 {1}.json。', message.name || localize('未命名模板'), message.language),
				{ modal: true },
				deleteLabel
			);
			await panel.webview.postMessage({ type: action === deleteLabel ? 'deleteConfirmed' : 'deleteCancelled', language, requestId: message.requestId });
		}
	}));
	const refreshHighlight = () => panel.webview.postMessage({ type: 'refreshHighlight', tabSize: getTabSize() });
	disposables.push(vscode.window.onDidChangeActiveColorTheme(refreshHighlight));
	disposables.push(vscode.workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration('editor')) { void refreshHighlight(); }
	}));
	panel.webview.html = localizeWebviewHtml(getCppSnippetsHtml(state, {
		title: localize('代码模板'), list: localize('模板列表'), add: localize('新建模板'), delete: localize('删除模板'),
		unnamed: localize('未命名模板'), newSnippet: localize('新模板'), prefixUnset: localize('尚未设置触发前缀'), prefixLabel: localize('触发：'),
		name: localize('模板名称'), description: localize('说明（可选）'), prefix: localize('触发前缀'), body: localize('模板内容'),
		intro: localize('更改会自动保存。输入触发前缀，可在 C++ 文件中展开模板。'), empty: localize('还没有模板。点击左侧 ＋ 新建一个。'),
		saving: localize('正在保存…'), saved: localize('已自动保存')
	}));
}

type AutoFormatState = {
	enabled: boolean;
	basedOnStyle: string;
	allowShortIfStatementsOnASingleLine: string;
	allowShortLoopsOnASingleLine: boolean;
	allowShortBlocksOnASingleLine: boolean;
	allowShortFunctionsOnASingleLine: string;
	columnLimit: number;
	indentWidth: number;
	tabWidth: number;
	useTab: string;
	accessModifierOffset: number;
	breakBeforeBraces: string;
	alwaysBreakTemplateDeclarations: string;
	pointerAlignment: string;
	spacesBeforeTrailingComments: number;
	separateDefinitionBlocks: string;
	standard: string;
};

const defaultAutoFormatState: AutoFormatState = {
	enabled: false,
	basedOnStyle: 'Google',
	allowShortIfStatementsOnASingleLine: 'AllIfsAndElse',
	allowShortLoopsOnASingleLine: true,
	allowShortBlocksOnASingleLine: true,
	allowShortFunctionsOnASingleLine: 'None',
	columnLimit: 0,
	indentWidth: 2,
	tabWidth: 2,
	useTab: 'Never',
	accessModifierOffset: -2,
	breakBeforeBraces: 'Attach',
	alwaysBreakTemplateDeclarations: 'No',
	pointerAlignment: 'Left',
	spacesBeforeTrailingComments: 4,
	separateDefinitionBlocks: 'Always',
	standard: 'Latest'
};

function getAutoFormatWorkspaceFolder(): vscode.Uri | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function readAutoFormatValue(content: string, key: string): string | undefined {
	const match = new RegExp(`^${key}:\\s*(.+?)\\s*(?:#.*)?$`, 'm').exec(content);
	return match?.[1]?.trim();
}

async function readAutoFormatState(workspaceFolder: vscode.Uri): Promise<AutoFormatState> {
	const tabSize = vscode.workspace.getConfiguration('editor', workspaceFolder).get<number>('tabSize') ?? 2;
	const state = { ...defaultAutoFormatState, indentWidth: tabSize, tabWidth: tabSize };
	state.enabled = vscode.workspace.getConfiguration('editor', null).get<boolean>('formatOnSave') === true
		&& vscode.workspace.getConfiguration('editor', null).get<boolean>('formatOnPaste') === true;
	try {
		const content = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(workspaceFolder, '.clang-format'))).toString('utf8');
		const stringKeys = [
			'basedOnStyle', 'allowShortIfStatementsOnASingleLine', 'allowShortFunctionsOnASingleLine', 'useTab',
			'breakBeforeBraces', 'alwaysBreakTemplateDeclarations', 'pointerAlignment', 'separateDefinitionBlocks', 'standard'
		] as const;
		const yamlKeys: Record<typeof stringKeys[number], string> = {
			basedOnStyle: 'BasedOnStyle', allowShortIfStatementsOnASingleLine: 'AllowShortIfStatementsOnASingleLine',
			allowShortFunctionsOnASingleLine: 'AllowShortFunctionsOnASingleLine', useTab: 'UseTab',
			breakBeforeBraces: 'BreakBeforeBraces', alwaysBreakTemplateDeclarations: 'AlwaysBreakTemplateDeclarations',
			pointerAlignment: 'PointerAlignment', separateDefinitionBlocks: 'SeparateDefinitionBlocks', standard: 'Standard'
		};
		for (const key of stringKeys) { state[key] = readAutoFormatValue(content, yamlKeys[key]) ?? state[key]; }
		const numberKeys = ['columnLimit', 'indentWidth', 'tabWidth', 'accessModifierOffset', 'spacesBeforeTrailingComments'] as const;
		const numberYamlKeys: Record<typeof numberKeys[number], string> = {
			columnLimit: 'ColumnLimit', indentWidth: 'IndentWidth', tabWidth: 'TabWidth',
			accessModifierOffset: 'AccessModifierOffset', spacesBeforeTrailingComments: 'SpacesBeforeTrailingComments'
		};
		for (const key of numberKeys) {
			const value = Number(readAutoFormatValue(content, numberYamlKeys[key]));
			if (Number.isFinite(value)) { state[key] = value; }
		}
		const booleanKeys = ['allowShortLoopsOnASingleLine', 'allowShortBlocksOnASingleLine'] as const;
		const booleanYamlKeys: Record<typeof booleanKeys[number], string> = {
			allowShortLoopsOnASingleLine: 'AllowShortLoopsOnASingleLine', allowShortBlocksOnASingleLine: 'AllowShortBlocksOnASingleLine'
		};
		for (const key of booleanKeys) {
			const value = readAutoFormatValue(content, booleanYamlKeys[key]);
			if (value === 'true' || value === 'false') { state[key] = value === 'true'; }
		}
	} catch {
		// A missing .clang-format simply uses ShortestPath IDE's defaults.
	}
	return state;
}

function autoFormatString(value: unknown, allowed: readonly string[], fallback: string): string {
	return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

function autoFormatNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.floor(value))) : fallback;
}

function normalizeAutoFormatState(value: Partial<AutoFormatState>): AutoFormatState {
	return {
		enabled: value.enabled === true,
		basedOnStyle: autoFormatString(value.basedOnStyle, ['Google', 'LLVM', 'Chromium', 'Mozilla', 'WebKit'], 'Google'),
		allowShortIfStatementsOnASingleLine: autoFormatString(value.allowShortIfStatementsOnASingleLine, ['Never', 'WithoutElse', 'OnlyFirstIf', 'AllIfsAndElse'], 'AllIfsAndElse'),
		allowShortLoopsOnASingleLine: value.allowShortLoopsOnASingleLine !== false,
		allowShortBlocksOnASingleLine: value.allowShortBlocksOnASingleLine !== false,
		allowShortFunctionsOnASingleLine: autoFormatString(value.allowShortFunctionsOnASingleLine, ['None', 'InlineOnly', 'Empty', 'Inline', 'All'], 'None'),
		columnLimit: autoFormatNumber(value.columnLimit, 0, 0, 10000),
		indentWidth: autoFormatNumber(value.indentWidth, vscode.workspace.getConfiguration('editor').get<number>('tabSize') ?? 2, 1, 32),
		tabWidth: autoFormatNumber(value.tabWidth, vscode.workspace.getConfiguration('editor').get<number>('tabSize') ?? 2, 1, 32),
		useTab: autoFormatString(value.useTab, ['Never', 'ForIndentation', 'ForContinuationAndIndentation', 'Always'], 'Never'),
		accessModifierOffset: autoFormatNumber(value.accessModifierOffset, -2, -32, 32),
		breakBeforeBraces: autoFormatString(value.breakBeforeBraces, ['Attach', 'Linux', 'Mozilla', 'Stroustrup', 'Allman', 'Whitesmiths', 'GNU', 'WebKit', 'Custom'], 'Attach'),
		alwaysBreakTemplateDeclarations: autoFormatString(value.alwaysBreakTemplateDeclarations, ['No', 'Yes', 'MultiLine'], 'No'),
		pointerAlignment: autoFormatString(value.pointerAlignment, ['Left', 'Right', 'Middle'], 'Left'),
		spacesBeforeTrailingComments: autoFormatNumber(value.spacesBeforeTrailingComments, 4, 0, 100),
		separateDefinitionBlocks: autoFormatString(value.separateDefinitionBlocks, ['Leave', 'Never', 'Always'], 'Always'),
		standard: autoFormatString(value.standard, ['Auto', 'c++03', 'c++11', 'c++14', 'c++17', 'c++20', 'Latest'], 'Latest')
	};
}

function serializeAutoFormat(state: AutoFormatState): string {
	return `BasedOnStyle: ${state.basedOnStyle}

# --- 行为：尽量允许一行写完 ---
AllowShortIfStatementsOnASingleLine: ${state.allowShortIfStatementsOnASingleLine}
AllowShortLoopsOnASingleLine: ${state.allowShortLoopsOnASingleLine}
AllowShortBlocksOnASingleLine: ${state.allowShortBlocksOnASingleLine}
AllowShortFunctionsOnASingleLine: ${state.allowShortFunctionsOnASingleLine}

# --- 行长（核心关键，不然上面全白给） ---
ColumnLimit: ${state.columnLimit}

# --- 缩进 ---
IndentWidth: ${state.indentWidth}
TabWidth: ${state.tabWidth}
UseTab: ${state.useTab}

# --- 访问修饰符 ---
AccessModifierOffset: ${state.accessModifierOffset}

# --- 大括号风格 ---
BreakBeforeBraces: ${state.breakBeforeBraces}
AlwaysBreakTemplateDeclarations: ${state.alwaysBreakTemplateDeclarations}

# --- 指针与注释 ---
PointerAlignment: ${state.pointerAlignment}
SpacesBeforeTrailingComments: ${state.spacesBeforeTrailingComments}

# --- 代码块间距 ---
SeparateDefinitionBlocks: ${state.separateDefinitionBlocks}

# --- 语言标准 ---
Standard: ${state.standard}
`;
}

async function openAutoFormatSettings(): Promise<void> {
	const workspaceFolder = getAutoFormatWorkspaceFolder();
	if (!workspaceFolder) {
		void vscode.window.showWarningMessage(localize('请先打开一个工作目录，再配置自动格式化。'));
		return;
	}
	const panel = vscode.window.createWebviewPanel('shortestpath.autoFormat', localize('自动格式化'), vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
	panel.webview.html = localizeWebviewHtml(getAutoFormatHtml(await readAutoFormatState(workspaceFolder), workspaceFolder.fsPath));
	panel.webview.onDidReceiveMessage(async message => {
		if (message?.type === 'save') {
			const state = normalizeAutoFormatState(message.value ?? {});
			await Promise.all([
				vscode.workspace.getConfiguration('editor', null).update('formatOnSave', state.enabled, vscode.ConfigurationTarget.Global),
				vscode.workspace.getConfiguration('editor', null).update('formatOnPaste', state.enabled, vscode.ConfigurationTarget.Global),
				vscode.workspace.fs.writeFile(vscode.Uri.joinPath(workspaceFolder, '.clang-format'), Buffer.from(serializeAutoFormat(state), 'utf8'))
			]);
		} else if (message?.type === 'openFile') {
			await vscode.window.showTextDocument(vscode.Uri.joinPath(workspaceFolder, '.clang-format'), { preview: false });
		}
	});
}

function openSimpleSettings(context: vscode.ExtensionContext): void {
	if (settingsPanel) {
		settingsPanel.reveal();
		return;
	}
	let isSaving = false;
	let isDisposed = false;
	const panel = vscode.window.createWebviewPanel(
		'shortestpath.settings',
		localize('ShortestPath IDE 设置'),
		vscode.ViewColumn.Active,
		{ enableScripts: true, retainContextWhenHidden: true }
	);
	context.subscriptions.push(panel);
	settingsPanel = panel;
	panel.webview.html = localizeWebviewHtml(getHtml(getState(), isBuyMeACoffeeVisible(context)));
	void getSystemFonts().then(async result => {
		if (isDisposed) {
			return;
		}
		try {
			const delivered = await panel.webview.postMessage({ type: 'systemFonts', value: result });
			if (!delivered && !isDisposed) {
				console.warn('ShortestPath settings webview did not accept the system font result.');
			}
		} catch (error) {
			if (!isDisposed) {
				console.warn('Failed to deliver system fonts to the ShortestPath settings webview.', error);
			}
		}
	});
	panel.webview.onDidReceiveMessage(async message => {
		if (message?.type === 'save') {
			isSaving = true;
			try {
				await saveState(message.value);
			} finally {
				isSaving = false;
			}
		} else if (message?.type === 'toggleExtensionMarketplace' && typeof message.enabled === 'boolean') {
			if (message.enabled) {
				const enableLabel = localize('我已了解并启用');
				const action = await vscode.window.showWarningMessage(
					localize('Open VSX 是独立的第三方插件市场。其内容不由 ShortestPath IDE 审核、担保或提供支持；安装第三方扩展可能执行代码并访问你的工作区数据。'),
					{
						modal: true,
						detail: localize('启用后，你需要自行判断扩展的来源、权限、安全性与许可证，并承担相应风险。')
					},
					enableLabel
				);
				if (action !== enableLabel) {
					await panel.webview.postMessage({ type: 'state', value: getState() });
					return;
				}
			}
			await vscode.workspace.getConfiguration(undefined, null).update('shortestpath.useExtensionMarketplace', message.enabled, vscode.ConfigurationTarget.Global);
		} else if (message?.type === 'advanced') {
			await vscode.commands.executeCommand('workbench.action.openSettings2');
		} else if (message?.type === 'fontPreview' && typeof message.requestId === 'number') {
			try {
				const lines = await vscode.commands.executeCommand<PreviewToken[][]>('_shortestpath.cppPreviewTokens', fontPreviewSource);
				if (!lines) { throw new Error(localize('无法加载代码预览。')); }
				if (!isDisposed) {
					await panel.webview.postMessage({ type: 'fontPreview', requestId: message.requestId, lines });
				}
			} catch (error) {
				if (!isDisposed) {
					await panel.webview.postMessage({ type: 'fontPreview', requestId: message.requestId, error: localizeFormat('无法加载代码预览：{0}', String(error)) });
				}
			}
		} else if (message?.type === 'configureLocale') {
			await vscode.commands.executeCommand('workbench.action.configureLocale');
		} else if (message?.type === 'gettingStarted') {
			panel.dispose();
			await vscode.commands.executeCommand('shortestpath.openGettingStarted');
		} else if (message?.type === 'openDocumentation') {
			await openDocumentationPage();
		} else if (message?.type === 'autoFormat') {
			await vscode.commands.executeCommand('shortestpath.configureAutoFormat');
		} else if (message?.type === 'toolchainDiagnostics') {
			panel.dispose();
			await vscode.commands.executeCommand('shortestpath.openToolchainDiagnostics');
		} else if (message?.type === 'cphSettings') {
			await vscode.commands.executeCommand('shortestpath.configureCph');
		} else if (message?.type === 'customSubmitScripts') {
			await vscode.commands.executeCommand('shortestpath.openCustomSubmitScripts');
		} else if (message?.type === 'checkForUpdates') {
			await panel.webview.postMessage({ type: 'checkForUpdatesStatus', status: 'checking' });
			try {
				const outcome = await vscode.commands.executeCommand<{ status: 'latest' | 'available' | 'failed'; version?: string; reason?: string }>('shortestpath.action.checkForUpdates', true);
				if (!outcome) {
					throw new Error(localize('更新检查命令未返回结果，可能是扩展尚未激活。'));
				}
				if (outcome.status === 'failed') {
					const message = localizeFormat('检查更新失败：{0}', outcome.reason ?? localize('未返回具体原因。'));
					console.error(message);
					void vscode.window.showErrorMessage(message);
					await panel.webview.postMessage({ type: 'checkForUpdatesStatus', status: 'failed', message });
					return;
				}
				const status = outcome.status;
				void vscode.window.showInformationMessage(outcome.status === 'latest'
					? localizeFormat('当前已是 ShortestPath IDE 最新版本（{0}）。', outcome.version ?? 'Unknown')
					: localizeFormat('发现 ShortestPath IDE 新版本（{0}），请查看更新窗口。', outcome.version ?? 'Unknown'));
				await panel.webview.postMessage({ type: 'checkForUpdatesStatus', status });
			} catch (error) {
				console.error('Failed to check for ShortestPath IDE updates.', error);
				const reason = error instanceof Error ? error.message : String(error);
				const message = localizeFormat('检查更新失败：{0}', reason);
				void vscode.window.showErrorMessage(message);
				await panel.webview.postMessage({ type: 'checkForUpdatesStatus', status: 'failed', message });
			}
		} else if (message?.type === 'buyMeACoffee') {
			await openBuyMeACoffeePage();
		} else if (message?.type === 'dismissBuyMeACoffee') {
			await context.globalState.update(buyMeACoffeeDismissedUntilKey, Date.now() + buyMeACoffeeHideDuration);
		}
	}, undefined, context.subscriptions);
	const configurationListener = vscode.workspace.onDidChangeConfiguration(event => {
		if (!isSaving && (event.affectsConfiguration('editor.fontFamily')
			|| event.affectsConfiguration('editor.fontLigatures')
			|| event.affectsConfiguration('editor.fontSize')
			|| event.affectsConfiguration('editor.formatOnSave')
			|| event.affectsConfiguration('editor.formatOnPaste')
			|| event.affectsConfiguration('judger.language.cpp.Args')
			|| event.affectsConfiguration('judger.language.cpp.Template')
			|| event.affectsConfiguration('c-cpp-compile-run.cpp-flags')
			|| event.affectsConfiguration('editor.inlayHints.enabled')
			|| event.affectsConfiguration('errorLens.codeLensEnabled')
			|| event.affectsConfiguration('shortestpath.executableCleanupEnabled')
			|| event.affectsConfiguration('shortestpath.executableCleanupDelaySeconds')
			|| event.affectsConfiguration('workbench.colorTheme')
			|| event.affectsConfiguration('window.autoDetectColorScheme')
			|| event.affectsConfiguration('files.autoSave')
			|| event.affectsConfiguration('shortestpath.useExtensionMarketplace'))) {
			void panel.webview.postMessage({ type: 'state', value: getState() });
		}
	});
	context.subscriptions.push(configurationListener);
	const themeListener = vscode.window.onDidChangeActiveColorTheme(() => {
		void panel.webview.postMessage({ type: 'refreshFontPreview' });
	});
	context.subscriptions.push(themeListener);
	panel.onDidDispose(() => {
		if (settingsPanel === panel) { settingsPanel = undefined; }
		isDisposed = true;
		configurationListener.dispose();
		themeListener.dispose();
	}, undefined, context.subscriptions);
}

function getState(): SimpleSettingsState {
	const editor = vscode.workspace.getConfiguration('editor', null);
	const files = vscode.workspace.getConfiguration('files', null);
	const workbench = vscode.workspace.getConfiguration('workbench', null);
	const windowConfiguration = vscode.workspace.getConfiguration('window', null);
	const cphFlags = vscode.workspace.getConfiguration('judger.language.cpp', null).get<string>('Args');
	const compileRunFlags = vscode.workspace.getConfiguration('c-cpp-compile-run', null).get<string>('cpp-flags');
	const compilerFlags = cphFlags || compileRunFlags || defaultCompilerFlags;
	const inlayHintsEnabled = editor.get<boolean | string>('inlayHints.enabled') ?? 'on';
	const errorLensCodeLensEnabled = vscode.workspace.getConfiguration('errorLens', null).get<boolean>('codeLensEnabled') ?? false;
	const executableCleanupEnabled = vscode.workspace.getConfiguration('shortestpath', null).get<boolean>('executableCleanupEnabled') ?? true;
	const executableCleanupDelaySeconds = vscode.workspace.getConfiguration('shortestpath', null).get<number>('executableCleanupDelaySeconds') ?? 60;
	const colorTheme = workbench.get<string>('colorTheme') ?? 'One Monokai';
	return {
		fontFamily: editor.get<string>('fontFamily') ?? '',
		fontLigatures: editor.get<boolean | string>('fontLigatures') === true || editor.get<boolean | string>('fontLigatures') === 'true',
		fontSize: editor.get<number>('fontSize') ?? 14,
		autoFormat: editor.get<boolean>('formatOnSave') === true && editor.get<boolean>('formatOnPaste') === true,
		cppStandard: findCppStandard(compilerFlags),
		compilerFlags,
		cppTemplate: vscode.workspace.getConfiguration('judger.language.cpp', null).get<string>('Template') ?? defaultCppTemplate,
		clangdVariableTypeHints: inlayHintsEnabled !== false && inlayHintsEnabled !== 'off',
		errorLensCodeLensEnabled,
		executableCleanupEnabled,
		executableCleanupDelaySeconds,
		colorTheme,
		autoDetectColorScheme: windowConfiguration.get<boolean>('autoDetectColorScheme') ?? false,
		autoSave: files.get<string>('autoSave') ?? 'off',
		displayLanguage: vscode.env.language,
		useExtensionMarketplace: vscode.workspace.getConfiguration('shortestpath', null).get<boolean>('useExtensionMarketplace') ?? false,
		shortestPathCppSubmissionLanguage: vscode.workspace.getConfiguration('shortestpath.oj', null).get<string>('cppSubmissionLanguage') ?? 'cpp20',
		defaultSubmitMethod: vscode.workspace.getConfiguration('judger.general', null).get<string>('defaultSubmitMethod') ?? 'ask',
		themes: getThemeOptions(colorTheme)
	};
}

export function getThemeOptions(currentTheme: string): ThemeOption[] {
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

export function findCppStandard(flags: string): CppStandard {
	const match = /-std=(?:gnu\+\+|c\+\+)(11|14|17|20|23)\b/.exec(flags);
	return match ? `c++${match[1]}` as CppStandard : 'c++20';
}

export function applyCppStandard(flags: string, cppStandard: CppStandard): string {
	const withoutStandard = flags.replace(/(^|\s)-std=(?:gnu\+\+|c\+\+)\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
	return `-std=${cppStandard}${withoutStandard ? ` ${withoutStandard}` : ''}`;
}

async function saveState(value: Partial<SimpleSettingsState>): Promise<void> {
	if (typeof value.cppTemplate === 'string' && value.cppTemplate.length > 100_000) {
		throw new Error(localize('模版内容无效或过长。'));
	}
	const cppStandard = isCppStandard(value.cppStandard) ? value.cppStandard : 'c++20';
	const compilerFlags = applyCppStandard(typeof value.compilerFlags === 'string' ? value.compilerFlags : '', cppStandard);
	const executableCleanupDelaySeconds = typeof value.executableCleanupDelaySeconds === 'number'
		? Math.max(0, Math.min(86_400, Math.floor(value.executableCleanupDelaySeconds)))
		: 60;
	const settings = vscode.workspace.getConfiguration(undefined, null);
	await Promise.all([
		settings.update('editor.fontFamily', typeof value.fontFamily === 'string' ? value.fontFamily : '', vscode.ConfigurationTarget.Global),
		settings.update('editor.fontLigatures', value.fontLigatures === true, vscode.ConfigurationTarget.Global),
		settings.update('editor.fontSize', typeof value.fontSize === 'number' && value.fontSize > 0 ? value.fontSize : 14, vscode.ConfigurationTarget.Global),
		settings.update('editor.formatOnSave', value.autoFormat === true, vscode.ConfigurationTarget.Global),
		settings.update('editor.formatOnPaste', value.autoFormat === true, vscode.ConfigurationTarget.Global),
		settings.update('judger.language.cpp.Args', compilerFlags, vscode.ConfigurationTarget.Global),
		...(typeof value.cppTemplate === 'string' ? [settings.update('judger.language.cpp.Template', value.cppTemplate, vscode.ConfigurationTarget.Global)] : []),
		settings.update('c-cpp-compile-run.cpp-flags', compilerFlags, vscode.ConfigurationTarget.Global),
		settings.update('editor.inlayHints.enabled', value.clangdVariableTypeHints !== false ? 'on' : 'off', vscode.ConfigurationTarget.Global),
		settings.update('errorLens.codeLensEnabled', value.errorLensCodeLensEnabled === true, vscode.ConfigurationTarget.Global),
		settings.update('shortestpath.executableCleanupEnabled', value.executableCleanupEnabled !== false, vscode.ConfigurationTarget.Global),
		settings.update('shortestpath.executableCleanupDelaySeconds', executableCleanupDelaySeconds, vscode.ConfigurationTarget.Global),
		settings.update('workbench.colorTheme', typeof value.colorTheme === 'string' ? value.colorTheme : 'One Monokai', vscode.ConfigurationTarget.Global),
		settings.update('window.autoDetectColorScheme', value.autoDetectColorScheme === true, vscode.ConfigurationTarget.Global),
		settings.update('window.systemColorTheme', 'auto', vscode.ConfigurationTarget.Global),
		settings.update('files.autoSave', typeof value.autoSave === 'string' ? value.autoSave : 'off', vscode.ConfigurationTarget.Global),
		settings.update('shortestpath.useExtensionMarketplace', value.useExtensionMarketplace === true, vscode.ConfigurationTarget.Global),
		settings.update('shortestpath.oj.cppSubmissionLanguage', value.shortestPathCppSubmissionLanguage === 'cpp14' || value.shortestPathCppSubmissionLanguage === 'cpp20' ? value.shortestPathCppSubmissionLanguage : 'ask', vscode.ConfigurationTarget.Global),
		settings.update('judger.general.defaultSubmitMethod', value.defaultSubmitMethod === 'vjudge' || value.defaultSubmitMethod === 'native' ? value.defaultSubmitMethod : 'ask', vscode.ConfigurationTarget.Global)
	]);
}

export function isCppStandard(value: unknown): value is CppStandard {
	return value === 'c++11' || value === 'c++14' || value === 'c++17' || value === 'c++20' || value === 'c++23';
}

function getHtml(state: SimpleSettingsState, showBuyMeACoffee: boolean): string {
	const serializedState = JSON.stringify(state).replace(/</g, '\\u003c');
	const previewText = fontPreviewSource.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const advancedLink = '<a id="advanced" href="#">' + localize('高级设置') + '</a>';
	const description = localizeFormat('只保留竞赛编程常用选项。更改会自动保存；其他设置可在{0}中调整。', advancedLink);
	const buyMeACoffeeHtml = showBuyMeACoffee
		? '<div class="support-actions" id="buyMeACoffee">'
		+ '<button id="openBuyMeACoffee" class="header-action support-action" type="button" aria-label="Buy Me a Coffee" aria-describedby="supportTooltip"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 5.5h8v5a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3zM10.5 6h1.5a2 2 0 0 1 0 4h-1.5M4 1.5v2m3-2v2m3-2v2M1.5 14.5h10"/></svg><span id="supportTooltip" class="action-tooltip" role="tooltip"><strong>Buy Me a Coffee</strong><span>如果 ShortestPath IDE 对你有帮助，欢迎支持项目持续维护与更新。</span></span></button>'
		+ '<button id="dismissBuyMeACoffee" class="header-action dismiss-support" type="button" title="7 天内不再显示" aria-label="7 天内不再显示"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg></button>'
		+ '</div>'
		: '';
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>ShortestPath IDE 设置</title>
<style>
body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); margin: 0; height: 100vh; overflow: hidden; }
main { box-sizing: border-box; display: grid; grid-template-columns: 156px minmax(0, 760px); grid-template-rows: auto minmax(0, 1fr); column-gap: 32px; row-gap: 28px; height: 100vh; max-width: 1010px; margin: 0 auto; padding: 28px; }
.settings-header { grid-column: 1 / -1; display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }.settings-header h1 { font-size: 22px; font-weight: 600; margin: 0 0 8px; }.settings-header p { color: var(--vscode-descriptionForeground); margin: 0; line-height: 1.5; }
.header-actions, .support-actions { display: flex; align-items: center; gap: 4px; flex: none; }.header-action { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; background: transparent; color: var(--vscode-foreground); border-radius: 4px; }.header-action:hover { background: var(--vscode-toolbar-hoverBackground); }.header-action svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.25; stroke-linecap: round; stroke-linejoin: round; }.dismiss-support { width: 24px; color: var(--vscode-descriptionForeground); }.dismiss-support svg { width: 12px; height: 12px; }
.documentation-action { color: var(--vscode-textLink-foreground); background: color-mix(in srgb, var(--vscode-textLink-foreground) 12%, transparent); }.support-action { color: var(--vscode-editorWarning-foreground); background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 12%, transparent); }
.action-tooltip { display: none; position: absolute; top: calc(100% + 8px); right: 0; z-index: 10; box-sizing: border-box; width: 240px; padding: 10px 12px; border: 1px solid var(--vscode-editorHoverWidget-border); border-radius: 6px; background: var(--vscode-editorHoverWidget-background); color: var(--vscode-editorHoverWidget-foreground); font-size: 12px; line-height: 1.5; text-align: left; white-space: normal; pointer-events: none; box-shadow: 0 4px 12px var(--vscode-widget-shadow); }.action-tooltip strong, .action-tooltip span { display: block; }.action-tooltip strong { margin-bottom: 4px; }.header-action:hover .action-tooltip, .header-action:focus-visible .action-tooltip { display: block; }
a { color: var(--vscode-textLink-foreground); text-decoration: none; } a:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; } a:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
.sidebar { align-self: start; }.categories { display: grid; gap: 4px; }.category { width: 100%; border: 1px solid transparent; border-radius: 4px; padding: 10px 12px; color: var(--vscode-foreground); background: transparent; text-align: left; font: inherit; cursor: pointer; }.category:hover { background: var(--vscode-list-hoverBackground); }.category.active { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-activeSelectionBackground); border-color: var(--vscode-contrastActiveBorder, transparent); }
.settings-content { min-width: 0; overflow-y: auto; padding-right: 4px; } h2 { font-size: 18px; font-weight: 600; margin: 0 0 16px; } h3 { font-size: 13px; font-weight: 600; color: var(--vscode-descriptionForeground); margin: 16px 0 0; }
.card { border: 1px solid var(--vscode-editorWidget-border); border-radius: 6px; padding: 0 20px; margin: 0 0 16px; }
.row { display: grid; grid-template-columns: 190px 1fr; gap: 20px; align-items: center; padding: 16px 0; border-bottom: 1px solid var(--vscode-editorWidget-border); }
.row:last-child { border: 0; } label { font-weight: 600; } .hint { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 4px; }
input, select { width: 100%; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 7px 9px; border-radius: 4px; font: inherit; }
textarea.code-template { display: block; box-sizing: border-box; width: 100%; min-height: 300px; margin-top: 12px; padding: 12px; resize: vertical; border: 1px solid var(--vscode-editorWidget-border); border-radius: 4px; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size, 14px); font-weight: var(--vscode-editor-font-weight, normal); line-height: 1.6; tab-size: 4; }
input[type="checkbox"] { width: auto; transform: scale(1.15); } .toggle { display: flex; align-items: center; gap: 10px; }
.font-preview { color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); border: 1px solid var(--vscode-editorWidget-border); border-radius: 4px; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size, 14px); font-weight: var(--vscode-editor-font-weight, normal); line-height: 1.6; margin: 12px 0 0; padding: 12px; white-space: pre; overflow-x: auto; }.row > div { min-width: 0; }
.row.disabled { opacity: .6; } .row.disabled input, .row.disabled select { cursor: not-allowed; } .update-actions { display: grid; gap: 8px; } .update-actions button { width: 100%; } .inline-status { display: block; color: var(--vscode-descriptionForeground); font-size: 12px; }
.actions { display: flex; align-items: center; gap: 12px; margin-top: 24px; } button { border: 0; border-radius: 4px; padding: 8px 14px; font: inherit; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); } button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); } #saved { color: var(--vscode-testing-iconPassed); }
[hidden] { display: none !important; } button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
@media (max-width: 900px) { .row { grid-template-columns: 1fr; gap: 8px; } }
@media (max-width: 600px) { main { grid-template-columns: 100px minmax(0, 1fr); column-gap: 16px; row-gap: 20px; padding: 16px; }.settings-header { gap: 12px; }.settings-header h1 { font-size: 18px; }.settings-header p { font-size: 12px; }.category { padding: 8px; }.card { padding: 0 12px; }.font-preview { overflow-x: auto; } }

</style>
</head>
<body><main>
<header class="settings-header"><div><h1>ShortestPath IDE 设置</h1><p>${description}</p></div><div class="header-actions"><button id="openDocumentation" class="header-action documentation-action" type="button" aria-label="查看文档" aria-describedby="documentationTooltip"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v11M8 3C6 1.5 3.5 1.5 1.5 2.5v10C3.5 11.5 6 11.5 8 13c2-1.5 4.5-1.5 6.5-.5v-10C12.5 1.5 10 1.5 8 3z"/></svg><span id="documentationTooltip" class="action-tooltip" role="tooltip"><strong>查看文档</strong><span>在外部浏览器中查看 ShortestPath IDE 的功能说明与使用教程。</span></span></button>${buyMeACoffeeHtml}</div></header>
<aside class="sidebar"><nav class="categories" aria-label="设置分类"><button class="category active" data-category="editor" aria-current="page" aria-controls="settingsContent">编辑器</button><button class="category" data-category="compiler" aria-controls="settingsContent">编译器</button><button class="category" data-category="tools" aria-controls="settingsContent">工具</button></nav></aside>
<div class="settings-content" id="settingsContent" role="region" aria-labelledby="categoryTitle">
<h2 id="categoryTitle">编辑器</h2>
<section class="card" data-category="editor"><h3>字体</h3>
<div class="row"><div><label for="fontFamily">代码字体</label><div class="hint">仅可从检测到的系统等宽字体中选择，不支持手动输入。</div></div><div id="fontControl" aria-busy="true"><select id="fontFamily" disabled aria-describedby="fontLoadStatus"><option>正在读取系统字体…</option></select><div id="fontLoadStatus" class="hint" role="status" aria-live="polite">正在读取系统字体，请稍候。</div><pre id="fontPreview" class="font-preview" data-i18n-ignore>${previewText}</pre><div id="fontPreviewStatus" class="hint" role="status"></div></div></div>
<div class="row"><div><label for="fontLigatures">启用字体连字</label><div id="fontLigaturesStatus" class="hint" role="status"></div></div><label class="toggle"><input id="fontLigatures" type="checkbox"><span>启用</span></label></div>
<div class="row"><div><label for="fontSize">字体大小</label></div><input id="fontSize" type="number" min="1" step="1"></div>
</section>
<section class="card" data-category="editor"><h3>外观与保存</h3>
<div class="row"><div><label for="colorTheme">主题</label></div><select id="colorTheme"></select></div>
<div class="row"><div><label>显示语言</label><div class="hint">当前：<span id="displayLanguage"></span>。选择后将按 VS Code 的正常流程确认并重启。</div></div><button id="configureLocale" class="secondary">切换显示语言</button></div>
<div class="row"><div><label for="autoDetectColorScheme">同步系统主题</label></div><label class="toggle"><input id="autoDetectColorScheme" type="checkbox"><span>启用</span></label></div>
<div class="row"><div><label for="autoSave">自动保存</label></div><select id="autoSave"><option value="off">关闭</option><option value="afterDelay">延迟后自动保存</option><option value="onFocusChange">切换焦点时保存</option><option value="onWindowChange">切换窗口时保存</option></select></div>
</section>
<section class="card" data-category="editor"><h3>编辑行为</h3>
<div class="row"><div><label for="autoFormat">启用自动格式化</label><div class="hint">同时控制保存时格式化和粘贴时格式化。</div></div><label class="toggle"><input id="autoFormat" type="checkbox"><span>启用</span></label></div>
<div class="row"><div><label>自动格式化规则</label><div class="hint">配置当前工作目录的 .clang-format。</div></div><button id="autoFormatSettings" class="secondary">配置格式化规则</button></div>
<div class="row"><div><label for="clangdVariableTypeHints">clangd 变量类型提示</label><div class="hint">在 auto 等推断变量后显示类型；此开关使用 VS Code 的内嵌提示设置。</div></div><label class="toggle"><input id="clangdVariableTypeHints" type="checkbox"><span>启用</span></label></div>
<div class="row"><div><label for="errorLensCodeLensEnabled">Error Lens Code Lens</label><div class="hint">在诊断位置上方显示 Error Lens 的代码透镜。</div></div><label class="toggle"><input id="errorLensCodeLensEnabled" type="checkbox"><span>启用</span></label></div>
</section>
<section class="card" data-category="compiler" hidden><h3>编译与运行</h3>
<div class="row"><div><label for="cppStandard">C++ 版本</label></div><select id="cppStandard"><option>c++11</option><option>c++14</option><option>c++17</option><option>c++20</option><option>c++23</option></select></div>
<div class="row"><div><label for="compilerFlags">编译选项</label><div class="hint">同时应用到 Judger 和 C/C++ Compile Run。</div></div><input id="compilerFlags" type="text"></div>
<div class="row"><div><label for="executableCleanupEnabled">自动清理生成文件</label><div class="hint">同时作用于 Judger 和 C/C++ Compile Run。</div></div><label class="toggle"><input id="executableCleanupEnabled" type="checkbox"><span>启用</span></label></div>
<div class="row"><div><label for="executableCleanupDelaySeconds">生成文件保留时间</label><div class="hint">程序运行结束后自动删除 exe。单位：秒；0 表示立即删除。</div></div><input id="executableCleanupDelaySeconds" type="number" min="0" max="86400" step="1"></div>
</section>
<section class="card" data-category="compiler" hidden><h3>工具链诊断</h3>
<div class="row"><div><label>工具链诊断</label><div class="hint">检查 Judger、Compile Run、clangd 与编译器是否可用且配置一致。</div></div><button id="toolchainDiagnostics" class="secondary">打开诊断页</button></div>
</section>
<section class="card" data-category="tools" hidden><h3>新建文件</h3>
<div class="row"><div><label for="cppTemplate">默认代码模板</label><div class="hint">Judger 新建 C++ 文件时会自动填入这份模版。</div></div><textarea id="cppTemplate" class="code-template" wrap="off" spellcheck="false" maxlength="100000" data-i18n-ignore></textarea></div>
</section>
<section class="card" data-category="tools" hidden><h3>提交与评测</h3>
<div class="row"><div><label>Judger 设置</label><div class="hint">配置题目下载、Judge、VJudge 与 Judger 编译运行行为。</div></div><button id="cphSettings" class="secondary">配置 Judger</button></div><div class="row"><div><label>Judger 自定义提交脚本</label><div class="hint">按 OJ 配置提交页面 URL 和 JavaScript，点击 Judger 提交按钮时打开并填写表单。</div></div><button id="customSubmitScripts" class="secondary">配置提交脚本</button></div><div class="row"><div><label for="shortestPathCppSubmissionLanguage">ShortestPath OJ 提交语言</label><div class="hint">“每次询问”会在 C++ 提交前选择 C++14 或 C++20。</div></div><select id="shortestPathCppSubmissionLanguage"><option value="ask">每次询问</option><option value="cpp14">C++14</option><option value="cpp20">C++20</option></select></div>
<div class="row"><div><label for="defaultSubmitMethod">Judger 默认提交方式</label><div class="hint">当原 OJ 提交和 VJudge 提交都可用时使用；单独 OJ 的自定义脚本不受影响。</div></div><select id="defaultSubmitMethod"><option value="ask">每次询问</option><option value="vjudge">VJudge</option><option value="native">原 OJ</option></select></div>
</section>
<section class="card" data-category="tools" hidden><h3>应用管理</h3>
<div class="row"><div><label for="useExtensionMarketplace">使用插件市场</label><div class="hint">开启后显示扩展入口，并使用 Open VSX 插件市场。</div></div><label class="toggle"><input id="useExtensionMarketplace" type="checkbox"><span>启用</span></label></div><div class="row"><div><label>初始配置</label><div class="hint">检查编译环境并配置编辑器、模版和代码存放目录。</div></div><button id="gettingStarted" class="secondary">打开引导</button></div><div class="row"><div><label>ShortestPath IDE 更新</label><div class="hint">立即检查新版本，并在可用时打开下载页面。</div></div><div class="update-actions"><button id="checkForUpdates" class="secondary">检查更新</button><span id="checkForUpdatesStatus" class="inline-status" aria-live="polite"></span></div></div>
</section>
<div class="actions"><span id="saved" aria-live="polite"></span></div>
</div>
</main>
<script>
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
let systemFonts = [];
let monospaceSystemFonts = [];
let fontLoadError = '';
let fontLoadComplete = false;
let fontDetectionInProgress = false;
let fontDetectionGeneration = 0;
let selectedFont = 'monospace';
let preferCodeFont = true;
let selectedCategory = 'editor';
const normalizeFont = font => font.trim().replace(/^['"]|['"]$/g, '');
const serializeFont = font => font === 'monospace' ? font : JSON.stringify(font);
function codeFontPriority(font) {
  const family = font.toLowerCase();
  if (family === 'fira code') return 0;
  if (family.startsWith('fira code ')) return 1;
  if (family === 'dejavu sans mono') return 2;
  if (family.startsWith('dejavu')) return 3;
  return 4;
}
function selectCategory(category) {
  selectedCategory = category;
  document.querySelectorAll('section.card[data-category]').forEach(card => { card.hidden = card.dataset.category !== selectedCategory; });
  document.querySelectorAll('.category').forEach(button => {
    const active = button.dataset.category === selectedCategory;
    button.classList.toggle('active', active);
    if (active) {
      button.setAttribute('aria-current', 'page');
      byId('categoryTitle').textContent = button.textContent;
    } else {
      button.removeAttribute('aria-current');
    }
  });
  byId('settingsContent').scrollTop = 0;
}
function setPreview() {
  const preview = byId('fontPreview');
  preview.style.fontFamily = serializeFont(selectedFont);
  preview.style.fontVariantLigatures = byId('fontLigatures').checked ? 'normal' : 'none';
  const size = Number(byId('fontSize').value);
  if (Number.isFinite(size) && size > 0) preview.style.fontSize = size + 'px';
  const template = byId('cppTemplate');
  template.style.fontFamily = preview.style.fontFamily;
  template.style.fontVariantLigatures = preview.style.fontVariantLigatures;
  template.style.fontSize = preview.style.fontSize;
}
let fontPreviewRequest = 0;
function requestFontPreview() { byId('fontPreview').textContent = ${JSON.stringify(fontPreviewSource)}; vscode.postMessage({ type: 'fontPreview', requestId: ++fontPreviewRequest }); }
function applyFontPreview(message) {
  if (message.requestId !== fontPreviewRequest) return;
  if (message.error) { byId('fontPreviewStatus').textContent = message.error; return; }
  const preview = byId('fontPreview');
  preview.replaceChildren();
  message.lines.forEach((line, index) => {
    if (index) preview.append(document.createTextNode('\\n'));
    line.forEach(token => { const span = document.createElement('span'); span.textContent = token.text; span.style.cssText = token.style; preview.append(span); });
  });
  byId('fontPreviewStatus').textContent = '';
}

function addOptions(select, fonts, label) { const group = document.createElement('optgroup'); group.label = label; fonts.forEach(font => { const option = document.createElement('option'); option.value = font; option.textContent = font; option.style.fontFamily = serializeFont(font); group.append(option); }); select.append(group); }
function isMonospaceFont(font, context) { context.font = '16px ' + serializeFont(font); return Math.abs(context.measureText('iiiiiiiiii').width - context.measureText('WWWWWWWWWW').width) < 0.01; }
async function supportsLigatures(font) {
  const stack = serializeFont(font);
  const size = 48;
  try { await document.fonts.load(size + 'px ' + stack); } catch (error) { }
  const probe = document.createElement('canvas');
  probe.width = 240; probe.height = 96;
  const context = probe.getContext('2d');
  if (!context) return false;
  context.font = size + 'px ' + stack;
  const composed = document.createElement('canvas');
  composed.width = probe.width; composed.height = probe.height;
  const composedContext = composed.getContext('2d');
  if (!composedContext) return false;
  composedContext.font = size + 'px ' + stack;
  const cell = composedContext.measureText('M').width;
  const probes = ['->', '=>', '>=', '<=', '!=', '==', ':=', '&&', '||', 'ffi'];
  for (let index = 0; index < probes.length; index++) {
    const text = probes[index];
    composedContext.clearRect(0, 0, composed.width, composed.height);
    for (let charIndex = 0; charIndex < text.length; charIndex++) {
      composedContext.fillText(text[charIndex], charIndex * cell, size);
    }
    context.clearRect(0, 0, probe.width, probe.height);
    context.fillText(text, 0, size);
    const singleData = context.getImageData(0, 0, probe.width, probe.height).data;
    const composedData = composedContext.getImageData(0, 0, composed.width, composed.height).data;
    let difference = 0;
    for (let pixel = 0; pixel < singleData.length; pixel += 4) {
      if (singleData[pixel] !== composedData[pixel] || singleData[pixel + 1] !== composedData[pixel + 1] || singleData[pixel + 2] !== composedData[pixel + 2] || singleData[pixel + 3] !== composedData[pixel + 3]) {
        difference++;
        if (difference > 8) return true;
      }
    }
  }
  return false;
}
let ligatureGeneration = 0;
async function updateLigatureSupport() {
  const generation = ++ligatureGeneration;
  const checkbox = byId('fontLigatures');
  const status = byId('fontLigaturesStatus');
  const row = checkbox.closest('.row');
  const supported = await supportsLigatures(selectedFont);
  if (generation !== ligatureGeneration) return;
  checkbox.disabled = !supported;
  row.classList.toggle('disabled', !supported);
  if (supported) {
    status.textContent = '';
    return;
  }
  if (checkbox.checked) checkbox.checked = false;
  setPreview();
  status.textContent = '当前字体不支持连字，无法启用。';
}
async function getMonospaceFonts(fonts) {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return [];
  const result = [];
  const batchSize = 40;
  for (let index = 0; index < fonts.length; index += batchSize) {
    fonts.slice(index, index + batchSize).forEach(font => { if (isMonospaceFont(font, context)) result.push(font); });
    if (index + batchSize < fonts.length) {
      await new Promise(resolve => {
        const schedule = globalThis.requestAnimationFrame ?? (callback => setTimeout(callback, 0));
        schedule(resolve);
      });
    }
  }
  return result;
}
function fontSelect(font, fonts, label) {
  const select = document.createElement('select');
  addOptions(select, fonts, label);
  const hasFont = fonts.includes(font);
  if (!hasFont) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '当前代码字体不是等宽字体，请选择';
    placeholder.disabled = true;
    select.prepend(placeholder);
  }
  select.value = hasFont ? font : '';
  select.disabled = !fonts.length;
  select.style.fontFamily = serializeFont(font);
  return select;
}
function renderFonts() {
  const primary = byId('fontFamily');
  primary.replaceChildren();
  const status = byId('fontLoadStatus');
  const isLoading = !fontLoadComplete && !fontLoadError;
  byId('fontControl').setAttribute('aria-busy', String(isLoading));
  if (!fontLoadComplete) {
    const loadingOption = document.createElement('option');
    loadingOption.textContent = fontDetectionInProgress ? '正在检测系统等宽字体…' : '正在读取系统字体…';
    primary.append(loadingOption);
    primary.disabled = true;
    status.textContent = fontDetectionInProgress
      ? '正在检测 ' + systemFonts.length + ' 个系统字体中的等宽字体，请稍候。'
      : '正在读取系统字体，请稍候。';
    void updateLigatureSupport();
    return;
  }
  const primarySelect = fontSelect(selectedFont, monospaceSystemFonts, '系统等宽字体');
  const primaryValue = primarySelect.value;
  [...primarySelect.children].forEach(child => primary.append(child));
  primary.value = primaryValue;
  primary.disabled = !monospaceSystemFonts.length;
  primary.style.fontFamily = serializeFont(selectedFont);
  status.textContent = fontLoadError
    ? fontLoadError
    : !systemFonts.length
      ? '未发现可用的系统字体，无法选择代码字体。'
      : !monospaceSystemFonts.length
        ? '未发现可用的系统等宽字体，无法选择代码字体。'
        : '已检测到 ' + monospaceSystemFonts.length + ' 个系统等宽字体。';
  void updateLigatureSupport();
}
async function applySystemFonts(result) {
  const generation = ++fontDetectionGeneration;
  systemFonts = result.fonts;
  monospaceSystemFonts = [];
  fontLoadError = result.error || '';
  fontLoadComplete = false;
  fontDetectionInProgress = false;
  if (fontLoadError || !systemFonts.length) {
    fontLoadComplete = true;
    renderFonts();
    return;
  }
  fontDetectionInProgress = true;
  renderFonts();
  let fontChanged = false;
  try {
    const detectedFonts = await getMonospaceFonts(systemFonts);
    if (generation !== fontDetectionGeneration) return;
    monospaceSystemFonts = detectedFonts.sort((left, right) => codeFontPriority(left) - codeFontPriority(right) || left.localeCompare(right));
    fontChanged = preferCodeFont && monospaceSystemFonts.includes(selectedFont);
    const preferred = monospaceSystemFonts.find(font => codeFontPriority(font) < 4);
    if (preferred && (preferCodeFont || !monospaceSystemFonts.includes(selectedFont))) {
      fontChanged = fontChanged || selectedFont !== preferred;
      selectedFont = preferred;
      preferCodeFont = false;
      setPreview();
    }
  } catch {
    if (generation !== fontDetectionGeneration) return;
    fontLoadError = '检测系统等宽字体时出现错误。';
  } finally {
    if (generation === fontDetectionGeneration) {
      fontDetectionInProgress = false;
      fontLoadComplete = true;
      renderFonts();
      if (fontChanged) {
        const font = selectedFont;
        await updateLigatureSupport();
        if (generation === fontDetectionGeneration && font === selectedFont) save(0);
      }
    }
  }
}
function apply(state) {
  const fonts = (state.fontFamily || '').split(',').map(normalizeFont).filter(Boolean);
  selectedFont = fonts[0] || 'monospace';
  preferCodeFont = fonts.length !== 1 || selectedFont === 'monospace';
  byId('fontLigatures').checked = !!state.fontLigatures;
  byId('fontSize').value = state.fontSize;
	byId('autoFormat').checked = !!state.autoFormat;
  byId('cppStandard').value = state.cppStandard;
	byId('shortestPathCppSubmissionLanguage').value = state.shortestPathCppSubmissionLanguage;
	byId('defaultSubmitMethod').value = state.defaultSubmitMethod;
  byId('compilerFlags').value = state.compilerFlags;
  byId('cppTemplate').value = state.cppTemplate ?? '';
  byId('clangdVariableTypeHints').checked = !!state.clangdVariableTypeHints;
  byId('errorLensCodeLensEnabled').checked = !!state.errorLensCodeLensEnabled;
  byId('executableCleanupEnabled').checked = !!state.executableCleanupEnabled;
  byId('executableCleanupDelaySeconds').value = state.executableCleanupDelaySeconds;
  const theme = byId('colorTheme'); theme.replaceChildren();
  state.themes.forEach(item => { const option = document.createElement('option'); option.value = item.id; option.textContent = item.label; theme.append(option); });
  theme.value = state.colorTheme;
	byId('displayLanguage').textContent = state.displayLanguage === 'zh-cn' ? '中文（简体）' : state.displayLanguage === 'en' ? 'English' : state.displayLanguage;
  byId('autoDetectColorScheme').checked = !!state.autoDetectColorScheme;
  byId('autoSave').value = state.autoSave;
	byId('useExtensionMarketplace').checked = !!state.useExtensionMarketplace;
  setPreview(); renderFonts();
}
function value() { return { fontFamily: serializeFont(selectedFont), fontLigatures: byId('fontLigatures').checked, fontSize: Number(byId('fontSize').value), autoFormat: byId('autoFormat').checked, cppStandard: byId('cppStandard').value, shortestPathCppSubmissionLanguage: byId('shortestPathCppSubmissionLanguage').value, defaultSubmitMethod: byId('defaultSubmitMethod').value, compilerFlags: byId('compilerFlags').value, cppTemplate: byId('cppTemplate').value, clangdVariableTypeHints: byId('clangdVariableTypeHints').checked, errorLensCodeLensEnabled: byId('errorLensCodeLensEnabled').checked, executableCleanupEnabled: byId('executableCleanupEnabled').checked, executableCleanupDelaySeconds: Number(byId('executableCleanupDelaySeconds').value), colorTheme: byId('colorTheme').value, autoDetectColorScheme: byId('autoDetectColorScheme').checked, autoSave: byId('autoSave').value, useExtensionMarketplace: byId('useExtensionMarketplace').checked }; }
let saveTimer;
function save(delay) { clearTimeout(saveTimer); saveTimer = setTimeout(() => { vscode.postMessage({ type: 'save', value: value() }); byId('saved').textContent = '已自动保存'; setTimeout(() => byId('saved').textContent = '', 1200); }, delay); }
document.querySelectorAll('input:not(#fontFamily):not(#useExtensionMarketplace), select:not(#fontFamily), textarea').forEach(control => {
  const immediate = control.type === 'checkbox' || control.tagName === 'SELECT';
  control.addEventListener('input', () => save(immediate ? 0 : 250));
  control.addEventListener('change', () => save(0));
});
byId('useExtensionMarketplace').addEventListener('change', () => vscode.postMessage({ type: 'toggleExtensionMarketplace', enabled: byId('useExtensionMarketplace').checked }));
byId('fontFamily').addEventListener('change', async () => { selectedFont = byId('fontFamily').value; preferCodeFont = false; setPreview(); await updateLigatureSupport(); save(0); });
byId('fontLigatures').addEventListener('change', () => setPreview());
byId('fontSize').addEventListener('input', () => setPreview());
byId('cppStandard').addEventListener('change', () => { const flags = byId('compilerFlags'); const standard = byId('cppStandard').value; const withoutStandard = flags.value.replace(/(^|\\s)-std=(?:gnu\\+\\+|c\\+\\+)\\d+\\b/g, ' ').replace(/\\s+/g, ' ').trim(); flags.value = '-std=' + standard + (withoutStandard ? ' ' + withoutStandard : ''); save(0); });
document.querySelectorAll('.category').forEach(button => button.addEventListener('click', () => selectCategory(button.dataset.category)));
byId('advanced').addEventListener('click', event => { event.preventDefault(); vscode.postMessage({ type: 'advanced' }); });
byId('configureLocale').addEventListener('click', () => vscode.postMessage({ type: 'configureLocale' }));
byId('gettingStarted').addEventListener('click', () => vscode.postMessage({ type: 'gettingStarted' }));
byId('openDocumentation').addEventListener('click', () => vscode.postMessage({ type: 'openDocumentation' }));
byId('autoFormatSettings').addEventListener('click', () => vscode.postMessage({ type: 'autoFormat' }));
byId('cphSettings').addEventListener('click', () => vscode.postMessage({ type: 'cphSettings' }));
byId('customSubmitScripts').addEventListener('click', () => vscode.postMessage({ type: 'customSubmitScripts' }));
const checkForUpdatesButton = byId('checkForUpdates');
const checkForUpdatesStatus = byId('checkForUpdatesStatus');
const updateCheckLabels = { checking: '正在检查更新…', latest: '当前已是最新版本。', available: '发现新版本，请查看更新窗口。', failed: '检查更新失败，请稍后重试。' };
window.addEventListener('message', event => {
  if (event.data?.type === 'checkForUpdatesStatus') {
    const status = event.data.status;
    checkForUpdatesButton.disabled = status === 'checking';
    checkForUpdatesButton.textContent = status === 'checking' ? '正在检查更新…' : '检查更新';
    checkForUpdatesStatus.textContent = event.data.message || updateCheckLabels[status] || '';
  }
});
checkForUpdatesButton.addEventListener('click', () => vscode.postMessage({ type: 'checkForUpdates' }));
byId('toolchainDiagnostics').addEventListener('click', () => vscode.postMessage({ type: 'toolchainDiagnostics' }));
const openBuyMeACoffeeButton = byId('openBuyMeACoffee');
if (openBuyMeACoffeeButton) openBuyMeACoffeeButton.addEventListener('click', () => vscode.postMessage({ type: 'buyMeACoffee' }));
const dismissBuyMeACoffeeButton = byId('dismissBuyMeACoffee');
if (dismissBuyMeACoffeeButton) dismissBuyMeACoffeeButton.addEventListener('click', () => { vscode.postMessage({ type: 'dismissBuyMeACoffee' }); const entry = byId('buyMeACoffee'); if (entry) entry.hidden = true; });
window.addEventListener('message', event => { if (event.data?.type === 'state') apply(event.data.value); if (event.data?.type === 'systemFonts') void applySystemFonts(event.data.value); if (event.data?.type === 'fontPreview') applyFontPreview(event.data); if (event.data?.type === 'refreshFontPreview') requestFontPreview(); });
apply(${serializedState});
selectCategory(selectedCategory);
requestFontPreview();
</script></body></html>`;
}

function getAutoFormatHtml(state: AutoFormatState, workspacePath: string): string {
	const serializedState = JSON.stringify(state).replace(/</g, '\\u003c');
	const serializedWorkspacePath = JSON.stringify(workspacePath).replace(/</g, '\\u003c');
	return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>自动格式化</title><style>
body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
main { max-width: 800px; margin: 0 auto; padding: 40px 28px 64px 250px; } .settings-sidebar { position: fixed; top: 28px; left: max(18px, calc(50vw - 505px)); width: 190px; }.settings-sidebar strong { display: block; margin-bottom: 12px; }.settings-sidebar input { margin-bottom: 10px; }.settings-sidebar nav { display: grid; gap: 3px; }.settings-sidebar button { text-align: left; padding: 7px 9px; background: transparent; color: var(--vscode-foreground); }.settings-sidebar button.active, .settings-sidebar button:hover { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.card { border: 1px solid var(--vscode-editorWidget-border); border-radius: 8px; padding: 4px 20px; margin: 14px 0; } h2 { font-size: 15px; margin: 18px 0 2px; color: var(--vscode-descriptionForeground); }
.row { display: grid; grid-template-columns: 290px 1fr; gap: 18px; align-items: center; padding: 13px 0; border-bottom: 1px solid var(--vscode-editorWidget-border); } .row:last-child { border: 0; } label { font-weight: 600; } .hint { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 4px; }
input, select { width: 100%; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 3px; padding: 7px 9px; font: inherit; } input[type="checkbox"] { width: auto; transform: scale(1.15); } .toggle { display: flex; align-items: center; gap: 10px; }
button { border: 0; border-radius: 3px; padding: 8px 14px; font: inherit; cursor: pointer; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); } .actions { display: flex; align-items: center; gap: 12px; margin-top: 24px; } #saved { color: var(--vscode-testing-iconPassed); } code { font-family: var(--vscode-editor-font-family); } section.card[hidden], .row[hidden] { display: none; } @media(max-width:900px) { main { padding-left: 28px; }.settings-sidebar { position: static; width: auto; margin: 20px 28px 0; }.settings-sidebar nav { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style></head><body><main>
<h1>自动格式化</h1><p>配置会实时保存到当前工作目录的 <code>.clang-format</code>，并可选择同时启用保存和粘贴时格式化。</p>
<section class="card"><div class="row"><div><label for="enabled">启用自动格式化</label><div class="hint">同时开启保存时格式化和粘贴时格式化。</div></div><label class="toggle"><input id="enabled" type="checkbox"><span>启用</span></label></div></section>
<h2>基础风格</h2><section class="card"><div class="row"><div><label for="basedOnStyle">基础风格（BasedOnStyle）</label><div class="hint">作为其他规则未覆盖部分的基准；下面的选项会覆盖它。</div></div><select id="basedOnStyle"><option value="Google">Google（Google C++ 风格）</option><option value="LLVM">LLVM（LLVM 默认风格）</option><option value="Chromium">Chromium（Chromium 项目风格）</option><option value="Mozilla">Mozilla（Mozilla 项目风格）</option><option value="WebKit">WebKit（WebKit 项目风格）</option></select></div></section>
<h2>行为</h2><section class="card">
<div class="row"><div><label for="allowShortIfStatementsOnASingleLine">单行 if 语句</label><div class="hint">控制短小 if / else 是否可以保持在同一行。</div></div><select id="allowShortIfStatementsOnASingleLine"><option value="Never">Never（始终换行）</option><option value="WithoutElse">WithoutElse（仅无 else 时允许）</option><option value="OnlyFirstIf">OnlyFirstIf（仅 if-else 链的第一个 if）</option><option value="AllIfsAndElse">AllIfsAndElse（if 与 else 都允许）</option></select></div>
<div class="row"><div><label for="allowShortLoopsOnASingleLine">允许单行循环</label><div class="hint">如 <code>for (...) x++;</code> 不强制拆成多行。</div></div><label class="toggle"><input id="allowShortLoopsOnASingleLine" type="checkbox"><span>允许</span></label></div>
<div class="row"><div><label for="allowShortBlocksOnASingleLine">允许单行代码块</label><div class="hint">如 <code>{ return 0; }</code> 不强制拆成多行。</div></div><label class="toggle"><input id="allowShortBlocksOnASingleLine" type="checkbox"><span>允许</span></label></div>
<div class="row"><div><label for="allowShortFunctionsOnASingleLine">单行函数</label><div class="hint">控制短小函数是否保持为一行。</div></div><select id="allowShortFunctionsOnASingleLine"><option value="None">None（所有函数拆行）</option><option value="InlineOnly">InlineOnly（仅 inline 函数）</option><option value="Empty">Empty（仅空函数）</option><option value="Inline">Inline（允许 inline 函数）</option><option value="All">All（所有短函数都允许）</option></select></div>
</section>
<h2>行长与缩进</h2><section class="card">
<div class="row"><div><label for="columnLimit">最大行长（ColumnLimit）</label><div class="hint">超过该长度时 clang-format 会尝试换行；0 表示不限行长。</div></div><input id="columnLimit" type="number" min="0" max="10000" step="1"></div>
<div class="row"><div><label for="indentWidth">缩进宽度（IndentWidth）</label><div class="hint">每一级缩进使用的空格数。</div></div><input id="indentWidth" type="number" min="1" max="32" step="1"></div>
<div class="row"><div><label for="tabWidth">制表符宽度（TabWidth）</label><div class="hint">Tab 显示或等效为多少个空格。</div></div><input id="tabWidth" type="number" min="1" max="32" step="1"></div>
<div class="row"><div><label for="useTab">Tab 使用方式（UseTab）</label><div class="hint">控制缩进时是否实际写入 Tab 字符。</div></div><select id="useTab"><option value="Never">Never（始终使用空格）</option><option value="ForIndentation">ForIndentation（仅基础缩进使用 Tab）</option><option value="ForContinuationAndIndentation">ForContinuationAndIndentation（缩进和续行都使用 Tab）</option><option value="Always">Always（尽可能使用 Tab）</option></select></div>
<div class="row"><div><label for="accessModifierOffset">访问修饰符缩进（AccessModifierOffset）</label><div class="hint">public / private / protected 相对类成员的缩进偏移；负数表示向左。</div></div><input id="accessModifierOffset" type="number" min="-32" max="32" step="1"></div>
</section>
<h2>大括号、指针与代码块</h2><section class="card">
<div class="row"><div><label for="breakBeforeBraces">大括号位置（BreakBeforeBraces）</label><div class="hint">控制函数、类、if 等代码块的左大括号是否另起一行。</div></div><select id="breakBeforeBraces"><option value="Attach">Attach（左大括号不换行）</option><option value="Linux">Linux（函数、命名空间和类定义换行）</option><option value="Mozilla">Mozilla（枚举、函数和类/结构体定义换行）</option><option value="Stroustrup">Stroustrup（函数、else 和 catch 换行）</option><option value="Allman">Allman（所有左大括号换行）</option><option value="Whitesmiths">Whitesmiths（大括号换行并额外缩进）</option><option value="GNU">GNU（GNU 风格）</option><option value="WebKit">WebKit（函数定义左大括号换行）</option><option value="Custom">Custom（使用 BraceWrapping 的细分规则）</option></select></div>
<div class="row"><div><label for="alwaysBreakTemplateDeclarations">模板声明换行（AlwaysBreakTemplateDeclarations）</label><div class="hint">控制 <code>template &lt;...&gt;</code> 与后续声明是否分为两行。</div></div><select id="alwaysBreakTemplateDeclarations"><option value="No">No（尽量不换行）</option><option value="Yes">Yes（始终换行）</option><option value="MultiLine">MultiLine（仅后续声明本身多行时换行）</option></select></div>
<div class="row"><div><label for="pointerAlignment">指针星号位置（PointerAlignment）</label><div class="hint">控制 <code>*</code> 靠近类型、变量名，还是两者之间。</div></div><select id="pointerAlignment"><option value="Left">Left（<code>int* p</code>）</option><option value="Right">Right（<code>int *p</code>）</option><option value="Middle">Middle（<code>int * p</code>）</option></select></div>
<div class="row"><div><label for="spacesBeforeTrailingComments">行尾注释前空格（SpacesBeforeTrailingComments）</label><div class="hint">如 <code>int x;    // comment</code> 中注释前的空格数。</div></div><input id="spacesBeforeTrailingComments" type="number" min="0" max="100" step="1"></div>
<div class="row"><div><label for="separateDefinitionBlocks">定义块间空行（SeparateDefinitionBlocks）</label><div class="hint">控制相邻函数、类等定义之间是否插入空行。</div></div><select id="separateDefinitionBlocks"><option value="Leave">Leave（保留原有空行）</option><option value="Never">Never（不额外插入空行）</option><option value="Always">Always（相邻定义之间始终插入空行）</option></select></div>
<div class="row"><div><label for="standard">C++ 语言标准（Standard）</label><div class="hint">用于判断可使用的语法和格式化规则。</div></div><select id="standard"><option value="Auto">Auto（自动判断）</option><option value="c++03">c++03</option><option value="c++11">c++11</option><option value="c++14">c++14</option><option value="c++17">c++17</option><option value="c++20">c++20</option><option value="Latest">Latest（使用最新支持标准）</option></select></div>
</section>
<div class="actions"><button id="openFile">打开 .clang-format</button><span id="saved" aria-live="polite"></span></div>
</main><script>
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
const workspacePath = ${serializedWorkspacePath};
let saveTimer;
const settingsSidebar = document.createElement('aside'); settingsSidebar.className = 'settings-sidebar'; settingsSidebar.innerHTML = '<strong>自动格式化</strong><input id="settingsSearch" type="search" placeholder="搜索设置"><nav></nav>'; document.body.prepend(settingsSidebar);
const formatCategoryLabels = ['通用', '基础风格', '行为', '行长与缩进', '大括号、指针与代码块']; const formatSections = [...document.querySelectorAll('main > section')].map((section, index) => ({ section, label: formatCategoryLabels[index] || '格式化' }));
const formatHeadings = [...document.querySelectorAll('main > h2')];
let selectedFormatCategory = 'all'; const formatNav = settingsSidebar.querySelector('nav'); const addFormatCategory = (id, label) => { const button = document.createElement('button'); button.textContent = label; button.classList.toggle('active', id === 'all'); button.onclick = () => { selectedFormatCategory = id; formatNav.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button)); filterFormatSettings(); }; formatNav.append(button); }; addFormatCategory('all', '全部'); formatSections.forEach((item, index) => addFormatCategory(String(index), item.label));
function filterFormatSettings() { const query = document.getElementById('settingsSearch').value.trim().toLocaleLowerCase(); formatSections.forEach((item, index) => { const categoryMatches = selectedFormatCategory === 'all' || selectedFormatCategory === String(index); let hasVisibleRow = false; item.section.querySelectorAll('.row').forEach(row => { const visible = categoryMatches && (!query || row.textContent.toLocaleLowerCase().includes(query)); row.hidden = !visible; hasVisibleRow ||= visible; }); item.section.hidden = !hasVisibleRow; if (index > 0) formatHeadings[index - 1].hidden = !hasVisibleRow; }); } document.getElementById('settingsSearch').oninput = filterFormatSettings;
function apply(state) { Object.entries(state).forEach(([key, value]) => { const control = byId(key); if (!control) return; if (control.type === 'checkbox') control.checked = !!value; else control.value = value; }); }
function value() { return { enabled: byId('enabled').checked, basedOnStyle: byId('basedOnStyle').value, allowShortIfStatementsOnASingleLine: byId('allowShortIfStatementsOnASingleLine').value, allowShortLoopsOnASingleLine: byId('allowShortLoopsOnASingleLine').checked, allowShortBlocksOnASingleLine: byId('allowShortBlocksOnASingleLine').checked, allowShortFunctionsOnASingleLine: byId('allowShortFunctionsOnASingleLine').value, columnLimit: Number(byId('columnLimit').value), indentWidth: Number(byId('indentWidth').value), tabWidth: Number(byId('tabWidth').value), useTab: byId('useTab').value, accessModifierOffset: Number(byId('accessModifierOffset').value), breakBeforeBraces: byId('breakBeforeBraces').value, alwaysBreakTemplateDeclarations: byId('alwaysBreakTemplateDeclarations').value, pointerAlignment: byId('pointerAlignment').value, spacesBeforeTrailingComments: Number(byId('spacesBeforeTrailingComments').value), separateDefinitionBlocks: byId('separateDefinitionBlocks').value, standard: byId('standard').value }; }
function save(delay) { clearTimeout(saveTimer); saveTimer = setTimeout(() => { vscode.postMessage({ type: 'save', value: value() }); byId('saved').textContent = '已自动保存'; setTimeout(() => byId('saved').textContent = '', 1200); }, delay); }
document.querySelectorAll('input:not(#settingsSearch), select').forEach(control => { const immediate = control.type === 'checkbox' || control.tagName === 'SELECT'; control.addEventListener('input', () => save(immediate ? 0 : 250)); control.addEventListener('change', () => save(0)); });
byId('openFile').addEventListener('click', () => vscode.postMessage({ type: 'openFile', workspacePath }));
apply(${serializedState});
filterFormatSettings();
</script></body></html>`;
}

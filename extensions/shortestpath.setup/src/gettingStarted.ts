/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { localize, localizeWebviewHtml } from './localization';
import { getSystemFonts } from './systemFonts';
import {
	applyCppStandard,
	findCppStandard,
	getThemeOptions,
	isCppStandard,
	type CppStandard,
	type ThemeOption
} from './simpleSettings';

const GETTING_STARTED_VERSION = 'shortestpath.gettingStarted.version';
const CPH_FILE_NAME_SETTINGS = 'shortestpath.gettingStarted.cphFileNameSettings';
const DEFAULT_CPH_FILE_NAME_TEMPLATE = '{ojName}/{contestId}/{problemId}.{ext}';
const DEFAULT_CPH_FILE_NAME_TEMPLATE_OVERRIDES: Record<string, string> = {
	CSES: '{ojName}/{problemId}_{slug}.{ext}',
	AT: '{ojName}/{contestId}/{problemId}.{ext}',
	CF: '{ojName}/{contestId}/{problemId}.{ext}',
	LG: '{ojName}/{problemId}.{ext}',
	ShortestPath: '{ojName}/{contestId}/{problemId}.{ext}',
	VJ: '{ojName}/{problemId}{slug}.{ext}',
	'牛客': 'NowCoder/{problemId}.{ext}'
};

let activePanel: vscode.WebviewPanel | undefined;

type GettingStartedState = {
	fontFamily: string;
	fontLigatures: boolean;
	fontSize: number;
	colorTheme: string;
	autoDetectColorScheme: boolean;
	cppStandard: CppStandard;
	compilerFlags: string;
	compiler: string;
	clangdVariableTypeHints: boolean;
	executableCleanupEnabled: boolean;
	executableCleanupDelaySeconds: number;
	autoSave: string;
	autoFormat: boolean;
	cphCustomFileNameEnabled: boolean;
	cphDefaultLanguage: string;
	cphFileNameTemplate: string;
	cphFileNameTemplateOverrides: string;
	availableOjNames: string[];
	themes: ThemeOption[];
};

type SaveMessage = {
	type: 'save';
	page: 'font' | 'theme' | 'cpp' | 'clangd' | 'cleanup' | 'autosave' | 'autoformat' | 'cphNaming';
	value: Record<string, unknown>;
};

type CphFileNameSettings = {
	fileNameTemplate: string;
	fileNameTemplateOverrides: Record<string, string>;
};

export function registerGettingStarted(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.openGettingStarted', () => openGettingStarted(context)));
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
		// The setup may finish in this same session (setup.completed flips), so
		// re-evaluate the auto-open condition when it changes.
		if (event.affectsConfiguration('shortestpath.setup.completed')) {
			void maybeAutoOpenGettingStarted(context);
		}
	}));
	void maybeAutoOpenGettingStarted(context);
}

function currentExtensionVersion(): string {
	const version = vscode.extensions.getExtension('shortestpath.shortestpath-setup')?.packageJSON?.version;
	return typeof version === 'string' ? version : '0.0.0';
}

async function maybeAutoOpenGettingStarted(context: vscode.ExtensionContext): Promise<void> {
	// Only guide users after the environment setup has finished. The first-run
	// window (toolchain installation) is unrelated to this tab.
	if (!vscode.workspace.getConfiguration('shortestpath.setup').get<boolean>('completed')) {
		return;
	}
	if (context.globalState.get<string>(GETTING_STARTED_VERSION) === currentExtensionVersion()) {
		return;
	}
	// Give the workbench a moment to settle before opening the tab. The marker is
	// written when the panel is actually opened, so a fresh install or an upgrade
	// shows the guide exactly once per version.
	setTimeout(() => void vscode.commands.executeCommand('shortestpath.openGettingStarted'), 1000);
}

function openGettingStarted(context: vscode.ExtensionContext): void {
	if (activePanel) {
		activePanel.reveal(vscode.ViewColumn.Active);
		return;
	}
	let isSaving = false;
	let isDisposed = false;
	const panel = vscode.window.createWebviewPanel('shortestpath.gettingStarted', localize('开始使用'), vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
	activePanel = panel;
	void context.globalState.update(GETTING_STARTED_VERSION, currentExtensionVersion());
	panel.webview.html = localizeWebviewHtml(getHtml(getState()));
	void getSystemFonts().then(async result => {
		if (isDisposed) {
			return;
		}
		try {
			const delivered = await panel.webview.postMessage({ type: 'systemFonts', value: result });
			if (!delivered && !isDisposed) {
				console.warn('Getting started webview did not accept the system font result.');
			}
		} catch (error) {
			if (!isDisposed) {
				console.warn('Failed to deliver system fonts to the getting started webview.', error);
			}
		}
	});
	panel.webview.onDidReceiveMessage(async (message: SaveMessage | { type: 'snippets' } | { type: 'autoFormatSettings' } | { type: 'cphSettings' } | { type: 'complete' }) => {
		if (message.type === 'save') {
			isSaving = true;
			try {
				await saveState(context, message.page, message.value);
			} finally {
				isSaving = false;
			}
		} else if (message.type === 'snippets') {
			await vscode.commands.executeCommand('shortestpath.configureCppSnippets');
		} else if (message.type === 'autoFormatSettings') {
			await vscode.commands.executeCommand('shortestpath.configureAutoFormat');
		} else if (message.type === 'cphSettings') {
			await vscode.commands.executeCommand('shortestpath.configureCph');
		} else if (message.type === 'complete') {
			panel.dispose();
		}
	});
	const configurationListener = vscode.workspace.onDidChangeConfiguration(event => {
		if (!isSaving && (event.affectsConfiguration('editor.fontFamily')
			|| event.affectsConfiguration('editor.fontLigatures')
			|| event.affectsConfiguration('editor.fontSize')
			|| event.affectsConfiguration('workbench.colorTheme')
			|| event.affectsConfiguration('window.autoDetectColorScheme')
			|| event.affectsConfiguration('cph.language.cpp.Args')
			|| event.affectsConfiguration('cph.language.cpp.Command')
			|| event.affectsConfiguration('c-cpp-compile-run.cpp-flags')
			|| event.affectsConfiguration('editor.inlayHints.enabled')
			|| event.affectsConfiguration('shortestpath.executableCleanupEnabled')
			|| event.affectsConfiguration('shortestpath.executableCleanupDelaySeconds')
			|| event.affectsConfiguration('files.autoSave')
			|| event.affectsConfiguration('editor.formatOnSave')
			|| event.affectsConfiguration('editor.formatOnPaste')
			|| event.affectsConfiguration('cph.general.defaultLanguage')
			|| event.affectsConfiguration('cph.general.fileNameTemplate')
			|| event.affectsConfiguration('cph.general.fileNameTemplateOverrides')
			|| event.affectsConfiguration('cph.general.ojMapping')
			|| event.affectsConfiguration('cph.general.vjudgeOjNames'))) {
			void panel.webview.postMessage({ type: 'state', value: getState() });
		}
	});
	panel.onDidDispose(() => {
		isDisposed = true;
		activePanel = undefined;
		configurationListener.dispose();
	});
}

function getState(): GettingStartedState {
	const editor = vscode.workspace.getConfiguration('editor', null);
	const files = vscode.workspace.getConfiguration('files', null);
	const workbench = vscode.workspace.getConfiguration('workbench', null);
	const windowConfiguration = vscode.workspace.getConfiguration('window', null);
	const cphFlags = vscode.workspace.getConfiguration('cph.language.cpp', null).get<string>('Args');
	const compileRunFlags = vscode.workspace.getConfiguration('c-cpp-compile-run', null).get<string>('cpp-flags');
	const compilerFlags = cphFlags || compileRunFlags || '';
	const compiler = (vscode.workspace.getConfiguration('cph.language.cpp', null).get<string>('Command') ?? '').split(/[\\/]/).pop() || 'g++';
	const colorTheme = workbench.get<string>('colorTheme') ?? 'One Monokai';
	const inlayHintsEnabled = editor.get<boolean | string>('inlayHints.enabled') ?? 'on';
	const cphGeneral = vscode.workspace.getConfiguration('cph.general', null);
	const ojMapping = cphGeneral.get<Record<string, { oj?: unknown }>>('ojMapping') ?? {};
	const vjudgeOjNames = cphGeneral.get<Record<string, unknown>>('vjudgeOjNames') ?? {};
	const availableOjNames = [...new Set([
		...Object.values(ojMapping).flatMap(mapping => typeof mapping.oj === 'string' ? [mapping.oj] : []),
		...Object.keys(vjudgeOjNames)
	])].sort((a, b) => a.localeCompare(b));
	return {
		fontFamily: editor.get<string>('fontFamily') ?? '',
		fontLigatures: editor.get<boolean | string>('fontLigatures') === true || editor.get<boolean | string>('fontLigatures') === 'true',
		fontSize: editor.get<number>('fontSize') ?? 14,
		colorTheme,
		autoDetectColorScheme: windowConfiguration.get<boolean>('autoDetectColorScheme') ?? false,
		cppStandard: findCppStandard(compilerFlags),
		compilerFlags,
		compiler,
		clangdVariableTypeHints: inlayHintsEnabled !== false && inlayHintsEnabled !== 'off',
		executableCleanupEnabled: vscode.workspace.getConfiguration('shortestpath', null).get<boolean>('executableCleanupEnabled') ?? true,
		executableCleanupDelaySeconds: vscode.workspace.getConfiguration('shortestpath', null).get<number>('executableCleanupDelaySeconds') ?? 60,
		autoSave: files.get<string>('autoSave') ?? 'off',
		autoFormat: editor.get<boolean>('formatOnSave') === true && editor.get<boolean>('formatOnPaste') === true,
		cphCustomFileNameEnabled: Boolean(cphGeneral.get<string>('fileNameTemplate')) || Object.keys(cphGeneral.get<Record<string, string>>('fileNameTemplateOverrides') ?? {}).length > 0,
		cphDefaultLanguage: cphGeneral.get<string>('defaultLanguage') ?? 'cpp',
		cphFileNameTemplate: cphGeneral.get<string>('fileNameTemplate') ?? DEFAULT_CPH_FILE_NAME_TEMPLATE,
		cphFileNameTemplateOverrides: JSON.stringify(cphGeneral.get<Record<string, string>>('fileNameTemplateOverrides') ?? {}, undefined, 2),
		availableOjNames,
		themes: getThemeOptions(colorTheme)
	};
}

async function saveState(context: vscode.ExtensionContext, page: SaveMessage['page'], value: Record<string, unknown>): Promise<void> {
	const settings = vscode.workspace.getConfiguration(undefined, null);
	switch (page) {
		case 'font':
			await Promise.all([
				settings.update('editor.fontFamily', typeof value.fontFamily === 'string' ? value.fontFamily : '', vscode.ConfigurationTarget.Global),
				settings.update('editor.fontLigatures', value.fontLigatures === true, vscode.ConfigurationTarget.Global),
				settings.update('editor.fontSize', typeof value.fontSize === 'number' && value.fontSize > 0 ? Math.min(40, value.fontSize) : 14, vscode.ConfigurationTarget.Global)
			]);
			break;
		case 'theme':
			await Promise.all([
				settings.update('workbench.colorTheme', typeof value.colorTheme === 'string' && value.colorTheme ? value.colorTheme : 'One Monokai', vscode.ConfigurationTarget.Global),
				settings.update('window.autoDetectColorScheme', value.autoDetectColorScheme === true, vscode.ConfigurationTarget.Global),
				settings.update('window.systemColorTheme', 'auto', vscode.ConfigurationTarget.Global)
			]);
			break;
		case 'cpp': {
			const currentState = getState();
			const cppStandard = isCppStandard(value.cppStandard) ? value.cppStandard : currentState.cppStandard;
			const compilerFlags = applyCppStandard(currentState.compilerFlags, cppStandard);
			await Promise.all([
				settings.update('cph.language.cpp.Args', compilerFlags, vscode.ConfigurationTarget.Global),
				settings.update('c-cpp-compile-run.cpp-flags', compilerFlags, vscode.ConfigurationTarget.Global)
			]);
			break;
		}
		case 'clangd':
			await settings.update('editor.inlayHints.enabled', value.clangdVariableTypeHints !== false ? 'on' : 'off', vscode.ConfigurationTarget.Global);
			break;
		case 'cleanup': {
			const delay = typeof value.executableCleanupDelaySeconds === 'number'
				? Math.max(1, Math.min(86_400, Math.floor(value.executableCleanupDelaySeconds)))
				: 60;
			await Promise.all([
				settings.update('shortestpath.executableCleanupEnabled', value.executableCleanupEnabled !== false, vscode.ConfigurationTarget.Global),
				settings.update('shortestpath.executableCleanupDelaySeconds', delay, vscode.ConfigurationTarget.Global)
			]);
			break;
		}
		case 'autosave':
			await settings.update('files.autoSave', typeof value.autoSave === 'string' ? value.autoSave : 'off', vscode.ConfigurationTarget.Global);
			break;
		case 'autoformat':
			await Promise.all([
				settings.update('editor.formatOnSave', value.autoFormat === true, vscode.ConfigurationTarget.Global),
				settings.update('editor.formatOnPaste', value.autoFormat === true, vscode.ConfigurationTarget.Global)
			]);
			break;
		case 'cphNaming': {
			const cphGeneral = vscode.workspace.getConfiguration('cph.general', null);
			const defaultLanguage = typeof value.cphDefaultLanguage === 'string' ? value.cphDefaultLanguage : 'cpp';
			if (value.cphCustomFileNameEnabled === true) {
				const saved = context.globalState.get<CphFileNameSettings>(CPH_FILE_NAME_SETTINGS);
				let fileNameTemplateOverrides: Record<string, string>;
				let fileNameTemplate: string;
				if (value.restoreCphFileNameSettings === true && saved) {
					fileNameTemplate = saved.fileNameTemplate;
					fileNameTemplateOverrides = saved.fileNameTemplateOverrides;
				} else {
					try {
						const parsed = JSON.parse(typeof value.cphFileNameTemplateOverrides === 'string' ? value.cphFileNameTemplateOverrides : '{}');
						if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some(template => typeof template !== 'string')) {
							throw new Error('invalid file name template overrides');
						}
						fileNameTemplateOverrides = parsed as Record<string, string>;
					} catch {
						void vscode.window.showWarningMessage('CPH 文件名模板覆盖必须是一个 JSON 对象，OJ 简称为键、模板字符串为值。');
						return;
					}
					fileNameTemplate = typeof value.cphFileNameTemplate === 'string'
						? value.cphFileNameTemplate.trim()
						: saved?.fileNameTemplate ?? DEFAULT_CPH_FILE_NAME_TEMPLATE;
					if (!saved && !fileNameTemplate) {
						fileNameTemplate = DEFAULT_CPH_FILE_NAME_TEMPLATE;
						fileNameTemplateOverrides = { ...DEFAULT_CPH_FILE_NAME_TEMPLATE_OVERRIDES };
					}
				}
				await context.globalState.update(CPH_FILE_NAME_SETTINGS, { fileNameTemplate, fileNameTemplateOverrides } satisfies CphFileNameSettings);
				await Promise.all([
					settings.update('cph.general.defaultLanguage', defaultLanguage, vscode.ConfigurationTarget.Global),
					settings.update('cph.general.fileNameTemplate', fileNameTemplate, vscode.ConfigurationTarget.Global),
					settings.update('cph.general.fileNameTemplateOverrides', fileNameTemplateOverrides, vscode.ConfigurationTarget.Global)
				]);
				break;
			}
			const fileNameTemplate = cphGeneral.inspect<string>('fileNameTemplate')?.globalValue;
			const fileNameTemplateOverrides = cphGeneral.inspect<Record<string, string>>('fileNameTemplateOverrides')?.globalValue;
			if (fileNameTemplate !== undefined || fileNameTemplateOverrides !== undefined) {
				await context.globalState.update(CPH_FILE_NAME_SETTINGS, {
					fileNameTemplate: fileNameTemplate ?? '',
					fileNameTemplateOverrides: fileNameTemplateOverrides ?? {}
				} satisfies CphFileNameSettings);
			}
			await Promise.all([
				settings.update('cph.general.defaultLanguage', defaultLanguage, vscode.ConfigurationTarget.Global),
				settings.update('cph.general.fileNameTemplate', undefined, vscode.ConfigurationTarget.Global),
				settings.update('cph.general.fileNameTemplateOverrides', undefined, vscode.ConfigurationTarget.Global)
			]);
			break;
		}
	}
}

function getHtml(state: GettingStartedState): string {
	const serializedState = JSON.stringify(state).replace(/</g, '\\u003c');
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>开始使用</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; overflow: hidden; background: radial-gradient(circle at 20% 0%, #25345f 0, transparent 42%), #0f1117; color: #f4f6fb; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { height: 100vh; display: flex; flex-direction: column; max-width: 1120px; margin: 0 auto; padding: 0 36px; }
.progress { display: flex; justify-content: center; align-items: center; gap: 9px; padding: 20px 0 6px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #2c3550; transition: transform .32s cubic-bezier(.2,.8,.2,1), background-color .32s ease; }
.dot.active { background: #78a9ff; transform: scale(1.4); }
.stage { position: relative; flex: 1; min-height: 0; }
.page { position: absolute; inset: 0; display: flex; flex-direction: column; opacity: 0; visibility: hidden; transform: translateX(36px); transition: opacity .32s cubic-bezier(.2,.8,.2,1), transform .32s cubic-bezier(.2,.8,.2,1); }
.page.visible { opacity: 1; visibility: visible; transform: none; }
.page.exit-left { opacity: 0; transform: translateX(-36px); }
.page.exit-right { opacity: 0; transform: translateX(36px); }
.page.enter-left { opacity: 0; transform: translateX(-36px); }
.page.enter-right { opacity: 0; transform: translateX(36px); }
.page-head { padding: 22px 0 2px; }
.badge { color: #a8c7ff; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; font-size: 12px; }
h1 { font-size: 32px; margin: 8px 0 10px; letter-spacing: -.03em; }
.lead { color: #b7bfce; font-size: 15px; line-height: 1.6; margin: 0; max-width: 660px; }
.page-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; padding: 16px 0 8px; }
.page-body.centered { grid-template-columns: minmax(0, 680px); justify-content: center; }
.pane { min-height: 0; overflow: auto; }
.card { border: 1px solid #30394d; border-radius: 16px; background: #171b25; padding: 6px 22px; }
.row { display: grid; grid-template-columns: 190px 1fr; gap: 14px; align-items: center; padding: 15px 0; border-bottom: 1px solid #262e40; }
.row:last-child { border: 0; }
.row > .row-label { font-weight: 600; }
.hint { color: #8d98aa; font-size: 12px; margin-top: 4px; line-height: 1.5; }
input, select { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #30394d; border-radius: 8px; background: #10131c; color: #f4f6fb; font: inherit; }
input[type="checkbox"] { width: 18px; height: 18px; accent-color: #78a9ff; }
.toggle { display: flex; align-items: center; gap: 10px; }
.row.disabled { opacity: .6; }
.fallback-list { display: grid; gap: 7px; }
.fallback-row { display: grid; grid-template-columns: 1fr auto auto auto; gap: 6px; align-items: center; }
.fallback-row .icon { min-width: 30px; padding: 7px 0; }
.add-fallback { margin-top: 8px; }
.preview { height: 100%; min-height: 300px; border: 1px solid #30394d; border-radius: 16px; background: #10131c; display: flex; flex-direction: column; overflow: hidden; }
.preview .bar { display: flex; align-items: center; gap: 6px; padding: 11px 14px; border-bottom: 1px solid #262e40; }
.preview .bar .light { width: 10px; height: 10px; border-radius: 50%; background: #2c3550; }
.preview .bar .bar-title { margin-left: 8px; color: #8d98aa; font-size: 12px; }
.preview .body { flex: 1; padding: 14px 18px; font-size: 14px; line-height: 1.7; overflow: auto; }
.actions { display: flex; justify-content: space-between; align-items: center; padding: 10px 0 26px; }
button { appearance: none; font: inherit; color: inherit; cursor: pointer; }
.btn { padding: 11px 24px; border: 0; border-radius: 9px; font-weight: 700; font-size: 14px; }
.btn.primary { background: #78a9ff; color: #071329; }
.btn.secondary { background: #253b64; color: #e8f0ff; }
.btn.ghost { background: transparent; color: #aeb8c9; border: 1px solid #30394d; }
.btn[disabled] { opacity: .45; cursor: default; }
.fade-item { opacity: 0; transform: translateY(10px); }
.page.visible .fade-item { animation: fadeUp .4s cubic-bezier(.2,.8,.2,1) forwards; animation-delay: calc(var(--i, 0) * 45ms); }
@keyframes fadeUp { to { opacity: 1; transform: none; } }
.code { font-family: var(--vscode-editor-font-family, "SF Mono", "Cascadia Code", Consolas, monospace); white-space: pre; }
.syntax-keyword { color: #c586c0; }
.syntax-type { color: #4ec9b0; }
.syntax-string { color: #ce9178; }
.syntax-number { color: #b5cea8; }
.syntax-comment { color: #6a9955; }
.hint-inline { color: #d2b27b; font-style: italic; }
.mock-file { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 7px 0; border-bottom: 1px dashed #262e40; color: #b7bfce; }
.mock-file .mock-size { color: #8d98aa; font-size: 12px; }
.mock-file.cleaned { opacity: .45; text-decoration: line-through; color: #6a9955; }
.terminal { background: #0b0e14; border: 1px solid #262e40; border-radius: 10px; padding: 12px 14px; font-family: var(--vscode-editor-font-family, "SF Mono", "Cascadia Code", Consolas, monospace); font-size: 12.5px; line-height: 1.7; white-space: pre-wrap; word-break: break-all; color: #9cdcfe; }
.terminal .dim { color: #8d98aa; }
.term-row { color: #d4d4d4; }
.summary { display: grid; gap: 10px; }
.summary-item { display: flex; gap: 10px; align-items: baseline; color: #b7bfce; }
.summary-item b { color: #f4f6fb; }
.big-logo { font-size: 52px; font-weight: 800; letter-spacing: -.04em; background: linear-gradient(90deg, #78a9ff, #a8c7ff); -webkit-background-clip: text; background-clip: text; color: transparent; }
@media (max-width: 780px) { .page-body { grid-template-columns: 1fr; } body { overflow: auto; } main { height: auto; min-height: 100vh; } .stage { min-height: 640px; } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>
</head>
<body><main>
<div class="progress" id="progress" aria-label="步骤"></div>
<div class="stage">

<section class="page" data-page="welcome">
<div class="page-head fade-item" style="--i:0"><div class="big-logo">ShortestPath IDE</div><h1>开始使用</h1><p class="lead">用几步配置好你的竞赛编程环境偏好。所有改动都会实时生效，随时可以返回调整。</p></div>
<div class="page-body centered">
<div class="pane card" style="display:flex;flex-direction:column;gap:16px;padding:26px 28px">
<div class="fade-item" style="--i:1"><b>接下来你将依次配置</b></div>
<div class="fade-item" style="--i:2">① 代码字体、字号与连字</div>
<div class="fade-item" style="--i:3">② 界面主题</div>
<div class="fade-item" style="--i:4">③ 默认 C++ 语言版本</div>
<div class="fade-item" style="--i:5">④ clangd 变量类型提示</div>
<div class="fade-item" style="--i:6">⑤ 生成文件自动清理</div>
<div class="fade-item" style="--i:7">⑥ 自动保存</div>
<div class="fade-item" style="--i:8">⑦ 自动格式化</div>
<div class="fade-item" style="--i:9">⑧ CPH 题目文件命名</div>
<div class="fade-item" style="--i:10">⑨ 代码模板</div>
</div>
</div>
<div class="actions"><span></span><button id="welcome-next" class="btn primary fade-item" style="--i:11">开始</button></div>
</section>

<section class="page" data-page="font">
<div class="page-head fade-item" style="--i:0"><div class="badge">1 / 9 · 字体</div><h1>代码字体</h1><p class="lead">选择适合长时间阅读的主要等宽字体，并用回退字体补齐缺失字形。</p></div>
<div class="page-body">
<div class="pane card">
<div class="row"><div class="row-label">主要字体<div class="hint">从检测到的系统等宽字体中选择。</div></div><div><select id="fontFamily" disabled><option>正在读取系统字体…</option></select><div id="fontLoadStatus" class="hint" role="status" aria-live="polite">正在读取系统字体，请稍候。</div></div></div>
<div class="row"><div class="row-label">回退字体<div class="hint">字形缺失时按顺序回退，可选择中文 / Emoji 等字体。</div></div><div><div id="fallbackFonts" class="fallback-list"></div><button id="addFallback" class="btn secondary add-fallback" type="button">添加回退字体</button></div></div>
<div class="row"><div class="row-label">字体大小</div><input id="fontSize" type="number" min="1" max="40" step="1"></div>
<div class="row"><div class="row-label">启用字体连字<div id="fontLigaturesStatus" class="hint" role="status"></div></div><label class="toggle"><input id="fontLigatures" type="checkbox"><span>启用</span></label></div>
</div>
<div class="pane preview"><div class="bar"><span class="light"></span><span class="light"></span><span class="light"></span><span class="bar-title">实时预览（连字：== != >= <= -> =>）</span></div><div id="fontPreview" class="body code">#include &lt;bits/stdc++.h&gt;
using namespace std;

int main() {
    int n; cin &gt;&gt; n;
    bool ok = (n &gt;= 10) &amp;&amp; (n != 0) &amp;&amp; (x == y);
    map&lt;int, int&gt; mp; auto it = mp.begin(); it-&gt;second = 1;
    auto f = [&amp;](int x) =&gt; x * 2;
    while (lo &lt;= hi) { int mid = (lo + hi) / 2; }
    cout &lt;&lt; "hi" &lt;&lt; endl;
    return 0;
}</div></div>
</div>
<div class="actions"><button id="font-prev" class="btn ghost">上一步</button><button id="font-next" class="btn primary">下一步</button></div>
</section>

<section class="page" data-page="theme">
<div class="page-head fade-item" style="--i:0"><div class="badge">2 / 9 · 主题</div><h1>界面主题</h1><p class="lead">选择一个你看着顺眼的主题，选择后立即应用到整个 IDE。</p></div>
<div class="page-body centered">
<div class="pane card">
<div class="row"><div class="row-label">主题</div><select id="colorTheme"></select></div>
<div class="row"><div class="row-label">跟随系统主题<div class="hint">开启后随系统亮暗自动切换。</div></div><label class="toggle"><input id="autoDetectColorScheme" type="checkbox"><span>启用</span></label></div>
</div>
</div>
<div class="actions"><button id="theme-prev" class="btn ghost">上一步</button><button id="theme-next" class="btn primary">下一步</button></div>
</section>

<section class="page" data-page="cpp">
<div class="page-head fade-item" style="--i:0"><div class="badge">3 / 9 · 编译</div><h1>C++ 语言版本</h1><p class="lead">选择默认编译使用的 C++ 标准，会同步应用到 CPH 与编译运行。</p></div>
<div class="page-body">
<div class="pane card">
<div class="row"><div class="row-label">C++ 语言版本</div><select id="cppStandard"><option value="c++11">C++11</option><option value="c++14">C++14</option><option value="c++17">C++17</option><option value="c++20">C++20</option><option value="c++23">C++23</option></select></div>
<div class="row"><div class="row-label">编译选项<div class="hint">由版本自动生成，可在设置页微调。</div></div><input id="compilerFlags" type="text" readonly></div>
</div>
<div class="pane preview"><div class="bar"><span class="light"></span><span class="light"></span><span class="light"></span><span class="bar-title">编译命令预览</span></div><div class="body"><div class="terminal"><div class="dim">$ </div><div class="term-row" id="compileCommand">g++ -std=c++23 -O2 -g -Wall -Wextra -D_GLIBCXX_DEBUG main.cpp -o main</div><div class="dim">编译成功 ✓  main</div></div></div></div>
</div>
<div class="actions"><button id="cpp-prev" class="btn ghost">上一步</button><button id="cpp-next" class="btn primary">下一步</button></div>
</section>

<section class="page" data-page="clangd">
<div class="page-head fade-item" style="--i:0"><div class="badge">4 / 9 · 智能提示</div><h1>clangd 变量类型提示</h1><p class="lead">在 <span class="code">auto</span> 等推断变量后显示推断出的类型。</p></div>
<div class="page-body">
<div class="pane card">
<div class="row"><div class="row-label">显示变量类型提示</div><label class="toggle"><input id="clangdVariableTypeHints" type="checkbox"><span>启用</span></label></div>
</div>
<div class="pane preview"><div class="bar"><span class="light"></span><span class="light"></span><span class="light"></span><span class="bar-title">实时效果</span></div><div class="body code"><span class="syntax-keyword">auto</span> it <span id="hintIt" class="hint-inline">/*: iterator*/</span> = st.lower_bound(x);
<span class="syntax-keyword">auto</span> sum <span id="hintSum" class="hint-inline">/*: long long*/</span> = accumulate(a.begin(), a.end(), <span class="syntax-number">0LL</span>);
<span class="syntax-keyword">auto</span> [it, ok <span id="hintVal" class="hint-inline">/*: bool*/</span>] = mp.insert(<span id="hintParamX" class="hint-inline">/*x: */</span>{<span id="hintParamK" class="hint-inline">/*&amp;x: */</span>k, <span id="hintParamV" class="hint-inline">/*&amp;y: */</span>v});</div></div>
</div>
<div class="actions"><button id="clangd-prev" class="btn ghost">上一步</button><button id="clangd-next" class="btn primary">下一步</button></div>
</section>

<section class="page" data-page="cleanup">
<div class="page-head fade-item" style="--i:0"><div class="badge">5 / 9 · 文件</div><h1>生成文件自动清理</h1><p class="lead">程序运行结束后自动删除生成的可执行文件，保持目录干净。</p></div>
<div class="page-body">
<div class="pane card">
<div class="row"><div class="row-label">自动清理生成文件</div><label class="toggle"><input id="executableCleanupEnabled" type="checkbox"><span>启用</span></label></div>
<div class="row"><div class="row-label">保留时间（秒）<div class="hint">生成文件保留多少秒后自动删除。</div></div><input id="executableCleanupDelaySeconds" type="number" min="1" max="86400" step="1"></div>
</div>
<div class="pane preview"><div class="bar"><span class="light"></span><span class="light"></span><span class="light"></span><span class="bar-title">运行后</span></div><div class="body">
<div class="mock-file"><span>📄 main.cpp</span><span class="mock-size">源码，已保留</span></div>
<div id="fileExe" class="mock-file"><span>⚙️ main.exe</span><span class="mock-size" id="fileExeState">60 秒后删除</span></div>
<div id="fileBin" class="mock-file"><span>⚙️ main.bin</span><span class="mock-size" id="fileBinState">60 秒后删除</span></div>
<div id="fileDsym" class="mock-file"><span>⚙️ main.dSYM</span><span class="mock-size" id="fileDsymState">60 秒后删除</span></div>
</div></div>
</div>
<div class="actions"><button id="cleanup-prev" class="btn ghost">上一步</button><button id="cleanup-next" class="btn primary">下一步</button></div>
</section>

<section class="page" data-page="autosave">
<div class="page-head fade-item" style="--i:0"><div class="badge">6 / 9 · 保存</div><h1>自动保存</h1><p class="lead">按你的习惯选择保存时机，避免忘记保存。</p></div>
<div class="page-body">
<div class="pane card">
<div class="row"><div class="row-label">自动保存</div><select id="autoSave"><option value="off">关闭</option><option value="afterDelay">延迟后自动保存</option><option value="onFocusChange">切换焦点时保存</option><option value="onWindowChange">切换窗口时保存</option></select></div>
</div>
<div class="pane preview"><div class="bar"><span class="light"></span><span class="light"></span><span class="light"></span><span class="bar-title">状态栏效果</span></div><div class="body" style="padding:0;height:100%">
<div class="ide-mock" style="display:grid;grid-template-rows:1fr 26px;height:100%">
<div style="background:var(--vscode-editor-background,#10131c);color:var(--vscode-editor-foreground,#e8e8e8);padding:14px 16px;font-family:var(--vscode-editor-font-family,monospace);font-size:13px;line-height:1.7;overflow:hidden"><span style="color:var(--vscode-editorLineNumber-foreground,#6b7280)">1  </span><span class="syntax-type">int</span> main() {<br><span style="color:var(--vscode-editorLineNumber-foreground,#6b7280)">2  </span>&nbsp;&nbsp;&nbsp;&nbsp;<span class="syntax-type">vector</span>&lt;<span class="syntax-type">int</span>&gt; a;<br><span style="color:var(--vscode-editorLineNumber-foreground,#6b7280)">3  </span>&nbsp;&nbsp;&nbsp;&nbsp;read(a);<br><span style="color:var(--vscode-editorLineNumber-foreground,#6b7280)">4  </span>}</div>
<div style="background:var(--vscode-statusBar-background,#253b64);color:var(--vscode-statusBar-foreground,#e8f0ff);display:flex;align-items:center;gap:10px;padding:0 12px;font-size:11.5px"><span id="autoSaveDot" style="width:8px;height:8px;border-radius:50%;background:#f4a261;display:inline-block"></span><span id="autoSaveStatus">● 未保存 · 需手动保存（Cmd+S）</span><span style="margin-left:auto">C++  Ln 4, Col 1</span></div>
</div>
</div></div>
</div>
<div class="actions"><button id="autosave-prev" class="btn ghost">上一步</button><button id="autosave-next" class="btn primary">下一步</button></div>
</section>

<section class="page" data-page="autoformat">
<div class="page-head fade-item" style="--i:0"><div class="badge">7 / 9 · 格式化</div><h1>自动格式化</h1><p class="lead">保存或粘贴代码时自动格式化，保持代码风格一致。</p></div>
<div class="page-body centered">
<div class="pane card">
<div class="row"><div class="row-label">启用自动格式化<div class="hint">同时在保存和粘贴时格式化代码。</div></div><label class="toggle"><input id="autoFormat" type="checkbox"><span>启用</span></label></div>
<div class="row"><div class="row-label">详细设置<div class="hint">配置 .clang-format 的代码风格与缩进规则。</div></div><button id="openAutoFormatSettings" class="btn secondary">打开详细设置</button></div>
</div>
</div>
<div class="actions"><button id="autoformat-prev" class="btn ghost">上一步</button><button id="autoformat-next" class="btn primary">下一步</button></div>
</section>

<section class="page" data-page="cphNaming">
<div class="page-head fade-item" style="--i:0"><div class="badge">8 / 9 · CPH</div><h1>CPH 题目文件命名</h1><p class="lead">导入题目时按在线评测、比赛和题号自动组织文件。</p></div>
<div class="page-body centered">
<div class="pane card">
<div class="row"><div class="row-label">启用自定义文件名<div class="hint">关闭后 CPH 使用其默认命名；开启后使用 ShortestPath IDE 的推荐模板。</div></div><label class="toggle"><input id="cphCustomFileNameEnabled" type="checkbox"><span>启用</span></label></div>

<div class="row"><div class="row-label">新导入题目的默认语言</div><select id="cphDefaultLanguage"><option value="cpp">C++</option><option value="c">C</option><option value="python">Python</option><option value="rust">Rust</option><option value="java">Java</option><option value="js">JavaScript</option><option value="none">不指定</option></select></div>
<div class="row cph-naming-setting"><div class="row-label">文件名模板<div class="hint">选择预设；仅选择“自定义”后才能手动输入。</div></div><div><select id="cphFileNameTemplatePreset"><option value="{ojName}/{contestId}/{problemId}.{ext}">ShortestPath 推荐：&lt;OJ 名称&gt;/&lt;比赛 ID&gt;/&lt;题目编号&gt;</option><option value="{oj}/{contestId}/{problemId}_{slug}.{ext}">&lt;OJ 简称&gt;/&lt;比赛 ID&gt;/&lt;题目编号&gt;_&lt;题目名&gt;</option><option value="{contestId}_{problemId}_{slug}.{ext}">&lt;比赛 ID&gt;_&lt;题目编号&gt;_&lt;题目名&gt;</option><option value="custom">自定义</option></select><input id="cphFileNameTemplate" placeholder="例如：{oj}/{contestId}/{problemId}_{slug}.{ext}" hidden></div></div>
<div id="cphFileNameTemplateHelp" class="row cph-naming-setting" hidden><div class="row-label">自定义占位符<div class="hint"><span class="code">{oj}</span> OJ 简称，<span class="code">{ojName}</span> OJ 全称，<span class="code">{contestId}</span> 比赛 ID，<span class="code">{problemId}</span> 题号，<span class="code">{slug}</span> 题名简写，<span class="code">{name}</span> 题名，<span class="code">{index}</span> 导入序号，<span class="code">{group}</span> 分组，<span class="code">{url}</span> 链接，<span class="code">{ext}</span> 扩展名，<span class="code">{lang}</span> 语言。</div></div></div>
<div class="row cph-naming-setting"><div class="row-label">命名效果示例<div class="hint">以 Codeforces 第 2078 场 A 题、C++ 为例；实时预览上方通用模板。</div></div><div id="cphFileNameTemplateExample" class="terminal"></div></div>
<div class="row cph-naming-setting"><div class="row-label">文件名模板覆盖<div class="hint">按 OJ 简称设置专用模板；匹配时优先于上方的通用模板。</div></div><div><div class="hint">可用 OJ 简称：${state.availableOjNames.join('、') || '未解析到，请在在线评测映射中添加'}</div><input id="cphFileNameTemplateOverrides" type="hidden"><div id="cphFileNameTemplateOverridesEditor"></div><button id="addCphFileNameTemplateOverride" class="btn secondary" type="button" style="margin-top:8px">添加 OJ 规则</button></div></div>
<div class="row"><div class="row-label">详细设置<div class="hint">按 OJ 配置文件名模板、覆盖规则及其他 CPH 行为。</div></div><button id="openCphSettings" class="btn secondary">打开 CPH 设置</button></div>
</div>
</div>
<div class="actions"><button id="cphNaming-prev" class="btn ghost">上一步</button><button id="cphNaming-next" class="btn primary">下一步</button></div>
</section>

<section class="page" data-page="snippets">
<div class="page-head fade-item" style="--i:0"><div class="badge">9 / 9 · 模板</div><h1>代码模板</h1><p class="lead">配置 C++ 用户代码片段，写题时一键插入常用代码。</p></div>
<div class="page-body">
<div class="pane card">
<div class="row"><div class="row-label">代码模板<div class="hint">打开独立的代码模板配置页，可定义多个语言的片段。</div></div><button id="openSnippets" class="btn secondary">配置代码模板</button></div>
</div>
<div class="pane preview"><div class="bar"><span class="light"></span><span class="light"></span><span class="light"></span><span class="bar-title">示例模板</span></div><div class="body code"><span class="syntax-comment">// 输入 cpp 回车：</span>

<span class="syntax-keyword">#include</span> &lt;bits/stdc++.h&gt;

<span class="syntax-keyword">using namespace</span> std;

<span class="syntax-keyword">void</span> solve() {

}

<span class="syntax-keyword">int</span> main() {
    <span class="syntax-type">ios::sync_with_stdio</span>(<span class="syntax-keyword">false</span>);
    <span class="syntax-type">cin.tie</span>(<span class="syntax-number">0</span>);

    <span class="syntax-keyword">int</span> t;
    cin &gt;&gt; t;
    <span class="syntax-keyword">while</span> (t--) solve();
}</div></div>
</div>
<div class="actions"><button id="snippets-prev" class="btn ghost">上一步</button><button id="snippets-next" class="btn primary">下一步</button></div>
</section>

<section class="page" data-page="done">
<div class="page-head fade-item" style="--i:0"><div class="badge">完成</div><h1>全部就绪 🎉</h1><p class="lead">你的偏好已保存并实时生效。随时可以在设置页或命令面板重新打开本向导。</p></div>
<div class="page-body centered">
<div class="pane">
<div class="summary">
<div class="summary-item fade-item" style="--i:1"><span>①</span><span>字体：<b id="doneFont">…</b></span></div>
<div class="summary-item fade-item" style="--i:2"><span>②</span><span>主题：<b id="doneTheme">…</b></span></div>
<div class="summary-item fade-item" style="--i:3"><span>③</span><span>C++ 版本：<b id="doneCpp">…</b></span></div>
<div class="summary-item fade-item" style="--i:4"><span>④</span><span>变量类型提示：<b id="doneHints">…</b></span></div>
<div class="summary-item fade-item" style="--i:5"><span>⑤</span><span>自动清理：<b id="doneCleanup">…</b></span></div>
<div class="summary-item fade-item" style="--i:6"><span>⑥</span><span>自动保存：<b id="doneAutoSave">…</b></span></div>
<div class="summary-item fade-item" style="--i:7"><span>⑦</span><span>自动格式化：<b id="doneAutoFormat">…</b></span></div>
<div class="summary-item fade-item" style="--i:8"><span>⑧</span><span>CPH 文件名：<b id="doneCphNaming">…</b></span></div>
</div>
</div>
</div>
<div class="actions"><button id="done-prev" class="btn ghost">上一步</button><button id="done-finish" class="btn primary">完成</button></div>
</section>

</div>
</main>
<script>
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
const PAGES = ['welcome', 'font', 'theme', 'cpp', 'clangd', 'cleanup', 'autosave', 'autoformat', 'cphNaming', 'snippets', 'done'];
let state = ${serializedState};
let currentIndex = 0;
let transitioning = false;
let systemFonts = [];
let monospaceFonts = [];
let fontLoadError = '';
let fontLoadComplete = false;
let fontDetectionGeneration = 0;
let ligatureGeneration = 0;
let selectedFonts = [];
const normalizeFont = font => font.trim().replace(/^['"]|['"]$/g, '');
const serializeFontStack = fonts => fonts.map(font => font === 'monospace' ? font : /\\s/.test(font) ? '"' + font + '"' : font).join(', ');
function isMonospaceFont(font, context) { context.font = '16px ' + serializeFontStack([font]); return Math.abs(context.measureText('iiiiiiiiii').width - context.measureText('WWWWWWWWWW').width) < 0.01; }
async function supportsLigatures(font) {
  const stack = serializeFontStack([font]);
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
function addOptions(select, fonts, label) {
  const group = document.createElement('optgroup');
  group.label = label;
  fonts.forEach(font => {
    const option = document.createElement('option');
    option.value = font;
    option.textContent = font;
    option.style.fontFamily = serializeFontStack([font]);
    group.append(option);
  });
  select.append(group);
}
function setFontPreview() {
  byId('fontPreview').style.fontFamily = serializeFontStack(selectedFonts);
  byId('fontPreview').style.fontSize = state.fontSize + 'px';
  byId('fontPreview').style.fontVariantLigatures = state.fontLigatures ? 'normal' : 'none';
}
function fontSelect(font, fonts, label, allowCurrentCustomFont) {
  const select = document.createElement('select');
  addOptions(select, fonts, label);
  const hasFont = fonts.includes(font);
  if (!hasFont && allowCurrentCustomFont) {
    const custom = document.createElement('option');
    custom.value = font;
    custom.textContent = font + '（当前字体）';
    select.prepend(custom);
  } else if (!hasFont) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '当前字体不是等宽字体，请选择';
    placeholder.disabled = true;
    select.prepend(placeholder);
  }
  select.value = hasFont || allowCurrentCustomFont ? font : '';
  select.disabled = !fonts.length;
  select.style.fontFamily = serializeFontStack([font]);
  return select;
}
function renderFonts() {
  const primary = byId('fontFamily');
  primary.replaceChildren();
  const fallback = byId('fallbackFonts');
  fallback.replaceChildren();
  const status = byId('fontLoadStatus');
  if (!fontLoadComplete) {
    const loading = document.createElement('option');
    loading.textContent = '正在检测系统等宽字体…';
    primary.append(loading);
    primary.disabled = true;
    byId('addFallback').disabled = true;
    status.textContent = '正在检测 ' + systemFonts.length + ' 个系统字体中的等宽字体，请稍候。';
    void updateLigatureSupport();
    return;
  }
  const primarySelect = fontSelect(selectedFonts[0] || 'monospace', monospaceFonts, '系统等宽字体', false);
  const primaryValue = primarySelect.value;
  [...primarySelect.children].forEach(child => primary.append(child));
  primary.value = primaryValue;
  primary.disabled = !monospaceFonts.length;
  primary.style.fontFamily = serializeFontStack([selectedFonts[0] || 'monospace']);
  selectedFonts.slice(1).forEach((font, index) => {
    const row = document.createElement('div');
    row.className = 'fallback-row';
    const select = fontSelect(font, systemFonts, '系统字体', true);
    select.onchange = () => { selectedFonts[index + 1] = select.value; renderFonts(); setFontPreview(); saveFont(); };
    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'btn secondary icon';
    up.textContent = '↑';
    up.disabled = index === 0;
    up.onclick = () => { [selectedFonts[index], selectedFonts[index + 1]] = [selectedFonts[index + 1], selectedFonts[index]]; renderFonts(); setFontPreview(); saveFont(); };
    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'btn secondary icon';
    down.textContent = '↓';
    down.disabled = index === selectedFonts.length - 2;
    down.onclick = () => { [selectedFonts[index + 1], selectedFonts[index + 2]] = [selectedFonts[index + 2], selectedFonts[index + 1]]; renderFonts(); setFontPreview(); saveFont(); };
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn secondary icon';
    remove.textContent = '×';
    remove.onclick = () => { selectedFonts.splice(index + 1, 1); renderFonts(); setFontPreview(); saveFont(); };
    row.append(select, up, down, remove);
    fallback.append(row);
  });
  byId('addFallback').disabled = !systemFonts.length;
  status.textContent = fontLoadError
    ? fontLoadError
    : !monospaceFonts.length
      ? '未发现可用的系统等宽字体，无法选择主要字体。'
      : '已检测到 ' + monospaceFonts.length + ' 个系统等宽字体。';
  void updateLigatureSupport();
}
function applyFonts() {
  selectedFonts = (state.fontFamily || '').split(',').map(normalizeFont).filter(Boolean);
  if (!selectedFonts.length) selectedFonts = ['monospace'];
}
function saveFont() {
  byId('fontLigatures').checked = state.fontLigatures;
  state.fontFamily = serializeFontStack(selectedFonts);
  save('font', {
    fontFamily: state.fontFamily,
    fontLigatures: byId('fontLigatures').checked,
    fontSize: Number(byId('fontSize').value) || 14
  });
}
async function updateLigatureSupport() {
  const generation = ++ligatureGeneration;
  const checkbox = byId('fontLigatures');
  const status = byId('fontLigaturesStatus');
  const row = checkbox.closest('.row');
  const supported = await supportsLigatures(selectedFonts[0] || 'monospace');
  if (generation !== ligatureGeneration) return;
  checkbox.disabled = !supported;
  row.classList.toggle('disabled', !supported);
  if (supported) {
    status.textContent = '';
    return;
  }
  if (checkbox.checked) checkbox.checked = false;
  status.textContent = '当前字体不支持连字，无法启用。';
}
function renderTheme() {
  const select = byId('colorTheme');
  select.replaceChildren();
  state.themes.forEach(theme => {
    const option = document.createElement('option');
    option.value = theme.id;
    option.textContent = theme.label;
    select.append(option);
  });
  select.value = state.themes.some(theme => theme.id === state.colorTheme) ? state.colorTheme : '';
}
function renderCpp() {
  byId('cppStandard').value = state.cppStandard;
  byId('compilerFlags').value = state.compilerFlags || '（未设置）';
  byId('compileCommand').textContent = state.compiler + ' ' + (state.compilerFlags || '-std=' + state.cppStandard) + ' main.cpp -o main';
}
function applyCppStandardClient(flags, standard) {
  const withoutStandard = flags.replace(/(^|\\s)-std=(?:gnu\\+\\+|c\\+\\+)\\d+\\b/g, ' ').replace(/\\s+/g, ' ').trim();
  return '-std=' + standard + (withoutStandard ? ' ' + withoutStandard : '');
}
function renderHints() {
  const enabled = state.clangdVariableTypeHints;
  byId('clangdVariableTypeHints').checked = enabled;
  byId('hintIt').style.display = enabled ? '' : 'none';
  byId('hintSum').style.display = enabled ? '' : 'none';
  byId('hintVal').style.display = enabled ? '' : 'none';
  byId('hintParamX').style.display = enabled ? '' : 'none';
  byId('hintParamK').style.display = enabled ? '' : 'none';
  byId('hintParamV').style.display = enabled ? '' : 'none';
}
function renderCleanup() {
  byId('executableCleanupEnabled').checked = state.executableCleanupEnabled;
  byId('executableCleanupDelaySeconds').value = state.executableCleanupDelaySeconds;
  const label = state.executableCleanupEnabled
    ? state.executableCleanupDelaySeconds + ' 秒后删除'
    : '已保留';
  byId('fileExeState').textContent = label;
  byId('fileBinState').textContent = label;
  byId('fileDsymState').textContent = label;
  byId('fileExe').classList.toggle('cleaned', state.executableCleanupEnabled);
  byId('fileBin').classList.toggle('cleaned', state.executableCleanupEnabled);
  byId('fileDsym').classList.toggle('cleaned', state.executableCleanupEnabled);
}
function renderAutoSave() {
  byId('autoSave').value = state.autoSave;
  const dot = byId('autoSaveDot');
  const status = byId('autoSaveStatus');
  if (state.autoSave === 'off') {
    dot.style.background = '#f4a261';
    status.textContent = '● 未保存 · 需手动保存（Cmd+S）';
  } else {
    dot.style.background = '#7bc47f';
    const labels = { afterDelay: '✓ 已自动保存 · 延迟后', onFocusChange: '✓ 已自动保存 · 切换焦点时', onWindowChange: '✓ 已自动保存 · 切换窗口时' };
    status.textContent = labels[state.autoSave] || labels.afterDelay;
  }
}
function renderAutoFormat() {
  byId('autoFormat').checked = state.autoFormat;
}
function getCphFileNameTemplateOverrides() {
  try {
    const overrides = JSON.parse(byId('cphFileNameTemplateOverrides').value || '{}');
    return overrides && typeof overrides === 'object' && !Array.isArray(overrides)
      ? Object.entries(overrides).filter(([, template]) => typeof template === 'string')
      : [];
  } catch (error) {
    return [];
  }
}
function renderCphFileNameTemplateOverrides() {
  const editor = byId('cphFileNameTemplateOverridesEditor');
  editor.replaceChildren();
  getCphFileNameTemplateOverrides().forEach(([oj, template]) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:110px minmax(0,1fr) auto;gap:8px;margin-top:8px';
    const ojInput = document.createElement('input');
    ojInput.className = 'cph-override-oj'; ojInput.value = oj; ojInput.placeholder = 'OJ 简称'; ojInput.setAttribute('aria-label', 'OJ 简称');
    const templateInput = document.createElement('input');
    templateInput.className = 'cph-override-template'; templateInput.value = template; templateInput.placeholder = '{ojName}/{contestId}/{problemId}.{ext}'; templateInput.setAttribute('aria-label', '文件名模板');
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'btn secondary cph-override-remove'; remove.textContent = '删除';
    row.append(ojInput, templateInput, remove);
    editor.append(row);
  });
}
function saveCphFileNameTemplateOverrides(force = false) {
  const overrides = {};
  const rows = [...document.querySelectorAll('#cphFileNameTemplateOverridesEditor > div')].map(row => {
    const oj = row.querySelector('.cph-override-oj').value.trim();
    const template = row.querySelector('.cph-override-template').value.trim();
    return { oj, template };
  });
  if (!force && rows.some(({ oj, template }) => Boolean(oj) !== Boolean(template))) return;
  rows.forEach(({ oj, template }) => { if (oj && template) overrides[oj] = template; });
  byId('cphFileNameTemplateOverrides').value = JSON.stringify(overrides, undefined, 2);
  saveCphNaming(false, false);
}
function renderCphFileNameTemplateExample() {
  const sampleValues = { oj: 'CF', ojName: 'Codeforces', contestId: '2078', problemId: 'A', slug: 'Sample_Problem', name: 'Sample Problem', index: 'A', group: 'Codeforces Round 2078', url: 'https://codeforces.com/contest/2078/problem/A', ext: 'cpp', lang: 'cpp' };
  const sampleTemplate = state.cphFileNameTemplate;
  byId('cphFileNameTemplateExample').textContent = sampleTemplate.replace(/\\{(oj|ojName|contestId|problemId|slug|name|index|group|url|ext|lang)\\}/g, (_, key) => sampleValues[key]);
}
function renderCphNaming() {
  byId('cphCustomFileNameEnabled').checked = state.cphCustomFileNameEnabled;
  byId('cphDefaultLanguage').value = state.cphDefaultLanguage;
  byId('cphFileNameTemplate').value = state.cphFileNameTemplate;
  byId('cphFileNameTemplateOverrides').value = state.cphFileNameTemplateOverrides;

  renderCphFileNameTemplateOverrides();
  const preset = byId('cphFileNameTemplatePreset');
  const customTemplate = byId('cphFileNameTemplate');
  const matched = [...preset.options].some(option => option.value !== 'custom' && option.value === state.cphFileNameTemplate);
  preset.value = matched ? state.cphFileNameTemplate : 'custom';
  customTemplate.hidden = matched;
  customTemplate.disabled = matched || !state.cphCustomFileNameEnabled;
  byId('cphFileNameTemplateHelp').hidden = matched;
  renderCphFileNameTemplateExample();
  preset.disabled = !state.cphCustomFileNameEnabled;
  byId('cphFileNameTemplateOverrides').disabled = !state.cphCustomFileNameEnabled;
  document.querySelectorAll('#cphFileNameTemplateOverridesEditor input, #cphFileNameTemplateOverridesEditor button, #addCphFileNameTemplateOverride').forEach(item => item.disabled = !state.cphCustomFileNameEnabled);
  document.querySelectorAll('.cph-naming-setting').forEach(row => row.classList.toggle('disabled', !state.cphCustomFileNameEnabled));
}
function renderDone() {
  byId('doneFont').textContent = state.fontFamily ? state.fontFamily + ' · ' + state.fontSize + 'px' : '编辑器默认 · ' + state.fontSize + 'px';
  byId('doneTheme').textContent = state.themes.find(theme => theme.id === state.colorTheme)?.label || state.colorTheme || '默认';
  byId('doneCpp').textContent = state.cppStandard;
  byId('doneHints').textContent = state.clangdVariableTypeHints ? '显示' : '隐藏';
  byId('doneCleanup').textContent = state.executableCleanupEnabled
    ? state.executableCleanupDelaySeconds + ' 秒后删除'
    : '关闭';
  byId('doneAutoSave').textContent = ({ off: '关闭', afterDelay: '延迟后', onFocusChange: '切换焦点时', onWindowChange: '切换窗口时' })[state.autoSave] || '关闭';
  byId('doneAutoFormat').textContent = state.autoFormat ? '启用' : '关闭';
  byId('doneCphNaming').textContent = state.cphCustomFileNameEnabled ? '自定义命名' : 'CPH 默认命名';
}
function render() {
  renderTheme();
  renderCpp();
  renderHints();
  renderCleanup();
  renderAutoSave();
  renderAutoFormat();
  renderCphNaming();
  renderDone();
  applyFonts();
  byId('fontSize').value = state.fontSize;
  byId('fontLigatures').checked = state.fontLigatures;
  byId('autoDetectColorScheme').checked = state.autoDetectColorScheme;
  setFontPreview();
  renderFonts();
}
function updateDots() {
  const progress = byId('progress');
  progress.replaceChildren();
  PAGES.forEach((page, index) => {
    const dot = document.createElement('span');
    dot.className = 'dot' + (index === currentIndex ? ' active' : '');
    dot.setAttribute('aria-label', page);
    progress.append(dot);
  });
}
function go(nextIndex, direction) {
  if (transitioning || nextIndex < 0 || nextIndex >= PAGES.length) return;
  if (nextIndex === currentIndex) return;
  transitioning = true;
  const current = document.querySelector('.page[data-page="' + PAGES[currentIndex] + '"]');
  const next = document.querySelector('.page[data-page="' + PAGES[nextIndex] + '"]');
  const enterClass = direction === 'next' ? 'enter-right' : 'enter-left';
  const exitClass = direction === 'next' ? 'exit-left' : 'exit-right';
  next.classList.remove('visible', 'exit-left', 'exit-right', 'enter-left', 'enter-right');
  next.classList.add(enterClass);
  next.style.visibility = 'visible';
  void next.offsetWidth;
  next.classList.remove(enterClass);
  next.classList.add('visible');
  current.classList.remove('visible');
  current.classList.add(exitClass);
  currentIndex = nextIndex;
  updateDots();
  setTimeout(() => {
    current.classList.remove('exit-left', 'exit-right');
    current.style.visibility = 'hidden';
    transitioning = false;
  }, 340);
}
function save(page, value) {
  vscode.postMessage({ type: 'save', page, value });
}
const NEXT = {
  welcome: 'font', font: 'theme', theme: 'cpp', cpp: 'clangd', clangd: 'cleanup', cleanup: 'autosave', autosave: 'autoformat', autoformat: 'cphNaming', cphNaming: 'snippets', snippets: 'done'
};
function bindNext(nextId) {
  byId(nextId).addEventListener('click', () => {
    const target = PAGES.indexOf(NEXT[PAGES[currentIndex]]);
    if (target >= 0) go(target, 'next');
  });
}
function bindPrev(prevId) {
  byId(prevId).addEventListener('click', () => go(currentIndex - 1, 'prev'));
}
['welcome-next', 'font-next', 'theme-next', 'cpp-next', 'clangd-next', 'cleanup-next', 'autosave-next', 'autoformat-next', 'cphNaming-next', 'snippets-next'].forEach(bindNext);
['font-prev', 'theme-prev', 'cpp-prev', 'clangd-prev', 'cleanup-prev', 'autosave-prev', 'autoformat-prev', 'cphNaming-prev', 'snippets-prev', 'done-prev'].forEach(bindPrev);
byId('done-finish').addEventListener('click', () => vscode.postMessage({ type: 'complete' }));
byId('openSnippets').addEventListener('click', () => vscode.postMessage({ type: 'snippets' }));
byId('fontFamily').addEventListener('change', () => { selectedFonts[0] = byId('fontFamily').value; setFontPreview(); void updateLigatureSupport(); saveFont(); renderFonts(); });
byId('fontSize').addEventListener('input', () => { const size = Math.min(40, Math.max(1, Number(byId('fontSize').value) || 14)); state.fontSize = size; setFontPreview(); save('font', { fontFamily: serializeFontStack(selectedFonts), fontLigatures: byId('fontLigatures').checked, fontSize: size }); });
byId('fontLigatures').addEventListener('change', () => { state.fontLigatures = byId('fontLigatures').checked; setFontPreview(); save('font', { fontFamily: serializeFontStack(selectedFonts), fontLigatures: state.fontLigatures, fontSize: Number(byId('fontSize').value) || 14 }); });
byId('addFallback').addEventListener('click', () => { if (systemFonts.length) { selectedFonts.push(systemFonts[0]); renderFonts(); setFontPreview(); saveFont(); } });
byId('colorTheme').addEventListener('change', () => { state.colorTheme = byId('colorTheme').value; save('theme', { colorTheme: state.colorTheme, autoDetectColorScheme: byId('autoDetectColorScheme').checked }); });
byId('autoDetectColorScheme').addEventListener('change', () => { state.autoDetectColorScheme = byId('autoDetectColorScheme').checked; save('theme', { colorTheme: byId('colorTheme').value, autoDetectColorScheme: state.autoDetectColorScheme }); });
byId('cppStandard').addEventListener('change', () => { state.cppStandard = byId('cppStandard').value; state.compilerFlags = applyCppStandardClient(state.compilerFlags, state.cppStandard); save('cpp', { cppStandard: state.cppStandard }); renderCpp(); });
byId('clangdVariableTypeHints').addEventListener('change', () => { state.clangdVariableTypeHints = byId('clangdVariableTypeHints').checked; save('clangd', { clangdVariableTypeHints: state.clangdVariableTypeHints }); renderHints(); });
byId('executableCleanupEnabled').addEventListener('change', () => { state.executableCleanupEnabled = byId('executableCleanupEnabled').checked; save('cleanup', { executableCleanupEnabled: state.executableCleanupEnabled, executableCleanupDelaySeconds: Number(byId('executableCleanupDelaySeconds').value) || 60 }); renderCleanup(); });
byId('executableCleanupDelaySeconds').addEventListener('input', () => { const delay = Math.max(1, Math.min(86400, Math.floor(Number(byId('executableCleanupDelaySeconds').value) || 60))); state.executableCleanupDelaySeconds = delay; save('cleanup', { executableCleanupEnabled: byId('executableCleanupEnabled').checked, executableCleanupDelaySeconds: delay }); renderCleanup(); });
byId('autoSave').addEventListener('change', () => { state.autoSave = byId('autoSave').value; save('autosave', { autoSave: state.autoSave }); renderAutoSave(); });
byId('autoFormat').addEventListener('change', () => { state.autoFormat = byId('autoFormat').checked; save('autoformat', { autoFormat: state.autoFormat }); renderDone(); });
function cphNamingValue(restoreCphFileNameSettings) { return { cphCustomFileNameEnabled: byId('cphCustomFileNameEnabled').checked, cphDefaultLanguage: byId('cphDefaultLanguage').value, cphFileNameTemplate: byId('cphFileNameTemplate').value, cphFileNameTemplateOverrides: byId('cphFileNameTemplateOverrides').value, restoreCphFileNameSettings }; }
function saveCphNaming(restoreCphFileNameSettings = false, renderPage = true) { state.cphCustomFileNameEnabled = byId('cphCustomFileNameEnabled').checked; state.cphDefaultLanguage = byId('cphDefaultLanguage').value; state.cphFileNameTemplate = byId('cphFileNameTemplate').value; state.cphFileNameTemplateOverrides = byId('cphFileNameTemplateOverrides').value; save('cphNaming', cphNamingValue(restoreCphFileNameSettings)); if (renderPage) renderCphNaming(); else renderCphFileNameTemplateExample(); renderDone(); }
byId('cphCustomFileNameEnabled').addEventListener('change', () => saveCphNaming(state.cphCustomFileNameEnabled === false && byId('cphCustomFileNameEnabled').checked));
byId('cphDefaultLanguage').addEventListener('change', saveCphNaming);
byId('cphFileNameTemplatePreset').addEventListener('change', () => { const preset = byId('cphFileNameTemplatePreset'), input = byId('cphFileNameTemplate'), custom = preset.value === 'custom'; input.hidden = !custom; input.disabled = !custom; if (custom) { input.focus(); } else { input.value = preset.value; saveCphNaming(); } });
byId('cphFileNameTemplate').addEventListener('input', () => saveCphNaming(false, false));
byId('cphFileNameTemplateOverridesEditor').addEventListener('change', event => { if (event.target.matches('.cph-override-oj, .cph-override-template')) saveCphFileNameTemplateOverrides(); });
byId('cphFileNameTemplateOverridesEditor').addEventListener('click', event => { if (event.target.matches('.cph-override-remove')) { event.target.closest('div').remove(); saveCphFileNameTemplateOverrides(true); } });
byId('addCphFileNameTemplateOverride').addEventListener('click', () => { const editor = byId('cphFileNameTemplateOverridesEditor'); const row = document.createElement('div'); row.style.cssText = 'display:grid;grid-template-columns:110px minmax(0,1fr) auto;gap:8px;margin-top:8px'; const oj = document.createElement('input'); oj.className = 'cph-override-oj'; oj.placeholder = 'OJ 简称'; oj.setAttribute('aria-label', 'OJ 简称'); const template = document.createElement('input'); template.className = 'cph-override-template'; template.placeholder = '{ojName}/{contestId}/{problemId}.{ext}'; template.setAttribute('aria-label', '文件名模板'); const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn secondary cph-override-remove'; remove.textContent = '删除'; row.append(oj, template, remove); editor.append(row); oj.focus(); });
byId('openAutoFormatSettings').addEventListener('click', () => vscode.postMessage({ type: 'autoFormatSettings' }));
byId('openCphSettings').addEventListener('click', () => vscode.postMessage({ type: 'cphSettings' }));
window.addEventListener('message', event => {
  const message = event.data;
  if (message?.type === 'systemFonts') {
    const generation = ++fontDetectionGeneration;
    systemFonts = message.value.fonts;
    monospaceFonts = [];
    fontLoadError = message.value.error || '';
    fontLoadComplete = false;
    if (fontLoadError || !systemFonts.length) {
      fontLoadComplete = true;
      render();
      return;
    }
    void getMonospaceFonts(systemFonts).then(detected => {
      if (generation !== fontDetectionGeneration) return;
      monospaceFonts = detected;
      fontLoadComplete = true;
      render();
    });
  } else if (message?.type === 'state') {
    state = message.value;
    render();
  }
});
document.querySelector('.page[data-page="welcome"]').classList.add('visible');
updateDots();
render();
</script>
</body></html>`;
}

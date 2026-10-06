/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { localize, localizeFormat, localizeToolchainProgress, localizeWebviewHtml } from './localization';
import { FirstRunEditorSession } from './firstRunEditorSession';
import { EnvironmentSetupRunner } from './environmentSetup';
import { firstRunView, type FirstRunEditorState } from './firstRunView';
import { defaultCppTemplate } from './firstRunPreview';
import { EditorPreview } from './editorPreview';
import { findCppStandard, getThemeOptions } from './simpleSettings';

const GETTING_STARTED_VERSION = 'shortestpath.gettingStarted.version';
const GETTING_STARTED_FIRST_RUN_MIGRATION = 'shortestpath.gettingStarted.firstRunMigration.v1';
const FIRST_RUN_CODE_FOLDER = 'shortestpath.gettingStarted.codeFolder';
let activePanel: vscode.WebviewPanel | undefined;
let environmentRunner: EnvironmentSetupRunner | undefined;
let firstRunEditorSession = new FirstRunEditorSession();

type SaveMessage = {
	type: 'save';
	page: 'font' | 'indent' | 'template' | 'theme' | 'clangd' | 'autoformat';
	value: Record<string, unknown>;
	requestId?: number;
};

type FirstRunSetupInfo = { stages: Array<{ id: string; title: string; text: string }> };

type FirstRunMessage =
	| { type: 'startEnvironment' }
	| { type: 'environmentState' }
	| { type: 'nextEditor' }
	| { type: 'nextTemplate' }
	| { type: 'nextWorkspace' }
	| { type: 'chooseWorkspace' }
	| { type: 'editorPreview'; page: 'editor' | 'template'; source?: string; tabSize: number; typeHints: boolean; autoFormat: boolean; requestId: number }
	| { type: 'compilePage' }
	| { type: 'complete'; value: Record<string, unknown> };

type ToolchainInstallResult = {
	readonly success: boolean;
	readonly message: string;
};

function localizePresetValue(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	if (!value || typeof value !== 'object') {
		return '';
	}
	const values = value as Record<string, unknown>;
	const locale = vscode.env.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
	return typeof values[locale] === 'string' ? values[locale] as string
		: typeof values.en === 'string' ? values.en as string
			: typeof values['zh-CN'] === 'string' ? values['zh-CN'] as string
				: '';
}

function loadFirstRunSetupInfo(context: vscode.ExtensionContext): FirstRunSetupInfo {
	type RawPage = { id?: string; title?: unknown; text?: unknown; controls?: Array<{ key?: string; default?: unknown }> };
	type RawPreset = { setupStages?: RawPage[]; pages?: RawPage[]; downloadSources?: Array<{ id: string; label?: unknown; unavailable?: boolean }> };
	const presetPath = path.join(context.extensionPath, 'resources', `${process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux'}.json`);
	const preset = JSON.parse(fs.readFileSync(presetPath, 'utf8')) as RawPreset;
	const pages = preset.pages ?? [];
	const toolchainPages = preset.setupStages ?? pages.slice(1).filter(page => !Array.isArray(page.controls));
	const stages = toolchainPages.map((page, index) => ({
		id: page.id || (index === toolchainPages.length - 1 ? 'toolchain' : `stage-${index}`),
		title: localizePresetValue(page.title),
		text: localizePresetValue(page.text)
	}));
	return { stages };
}

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
	if (!context.globalState.get<boolean>(GETTING_STARTED_FIRST_RUN_MIGRATION)) {
		// Keep the legacy version marker separate from first-run completion.
		await context.globalState.update(GETTING_STARTED_VERSION, undefined);
		await context.globalState.update(GETTING_STARTED_FIRST_RUN_MIGRATION, true);
	}
	const pendingFolder = context.globalState.get<string>(FIRST_RUN_CODE_FOLDER);
	if (pendingFolder && path.isAbsolute(pendingFolder)) {
		const folders = vscode.workspace.workspaceFolders;
		if (folders?.length === 1 && folders[0].uri.toString() === vscode.Uri.file(pendingFolder).toString()) {
			await markFirstRunComplete(context);
			return;
		}
		firstRunEditorSession.workspaceFolder = pendingFolder;
	}
	const firstRun = !vscode.workspace.getConfiguration('shortestpath.setup').get<boolean>('completed');
	if (!firstRun) { return; }
	// Give the workbench a moment to settle, and recheck completion before opening.
	setTimeout(() => {
		if (!vscode.workspace.getConfiguration('shortestpath.setup').get<boolean>('completed')) { openGettingStarted(context); }
	}, 1000);
}

function openGettingStarted(context: vscode.ExtensionContext): void {
	void vscode.commands.executeCommand('shortestpath.mode.solve');
	if (activePanel) {
		activePanel.reveal(vscode.ViewColumn.Active);
		return;
	}
	let isDisposed = false;
	const panel = vscode.window.createWebviewPanel('shortestpath.gettingStarted', localize('初始配置'), vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
	const editorPreview = new EditorPreview();
	context.subscriptions.push(editorPreview);
	activePanel = panel;
	if (!environmentRunner) {
		environmentRunner = createEnvironmentRunner(loadFirstRunSetupInfo(context));
	}
	panel.webview.html = localizeWebviewHtml(getFirstRunHtml());
	// Keep the configuration steps focused on the editor tab.
	void Promise.all([
		vscode.commands.executeCommand('workbench.action.closeSidebar'),
		vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar')
	]);
	panel.webview.onDidReceiveMessage(async (message: SaveMessage | FirstRunMessage) => {
		if (message.type === 'environmentState') {
			await panel.webview.postMessage({ type: 'environmentState', value: environmentRunner?.snapshot });
		}
		if (message.type === 'startEnvironment') {
			await environmentRunner?.run();
		}
		if (message.type === 'nextEditor' || message.type === 'nextTemplate' || message.type === 'nextWorkspace' || message.type === 'compilePage') {
			const ready = !!environmentRunner?.snapshot.ready && !environmentRunner.snapshot.running;
			if (firstRunEditorSession.choosingWorkspace) { return; }
			if (message.type === 'nextWorkspace' && firstRunEditorSession.page !== 'template') { return; }
			if (message.type === 'nextTemplate' && firstRunEditorSession.page !== 'editor' && firstRunEditorSession.page !== 'workspace') { return; }
			if (await firstRunEditorSession.enter(message.type === 'nextWorkspace' ? 'workspace' : message.type === 'nextTemplate' ? 'template' : message.type === 'nextEditor' ? 'editor' : 'compile', ready)) {
				await panel.webview.postMessage({ type: 'firstRunPage', value: firstRunEditorSession.page, state: getFirstRunEditorState(), workspaceFolder: firstRunEditorSession.workspaceFolder });
			}
		}
		if (message.type === 'chooseWorkspace' && firstRunEditorSession.page === 'workspace' && !firstRunEditorSession.finishing && !firstRunEditorSession.choosingWorkspace) {
			const session = firstRunEditorSession;
			session.choosingWorkspace = true;
			let errorMessage: string | undefined;
			try {
				const result = await vscode.window.showOpenDialog({
					canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
					defaultUri: session.workspaceFolder ? vscode.Uri.file(session.workspaceFolder) : vscode.workspace.workspaceFolders?.[0]?.uri,
					openLabel: localize('选择目录'), title: localize('选择代码存放目录')
				});
				const folder = result?.[0];
				if (folder) {
					if (folder.scheme !== 'file' || !path.isAbsolute(folder.fsPath) || !(await fs.promises.stat(folder.fsPath)).isDirectory()) { throw new Error(localize('请选择有效的本地目录。')); }
					if (folder.fsPath !== session.workspaceFolder) { await context.globalState.update(FIRST_RUN_CODE_FOLDER, undefined); }
					session.workspaceFolder = folder.fsPath;
				}
			} catch (error) {
				errorMessage = localizeFormat('无法选择代码存放目录：{0}', error instanceof Error ? error.message : String(error));
			} finally {
				session.choosingWorkspace = false;
				if (activePanel && firstRunEditorSession === session) { await activePanel.webview.postMessage({ type: 'workspaceResult', workspaceFolder: session.workspaceFolder, message: errorMessage }); }
			}
		}
		if (message.type === 'editorPreview' && message.page === firstRunEditorSession.page && (message.page === 'editor' || message.page === 'template')) {
			await firstRunEditorSession.flush();
			try {
				if (message.page === 'template' && (typeof message.source !== 'string' || message.source.length > 100_000)) { throw new Error(localize('模版内容无效或过长。')); }
				const value = await editorPreview.render([2, 4, 8].includes(message.tabSize) ? message.tabSize : 2, message.typeHints === true, message.autoFormat === true, message.page === 'template' ? message.source : undefined);
				if (!isDisposed) { await panel.webview.postMessage({ type: 'editorPreview', requestId: message.requestId, value }); }
			} catch (error) {
				if (!isDisposed) { await panel.webview.postMessage({ type: 'editorPreview', requestId: message.requestId, message: localizeFormat('无法加载代码预览：{0}', error instanceof Error ? error.message : String(error)) }); }
			}
		}
		if (message.type === 'save' && environmentRunner?.snapshot.ready && isEditorPage(message.page)) {
			firstRunEditorSession.save(async () => {
				try {
					await saveState(message.page, message.value);
					if (!isDisposed) { await panel.webview.postMessage({ type: 'saveResult', requestId: message.requestId, success: true }); }
				} catch (error) {
					if (!isDisposed) { await panel.webview.postMessage({ type: 'saveResult', requestId: message.requestId, success: false, message: localizeFormat('无法保存编辑配置：{0}', error instanceof Error ? error.message : String(error)) }); }
				}
			}, message.page === 'template' ? 'template' : 'editor');
		}
		if (message.type === 'complete' && !firstRunEditorSession.choosingWorkspace) {
			try {
				await finishFirstRun(context, panel, message.value);
			} catch (error) {
				if (activePanel) { await activePanel.webview.postMessage({ type: 'completeError', message: localizeFormat('无法完成开箱配置：{0}', error instanceof Error ? error.message : String(error)) }); }
			}
		}
	});
	const configurationListener = vscode.workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration('workbench.colorTheme')) { void panel.webview.postMessage({ type: 'previewRefresh' }); }
	});
	context.subscriptions.push(configurationListener);
	const themeListener = vscode.window.onDidChangeActiveColorTheme(() => {
		if (!isDisposed) { void panel.webview.postMessage({ type: 'previewRefresh' }); }
	});
	context.subscriptions.push(themeListener);
	panel.onDidDispose(() => {
		isDisposed = true;
		activePanel = undefined;
		configurationListener.dispose();
		themeListener.dispose();
		editorPreview.dispose();
		if (!vscode.workspace.getConfiguration('shortestpath.setup').get<boolean>('completed')) {
			setTimeout(() => {
				if (!vscode.workspace.getConfiguration('shortestpath.setup').get<boolean>('completed')) { openGettingStarted(context); }
			}, 100);
		}
	});
}

function createEnvironmentRunner(info: FirstRunSetupInfo): EnvironmentSetupRunner {
	// Reopening setup checks the toolchain without replacing existing preferences.
	const completed = vscode.workspace.getConfiguration('shortestpath.setup').get<boolean>('completed');
	const mode = completed ? 'repair' : 'recommended';
	const compilerFlags = vscode.workspace.getConfiguration('cph.language.cpp', null).get<string>('Args')
		|| vscode.workspace.getConfiguration('c-cpp-compile-run', null).get<string>('cpp-flags') || '';
	const cppStandard = completed ? findCppStandard(compilerFlags) : 'c++20';
	return new EnvironmentSetupRunner([
		...info.stages.map(stage => ({ id: stage.id, title: stage.title, description: stage.text, async run(report: (message: string) => void) {
			const result = await vscode.commands.executeCommand<ToolchainInstallResult>('shortestpath.prepareFirstRunStage', {
				stage: stage.id, reportProgress: (message: string) => report(localizeToolchainProgress(message))
			});
			if (!result?.success) { throw new Error(result?.message || localize('编译环境尚未准备完成。请完成安装后重试。')); }
			report(localizeToolchainProgress(result.message));
			if (stage.id === 'toolchain') {
				const ready = await vscode.commands.executeCommand<boolean>('shortestpath.applyFirstRunSetup', { mode, installToolchain: false, cppStandard, completeSetup: false });
				if (!ready) { throw new Error(localize('编译环境尚未准备完成。请完成安装后重试。')); }
			}
		} })),
		{ id: 'selfTest', title: localize('环境自测'), description: localize('运行 A+B 示例，检查命令行编译、CPH 样例测试与代码提示。'), async run(report) {
			const result = await vscode.commands.executeCommand<ToolchainInstallResult>('shortestpath.selfTestEnvironment', { reportProgress: (message: string) => report(localizeToolchainProgress(message)) });
			if (!result?.success) { throw new Error(result?.message || localize('环境自测失败。')); }
		} }
	], state => {
		if (activePanel) { void activePanel.webview.postMessage({ type: 'environmentState', value: state }).then(undefined, () => undefined); }
	}, localize);
}

async function finishFirstRun(context: vscode.ExtensionContext, panel: vscode.WebviewPanel, value: Record<string, unknown>): Promise<void> {
	const ready = !!environmentRunner?.snapshot.ready && !environmentRunner.snapshot.running;
	const completed = await firstRunEditorSession.complete(ready, async () => {
		const workspaceFolder = firstRunEditorSession.workspaceFolder;
		if (!workspaceFolder || !(await fs.promises.stat(workspaceFolder)).isDirectory()) { throw new Error(localize('请选择有效的本地目录。')); }
		const finalValue = { ...value };
		for (const page of ['font', 'indent', 'theme', 'autoformat', 'clangd', 'template'] as const) {
			if (page === 'template' && finalValue.autoFormat === true) {
				if (typeof finalValue.cppTemplate !== 'string' || finalValue.cppTemplate.length > 100_000) { throw new Error(localize('模版内容无效或过长。')); }
				const preview = new EditorPreview();
				try {
					const result = await preview.render([2, 4, 8].includes(Number(finalValue.tabSize)) ? Number(finalValue.tabSize) : 2, false, true, finalValue.cppTemplate);
					finalValue.cppTemplate = result.source;
				} finally { preview.dispose(); }
			}
			await saveState(page, finalValue);
		}
		await vscode.commands.executeCommand('shortestpath.mode.browse');
		const folders = vscode.workspace.workspaceFolders;
		if (folders?.length !== 1 || folders[0].uri.toString() !== vscode.Uri.file(workspaceFolder).toString()) {
			// The native window can veto switching folders (for example, cancelled
			// unsaved-file confirmation). Confirm completion in the target workspace
			// on activation, and keep this guide available if the switch is cancelled.
			await context.globalState.update(FIRST_RUN_CODE_FOLDER, workspaceFolder);
			await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspaceFolder), { forceReuseWindow: true });
			if (activePanel) { await activePanel.webview.postMessage({ type: 'folderOpenRequested' }); }
			return;
		}
		await markFirstRunComplete(context);
		if (activePanel) { activePanel.dispose(); } else { panel.dispose(); }
		environmentRunner = undefined;
		firstRunEditorSession = new FirstRunEditorSession();
	});
	if (!completed) { void vscode.window.showWarningMessage(localize('编译环境尚未准备完成。请完成安装后重试。')); }
}

async function markFirstRunComplete(context: vscode.ExtensionContext): Promise<void> {
	await context.globalState.update(FIRST_RUN_CODE_FOLDER, undefined);
	await context.globalState.update(GETTING_STARTED_VERSION, currentExtensionVersion());
	await context.globalState.update('shortestpath.setupComplete', true);
	await vscode.workspace.getConfiguration('shortestpath.setup').update('completed', true, vscode.ConfigurationTarget.Global);
}

async function saveState(page: SaveMessage['page'], value: Record<string, unknown>): Promise<void> {
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
		case 'indent': {
			const tabSize = [2, 4, 8].includes(Number(value.tabSize)) ? Number(value.tabSize) : 2;
			await Promise.all([
				settings.update('editor.tabSize', tabSize, vscode.ConfigurationTarget.Global),
				settings.update('editor.insertSpaces', true, vscode.ConfigurationTarget.Global),
				settings.update('editor.detectIndentation', false, vscode.ConfigurationTarget.Global)
			]);
			break;
		}
		case 'template':
			if (typeof value.cppTemplate !== 'string' || value.cppTemplate.length > 100_000) { throw new Error(localize('模版内容无效或过长。')); }
			await settings.update('cph.language.cpp.Template', value.cppTemplate, vscode.ConfigurationTarget.Global);
			break;
		case 'clangd':
			await settings.update('editor.inlayHints.enabled', value.clangdVariableTypeHints !== false ? 'on' : 'off', vscode.ConfigurationTarget.Global);
			break;
		case 'autoformat':
			await Promise.all([
				settings.update('editor.formatOnSave', value.autoFormat === true, vscode.ConfigurationTarget.Global),
				settings.update('editor.formatOnPaste', value.autoFormat === true, vscode.ConfigurationTarget.Global)
			]);
			break;
	}
}

function isEditorPage(page: SaveMessage['page']): boolean {
	return ['font', 'indent', 'theme', 'autoformat', 'clangd', 'template'].includes(page);
}

function getFirstRunEditorState(): FirstRunEditorState {
	const editor = vscode.workspace.getConfiguration('editor', null);
	const colorTheme = vscode.workspace.getConfiguration('workbench', null).get<string>('colorTheme') ?? 'One Monokai';
	const inlayHintsEnabled = editor.get<boolean | string>('inlayHints.enabled') ?? 'on';
	return {
		fontFamily: editor.get<string>('fontFamily') ?? '',
		fontSize: editor.get<number>('fontSize') ?? 14,
		fontLigatures: editor.get<boolean | string>('fontLigatures') === true || editor.get<boolean | string>('fontLigatures') === 'true',
		tabSize: editor.get<number>('tabSize') ?? 2,
		cppTemplate: vscode.workspace.getConfiguration('cph.language.cpp', null).get<string>('Template') ?? defaultCppTemplate,
		colorTheme, themes: getThemeOptions(colorTheme),
		autoDetectColorScheme: vscode.workspace.getConfiguration('window', null).get<boolean>('autoDetectColorScheme') ?? false,
		autoSave: vscode.workspace.getConfiguration('files', null).get<string>('autoSave') ?? 'off',
		autoFormat: editor.get<boolean>('formatOnSave') === true && editor.get<boolean>('formatOnPaste') === true,
		clangdVariableTypeHints: inlayHintsEnabled !== false && inlayHintsEnabled !== 'off'
	};
}

function getFirstRunHtml(): string {
	return firstRunView(environmentRunner!.snapshot, {
		title: localize('编译配置'), intro: localize('检查编译器、运行样例，并验证代码提示。'), setupSteps: localize('开箱配置步骤'),
		start: localize('开始配置'), retry: localize('重试'), next: localize('下一步'), finish: localize('完成'), back: localize('上一步'),
		pending: localize('待检查'), running: localize('正在配置，请等待…'), complete: localize('已完成'), error: localize('失败'),
		ready: localize('环境已就绪，自测通过。'), failed: localize('配置未完成。请展开失败步骤查看日志，然后重试。'),
		waiting: localize('完成环境检查后继续。'),
		editorTitle: localize('编辑配置'), editorIntro: localize('按你的习惯调整编辑体验。'),
		fontSizeLabel: localize('字号'), indentLabel: localize('代码缩进'), themeLabel: localize('颜色主题'),
		autoFormatLabel: localize('自动格式化'), hintsLabel: localize('clang 类型提示'),
		formatHint: localize('保存与粘贴时自动整理代码格式。'), typeHint: localize('在代码旁显示变量的推导类型。'),
		templateTitle: localize('模版配置'), templateIntro: localize('CPH 新建 C++ 文件时会自动填入这份模版。'),
		retryPreview: localize('重试预览'),
		workspaceTitle: localize('代码存放目录'), workspaceIntro: localize('选择一个文件夹存放代码，完成后将自动打开该目录。'),
		workspaceFolderLabel: localize('已选目录'), workspaceEmpty: localize('尚未选择目录。'), chooseWorkspace: localize('选择目录')
	}, getFirstRunEditorState(), firstRunEditorSession.page, firstRunEditorSession.finishing, firstRunEditorSession.workspaceFolder, firstRunEditorSession.choosingWorkspace);
}

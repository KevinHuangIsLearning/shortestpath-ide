/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { test } from 'node:test';
import type { PreviewToken } from '../firstRunPreview';

function renderSettings(showSupport = true): string {
	const exports: { render?: (state: object, showSupport: boolean) => string } = {};
	const source = fs.readFileSync(path.resolve(__dirname, '../simpleSettings.js'), 'utf8');
	vm.runInNewContext(source + '\nexports.render = getHtml;', {
		exports,
		require: () => ({ localize: (text: string) => text, localizeFormat: (text: string, argument: string) => text.replace('{0}', argument) })
	});
	return exports.render!({}, showSupport);
}

test('settings groups preserve each control and expose only the three left navigation choices', () => {
	const html = renderSettings();
	const categories = [...html.matchAll(/<button class="category[^>]*data-category="([^"]+)"/g)].map(match => match[1]);
	assert.deepStrictEqual(categories, ['editor', 'compiler', 'tools']);
	assert.doesNotMatch(html, /settingsSearch|noResults|data-category="all"|role="tab/);
	const controls: Record<string, string[]> = Object.fromEntries([...html.matchAll(/<section class="card" data-category="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)]
		.map(match => [match[1], []]));
	for (const match of html.matchAll(/<section class="card" data-category="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)) {
		controls[match[1]].push(...[...match[2].matchAll(/<(?:input|select|button)[^>]*id="([^"]+)"/g)].map(control => control[1]));
	}
	assert.deepStrictEqual(controls, {
		editor: ['fontFamily', 'fontLigatures', 'fontSize', 'colorTheme', 'configureLocale', 'autoDetectColorScheme', 'autoSave', 'autoFormat', 'autoFormatSettings', 'clangdVariableTypeHints', 'errorLensCodeLensEnabled'],
		compiler: ['cppStandard', 'compilerFlags', 'executableCleanupEnabled', 'executableCleanupDelaySeconds', 'toolchainDiagnostics'],
		tools: ['cphSettings', 'customSubmitScripts', 'shortestPathCppSubmissionLanguage', 'defaultSubmitMethod', 'useExtensionMarketplace', 'gettingStarted', 'checkForUpdates']
	});
	const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
	assert.equal(new Set(ids).size, ids.length);
	for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
		assert.doesNotThrow(() => new Function(match[1]));
	}
});

test('navigation switches complete groups, updates accessible selection and resets scrolling without changing values', () => {
	const html = renderSettings();
	const navigation = html.match(/function selectCategory\(category\) \{[\s\S]*?\n\}/)?.[0];
	assert.ok(navigation);
	const cards = ['editor', 'compiler', 'tools'].map(category => ({ dataset: { category }, hidden: category !== 'editor' }));
	const buttons = cards.map(card => ({
		dataset: card.dataset, textContent: card.dataset.category, active: false, current: '',
		classList: { toggle(_name: string, active: boolean) { buttons.find(button => button.dataset === card.dataset)!.active = active; } },
		setAttribute(_name: string, value: string) { this.current = value; },
		removeAttribute() { this.current = ''; }
	}));
	const title = { textContent: '' };
	const content = { scrollTop: 100 };
	const context = vm.createContext({
		document: { querySelectorAll: (selector: string) => selector === '.category' ? buttons : cards },
		byId: (id: string) => id === 'categoryTitle' ? title : content
	});
	vm.runInContext('let selectedCategory = "editor";\n' + navigation, context);
	for (const category of ['compiler', 'tools', 'editor']) {
		content.scrollTop = 100;
		vm.runInContext(`selectCategory('${category}')`, context);
		assert.deepStrictEqual({
			visible: cards.filter(card => !card.hidden).map(card => card.dataset.category),
			selected: buttons.filter(button => button.active && button.current === 'page').map(button => button.dataset.category),
			title: title.textContent, scrollTop: content.scrollTop
		}, { visible: [category], selected: [category], title: category, scrollTop: 0 });
	}
});

test('documentation and support use labeled icons in the header, including the optional dismissal', () => {
	const header = renderSettings().match(/<header[^>]*>([\s\S]*?)<\/header>/)?.[1];
	assert.ok(header);
	for (const [id, label] of [['openDocumentation', '查看文档'], ['openBuyMeACoffee', 'Buy Me a Coffee'], ['dismissBuyMeACoffee', '7 天内不再显示']]) {
		assert.match(header, new RegExp(`id="${id}"[^>]*aria-label="${label}"[^>]*><svg[^>]*aria-hidden="true"`));
	}
	assert.match(header, /aria-describedby="documentationTooltip"/);
	assert.match(header, /aria-describedby="supportTooltip"/);
	assert.match(header, /id="documentationTooltip"[^>]*role="tooltip"/);
	assert.match(header, /id="supportTooltip"[^>]*role="tooltip"/);
	assert.doesNotMatch(header, /class="card/);
	assert.doesNotMatch(renderSettings(false), /id="(?:openBuyMeACoffee|dismissBuyMeACoffee|buyMeACoffee)"/);
});

test('advanced settings opens from the description and removed controls have no page bindings', () => {
	const html = renderSettings();
	assert.match(html, /<p>[^<]*其他设置可在<a id="advanced" href="#">高级设置<\/a>中调整。<\/p>/);
	assert.doesNotMatch(html, /modernUIEnabled|newFileDefaultLanguage|id="snippets"|byId\('snippets'\)|<button id="advanced"/);
	assert.match(html, /byId\('advanced'\).*event\.preventDefault\(\).*type: 'advanced'/);
});

test('font preview applies current tokens literally and rejects old responses after a theme change', () => {
	const html = renderSettings();
	assert.match(html, /<pre id="fontPreview"[^>]*data-i18n-ignore/);
	const previewFunctions = html.match(/let fontPreviewRequest = 0;[\s\S]*?\nfunction addOptions/)?.[0].replace(/\nfunction addOptions$/, '');
	assert.ok(previewFunctions);
	const children: Array<{ textContent?: string; style?: { cssText: string } }> = [];
	const preview = { textContent: '', replaceChildren() { children.length = 0; }, append(child: typeof children[number]) { children.push(child); } };
	const status = { textContent: '' };
	const messages: Array<{ type: string; requestId: number }> = [];
	const context = vm.createContext({
		byId: (id: string) => id === 'fontPreview' ? preview : status,
		vscode: { postMessage: (message: typeof messages[number]) => messages.push(message) },
		document: { createTextNode: (textContent: string) => ({ textContent }), createElement: () => ({ textContent: '', style: { cssText: '' } }) }
	});
	vm.runInContext(previewFunctions, context);
	vm.runInContext('requestFontPreview(); requestFontPreview();', context);
	vm.runInContext('applyFontPreview({ requestId: 1, lines: [[{text: "old", style: "color:red"}]] });', context);
	assert.equal(children.length, 0);
	vm.runInContext('applyFontPreview({ requestId: 2, lines: [[{text: "<script>", style: "color:blue"}], [{text: "return;", style: "color:green"}]] });', context);
	assert.deepStrictEqual(children.map(child => ({ text: child.textContent, style: child.style?.cssText })), [
		{ text: '<script>', style: 'color:blue' }, { text: '\n', style: undefined }, { text: 'return;', style: 'color:green' }
	]);
	vm.runInContext('applyFontPreview({ requestId: 2, error: "unavailable" });', context);
	assert.equal(status.textContent, 'unavailable');
	assert.deepStrictEqual(messages.map(message => message.requestId), [1, 2]);
});

function createSettingsHost(tokens: () => Promise<PreviewToken[][]> = async () => [[{ text: 'int', style: 'color:blue' }]]) {
	const updates: string[] = [];
	const commands: string[] = [];
	const messages: Array<Record<string, unknown>> = [];
	let receive!: (message: Record<string, unknown>) => Promise<void>;
	let onTheme!: () => void;
	let onDispose!: () => void;
	let disposedListeners = 0;
	const listener = () => ({ dispose() { disposedListeners++; } });
	const panel = {
		webview: {
			html: '',
			async postMessage(message: Record<string, unknown>) { messages.push(JSON.parse(JSON.stringify(message))); return true; },
			onDidReceiveMessage(handler: typeof receive) { receive = handler; return listener(); }
		},
		onDidDispose(handler: () => void) { onDispose = handler; }, reveal() { }, dispose() { onDispose(); }
	};
	const vscode = {
		ViewColumn: { Active: 1 }, ConfigurationTarget: { Global: 1 }, env: { language: 'en' }, extensions: { all: [] },
		window: { createWebviewPanel: () => panel, onDidChangeActiveColorTheme(handler: () => void) { onTheme = handler; return listener(); } },
		workspace: {
			getConfiguration: () => ({ get: () => undefined, async update(key: string) { updates.push(key); } }),
			onDidChangeConfiguration: () => listener()
		},
		commands: { async executeCommand(command: string) { commands.push(command); return command === '_shortestpath.cppPreviewTokens' ? tokens() : undefined; } }
	};
	const exports: { open?: (context: object) => void } = {};
	const source = fs.readFileSync(path.resolve(__dirname, '../simpleSettings.js'), 'utf8');
	vm.runInNewContext(source + '\nexports.open = openSimpleSettings;', {
		exports, console,
		require(id: string) {
			if (id === 'vscode') { return vscode; }
			if (id === './systemFonts') { return { getSystemFonts: async () => ({ fonts: [] }) }; }
			return { localize: (text: string) => text, localizeWebviewHtml: (html: string) => html, localizeFormat: (text: string, argument: string) => text.replace('{0}', argument) };
		}
	});
	exports.open!({ subscriptions: [], globalState: { get: () => undefined } });
	return { receive, onTheme, onDispose, commands, updates, messages, disposedListeners: () => disposedListeners };
}

test('settings preview uses IDE tokens, refreshes on theme changes and leaves removed preferences untouched', async () => {
	const host = createSettingsHost();
	await host.receive({ type: 'fontPreview', requestId: 3 });
	assert.deepStrictEqual(host.messages.find(message => message.type === 'fontPreview'), { type: 'fontPreview', requestId: 3, lines: [[{ text: 'int', style: 'color:blue' }]] });
	host.onTheme();
	assert.ok(host.messages.some(message => message.type === 'refreshFontPreview'));
	await host.receive({ type: 'save', value: { modernUIEnabled: false, newFileDefaultLanguage: 'rust' } });
	assert.ok(host.updates.includes('editor.fontSize'));
	assert.deepStrictEqual(host.updates.filter(key => ['workbench.experimental.modernUI', 'shortestpath.newFile.defaultLanguage'].includes(key)), []);
	await host.receive({ type: 'advanced' });
	assert.deepStrictEqual(host.commands, ['_shortestpath.cppPreviewTokens', 'workbench.action.openSettings2']);
	host.onDispose();
	assert.equal(host.disposedListeners(), 2);
});

test('disposing settings drops a late font preview response', async () => {
	let release!: (lines: PreviewToken[][]) => void;
	const host = createSettingsHost(() => new Promise(resolve => { release = resolve; }));
	const pending = host.receive({ type: 'fontPreview', requestId: 1 });
	host.onDispose();
	release([[{ text: 'late', style: 'color:red' }]]);
	await pending;
	assert.deepStrictEqual(host.messages.filter(message => message.type === 'fontPreview'), []);
});


test('tools opens initial setup and dismisses the settings modal', async () => {
	const host = createSettingsHost();
	await host.receive({ type: 'gettingStarted' });
	const html = renderSettings();
	assert.match(html, /<label>初始配置<\/label>/);
	assert.doesNotMatch(html, /开始使用|分步引导配置字体/);
	assert.deepStrictEqual({ commands: host.commands, disposedListeners: host.disposedListeners() }, {
		commands: ['shortestpath.openGettingStarted'], disposedListeners: 2
	});
});

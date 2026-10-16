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
		require: (id: string) => id === './templateEditor' ? require('../templateEditor') : ({ localize: (text: string) => text, localizeFormat: (text: string, argument: string) => text.replace('{0}', argument) })
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
		controls[match[1]].push(...[...match[2].matchAll(/<(?:input|select|button|textarea)[^>]*id="([^"]+)"/g)].map(control => control[1]));
	}
	assert.deepStrictEqual(controls, {
		editor: ['fontFamily', 'fontLigatures', 'fontSize', 'tabSize', 'colorTheme', 'configureLocale', 'autoDetectColorScheme', 'autoSave', 'autoFormat', 'autoFormatSettings', 'clangdVariableTypeHints', 'errorLensEnabled'],
		compiler: ['cppStandard', 'compilerFlags', 'executableCleanupEnabled', 'executableCleanupDelaySeconds', 'toolchainDiagnostics'],
		tools: ['cphSettings', 'customSubmitScripts', 'shortestPathCppSubmissionLanguage', 'shortestPathImportCategoryEnabled', 'defaultSubmitMethod', 'browserDarkReaderMode', 'browserDarkReaderDetectDarkTheme', 'browserDarkReaderExcludedHosts', 'atcoderBetterEnabled', 'codeforcesBetterEnabled', 'useExtensionMarketplace', 'gettingStarted', 'checkForUpdates']
	});
	const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
	assert.equal(new Set(ids).size, ids.length);
	for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
		assert.doesNotThrow(() => new Function(match[1]));
	}
});

test('bundled Fira Code stays selectable while system fonts load, fail or are absent', async () => {
	class FontElement {
		children: FontElement[] = [];
		style: Record<string, string> = {};
		value = '';
		textContent = '';
		label = '';
		disabled = false;
		append(child: FontElement) { this.children.push(child); }
		prepend(child: FontElement) { this.children.unshift(child); }
		replaceChildren() { this.children = []; }
		setAttribute() { }
	}
	const primary = new FontElement();
	const status = new FontElement();
	const html = renderSettings();
	const addOptions = html.match(/function addOptions[^\n]+/)?.[0];
	const functions = html.slice(html.indexOf('function fontSelect('), html.indexOf('function apply(state)'));
	assert.ok(addOptions);
	const context = vm.createContext({
		document: { createElement: () => new FontElement() },
		byId: (id: string) => id === 'fontFamily' ? primary : status,
		serializeFont: JSON.stringify,
		updateLigatureSupport: async () => { },
		getMonospaceFonts: async (fonts: string[]) => fonts,
		codeFontPriority: () => 0
	});
	vm.runInContext(`let systemFonts = [], monospaceSystemFonts = [];
		let fontLoadError = '', fontLoadComplete = false, fontDetectionInProgress = false, fontDetectionGeneration = 0;
		let selectedFont = 'Fira Code';\n${addOptions}\n${functions}`, context);
	const snapshot = () => ({
		disabled: primary.disabled, value: primary.value,
		fonts: primary.children.flatMap(group => group.children.map(option => option.value))
	});
	vm.runInContext('renderFonts()', context);
	assert.deepStrictEqual(snapshot(), { disabled: false, value: 'Fira Code', fonts: ['Fira Code'] });
	for (const result of [{ fonts: [] }, { fonts: [], error: 'permission denied' }, { fonts: ['Fira Code', 'Menlo'] }]) {
		await vm.runInContext(`applySystemFonts(${JSON.stringify(result)})`, context);
		assert.deepStrictEqual(snapshot(), {
			disabled: false, value: 'Fira Code', fonts: result.fonts.length ? ['Fira Code', 'Menlo'] : ['Fira Code']
		});
	}
	vm.runInContext(`selectedFont = 'Menlo'`, context);
	await vm.runInContext(`applySystemFonts({ fonts: ['Fira Code', 'Menlo'] })`, context);
	assert.equal(primary.value, 'Menlo');
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

function createSettingsHost(tokens: () => Promise<PreviewToken[][]> = async () => [[{ text: 'int', style: 'color:blue' }]], compilerCommands: Record<string, string> = {}) {
	const updates: string[] = [];
	const savedFlags: Record<string, string> = {};
	const savedValues: Record<string, string | number | boolean | string[]> = {};
	const commands: string[] = [];
	const messages: Array<Record<string, unknown>> = [];
	let receive!: (message: Record<string, unknown>) => Promise<void>;
	let onTheme!: () => void;
	let onConfiguration!: (event: { affectsConfiguration(key: string): boolean }) => void;
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
			getConfiguration: (section?: string) => ({ get: (key: string) => savedValues[section ? section + '.' + key : key] ?? compilerCommands[key], async update(key: string, value: string | number | boolean | string[], target: number) {
				assert.equal(target, vscode.ConfigurationTarget.Global);
				savedValues[key] = value;
				updates.push(key);
				if ((key === 'judger.language.cpp.Args' || key === 'c-cpp-compile-run.cpp-flags') && typeof value === 'string') { savedFlags[key] = value; }
			} }),
			onDidChangeConfiguration(handler: typeof onConfiguration) { onConfiguration = handler; return listener(); }
		},
		commands: { async executeCommand(command: string) { commands.push(command); return command === '_shortestpath.cppPreviewTokens' ? tokens() : undefined; } }
	};
	const exports: { open?: (context: object) => void } = {};
	const source = fs.readFileSync(path.resolve(__dirname, '../simpleSettings.js'), 'utf8');
	vm.runInNewContext(source + '\nexports.open = openSimpleSettings;', {
		exports, console,
		require(id: string) {
			if (id === 'vscode') { return vscode; }
			if (id === './templateEditor') { return require('../templateEditor'); }
			if (id === './bundledFont') { return { withBundledCodeFont: (html: string) => html }; }
			if (id === './systemFonts') { return { getSystemFonts: async () => ({ fonts: [] }) }; }
			if (id === './compilerRuntime') { return require('../compilerRuntime'); }
			return { localize: (text: string) => text, localizeWebviewHtml: (html: string) => html, localizeFormat: (text: string, argument: string) => text.replace('{0}', argument) };
		}
	});
	exports.open!({ subscriptions: [], globalState: { get: () => undefined } });
	return { receive, onTheme, onConfiguration, onDispose, commands, updates, savedFlags, savedValues, panel, messages, disposedListeners: () => disposedListeners };
}

test('tab width in the font settings saves globally and refreshes after external changes', async () => {
	const host = createSettingsHost();
	const state = () => {
		host.onConfiguration({ affectsConfiguration: key => key === 'editor.tabSize' });
		return host.messages.at(-1)!.value as Record<string, unknown>;
	};
	assert.equal(state().tabSize, 2);
	for (const tabSize of [4, 8, 3, 1, 100]) {
		await host.receive({ type: 'save', value: { ...state(), tabSize } });
		assert.deepEqual({
			tabSize: state().tabSize,
			insertSpaces: host.savedValues['editor.insertSpaces'],
			detectIndentation: host.savedValues['editor.detectIndentation']
		}, { tabSize, insertSpaces: true, detectIndentation: false });
	}
	host.savedValues['editor.tabSize'] = 6;
	assert.equal(state().tabSize, 6);
	host.onDispose();
});

test('other settings and invalid tab widths leave indentation preferences untouched', async () => {
	const host = createSettingsHost();
	Object.assign(host.savedValues, { 'editor.tabSize': 4, 'editor.insertSpaces': false, 'editor.detectIndentation': true });
	for (const tabSize of [undefined, 4, 0, -1, 1.5, 101, Number.MAX_SAFE_INTEGER, NaN, Infinity, '8']) {
		await host.receive({ type: 'save', value: { fontSize: 16, tabSize } });
	}
	assert.deepEqual(host.updates.filter(key => ['editor.tabSize', 'editor.insertSpaces', 'editor.detectIndentation'].includes(key)), []);
	host.onDispose();
});

test('font settings populate and serialize the tab width control', () => {
	const html = renderSettings();
	const fontCard = html.match(/<section class="card" data-category="editor"><h3>字体<\/h3>([\s\S]*?)<\/section>/)?.[1];
	assert.ok(fontCard);
	assert.match(fontCard, /<label for="tabSize">缩进<\/label><\/div><input id="tabSize"/);
	const localization: { localize?: (text: string) => string; localizeWebviewHtml?: (html: string) => string } = {};
	vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../localization.js'), 'utf8'), {
		exports: localization, require: () => ({ env: { language: 'en' } })
	});
	assert.equal(localization.localize!('缩进'), 'Indentation');
	assert.match(localization.localizeWebviewHtml!(html), /"缩进":"Indentation"/);
	const elements = new Map<string, { value: string | number; checked: boolean; textContent: string; replaceChildren(): void }>();
	const byId = (id: string) => {
		if (!elements.has(id)) { elements.set(id, { value: '', checked: false, textContent: '', replaceChildren() { } }); }
		return elements.get(id)!;
	};
	const context = vm.createContext({ byId, normalizeFont: (font: string) => font, serializeFont: (font: string) => font, setPreview() { }, renderFonts() { } });
	vm.runInContext('let selectedFont;\n' + html.slice(html.indexOf('function apply(state)'), html.indexOf('let saveTimer;')), context);
	vm.runInContext('apply({ fontFamily: "Fira Code", tabSize: 6, themes: [] });', context);
	assert.equal(byId('tabSize').value, 6);
	byId('tabSize').value = '8';
	assert.equal(vm.runInContext('value().tabSize', context), 8);
});

test('saving custom compiler options retains junction flags for each configured compiler', async () => {
	const alias = 'C:\\.shortestpath-toolchain-0123456789ab\\User\\globalStorage\\shortestpath.shortestpath-setup\\toolchains\\winlibs\\mingw64-ucrt-15\\bin\\g++.exe';
	for (const compileRun of [alias, 'C:\\Custom\\clang++.exe']) {
		const host = createSettingsHost(undefined, { 'judger.language.cpp.Command': alias, 'c-cpp-compile-run.cpp-compiler': compileRun });
		await host.receive({ type: 'save', value: { cppStandard: 'c++23', compilerFlags: '-O0 -DLOCAL' } });
		assert.deepEqual(host.savedFlags, {
			'judger.language.cpp.Args': '-std=c++23 -O0 -DLOCAL -no-canonical-prefixes',
			'c-cpp-compile-run.cpp-flags': `-std=c++23 -O0 -DLOCAL${compileRun === alias ? ' -no-canonical-prefixes' : ''}`
		});
	}
});

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

test('Error Lens toggle controls the extension enable setting', async () => {
	const host = createSettingsHost();
	assert.match(renderSettings(), /<label for="errorLensEnabled">Error Lens Enable<\/label>/);
	host.onConfiguration({ affectsConfiguration: key => key === 'errorLens.enabled' });
	assert.equal((host.messages.find(message => message.type === 'state')?.value as { errorLensEnabled: boolean }).errorLensEnabled, true);
	await host.receive({ type: 'save', value: { errorLensEnabled: false } });
	assert.deepStrictEqual(host.updates.filter(key => key.startsWith('errorLens.')), ['errorLens.enabled']);
});


test('Better switches in custom settings preserve independent values and refresh from configuration', async () => {
	const host = createSettingsHost();
	const state = () => {
		host.onConfiguration({ affectsConfiguration: key => key === 'shortestpath.ojbetter' });
		return host.messages.at(-1)!.value as Record<string, unknown>;
	};
	assert.equal(state().atcoderBetterEnabled, true);
	assert.equal(state().codeforcesBetterEnabled, true);
	for (const [atcoderBetterEnabled, codeforcesBetterEnabled] of [[false, true], [true, false]]) {
		await host.receive({ type: 'save', value: { ...state(), cppTemplate: '', atcoderBetterEnabled, codeforcesBetterEnabled } });
		assert.equal(host.savedValues['shortestpath.ojbetter.atcoder'], atcoderBetterEnabled);
		assert.equal(host.savedValues['shortestpath.ojbetter.codeforces'], codeforcesBetterEnabled);
		assert.equal(state().atcoderBetterEnabled, atcoderBetterEnabled);
		assert.equal(state().codeforcesBetterEnabled, codeforcesBetterEnabled);
	}
});


test('Dark Reader settings save globally, round-trip and refresh when changed from the browser toolbar', async () => {
	const host = createSettingsHost();
	const state = () => host.messages.filter(message => message.type === 'state').at(-1)?.value as Record<string, unknown>;
	for (const mode of ['on', 'off', 'auto']) {
		await host.receive({ type: 'save', value: { browserDarkReaderMode: mode, browserDarkReaderDetectDarkTheme: false, browserDarkReaderExcludedHosts: [' WWW.Example.COM. ', '', 'www.example.com', 'sub.example.com'] } });
		assert.equal(host.savedValues['workbench.browser.darkReader.mode'], mode);
		assert.equal(host.savedValues['workbench.browser.darkReader.detectDarkTheme'], false);
		assert.deepEqual(Array.from(host.savedValues['workbench.browser.darkReader.excludedHosts'] as string[]), ['www.example.com', 'sub.example.com']);
		host.onConfiguration({ affectsConfiguration: key => key === 'workbench.browser.darkReader' });
		assert.equal(state().browserDarkReaderMode, mode);
		assert.equal(state().browserDarkReaderDetectDarkTheme, false);
		assert.deepEqual(state().browserDarkReaderExcludedHosts, ['www.example.com', 'sub.example.com']);
	}
	host.savedValues['workbench.browser.darkReader.detectDarkTheme'] = true;
	host.onConfiguration({ affectsConfiguration: key => key === 'workbench.browser.darkReader' });
	assert.equal(state().browserDarkReaderDetectDarkTheme, true);
	await host.receive({ type: 'save', value: { browserDarkReaderMode: 'invalid', browserDarkReaderExcludedHosts: [42] } });
	assert.equal(host.savedValues['workbench.browser.darkReader.mode'], 'auto');
	assert.deepEqual(Array.from(host.savedValues['workbench.browser.darkReader.excludedHosts'] as string[]), ['www.example.com', 'sub.example.com']);
	await host.receive({ type: 'save', value: { browserDarkReaderExcludedHosts: [] } });
	host.onConfiguration({ affectsConfiguration: key => key === 'workbench.browser.darkReader' });
	assert.deepEqual(state().browserDarkReaderExcludedHosts, []);
	host.onDispose();
});

test('Dark Reader controls serialize hostnames and restore values without treating sites as HTML', () => {
	const html = renderSettings();
	assert.match(html, /textarea class="excluded-hosts" id="browserDarkReaderExcludedHosts"[^>]*data-i18n-ignore/);
	const elements: Record<string, { value: string; checked: boolean }> = {};
	const byId = (id: string) => elements[id] ??= { value: '', checked: false };
	const context = vm.createContext({ byId, serializeFont: () => '', selectedFont: '', Number });
	const bindings = html.match(/byId\('browserDarkReaderMode'\)\.value[\s\S]*?byId\('browserDarkReaderExcludedHosts'\)\.value[^;]+;/)?.[0];
	const collect = html.match(/function value\(\) \{[^\n]+/)?.[0];
	assert.ok(bindings && collect);
	vm.runInContext(`const state = { browserDarkReaderMode: 'off', browserDarkReaderDetectDarkTheme: false, browserDarkReaderExcludedHosts: ['www.example.com', '<script>'] };\n${bindings}\n${collect}`, context);
	assert.equal(byId('browserDarkReaderExcludedHosts').value, 'www.example.com\n<script>');
	const values = JSON.parse(JSON.stringify(vm.runInContext('value()', context)));
	assert.equal(values.browserDarkReaderMode, 'off');
	assert.equal(values.browserDarkReaderDetectDarkTheme, false);
	assert.deepEqual(values.browserDarkReaderExcludedHosts, ['www.example.com', '<script>']);
});


test('ShortestPath category import defaults off, saves globally and refreshes external changes', async () => {
	const host = createSettingsHost();
	const state = () => {
		host.onConfiguration({ affectsConfiguration: key => key === 'judger.general.shortestPathImportCategoryEnabled' });
		return host.messages.at(-1)!.value as Record<string, unknown>;
	};
	assert.equal(state().shortestPathImportCategoryEnabled, false);
	for (const shortestPathImportCategoryEnabled of [false, true]) {
		await host.receive({ type: 'save', value: { ...state(), shortestPathImportCategoryEnabled } });
		assert.equal(host.savedValues['judger.general.shortestPathImportCategoryEnabled'], shortestPathImportCategoryEnabled);
		assert.equal(state().shortestPathImportCategoryEnabled, shortestPathImportCategoryEnabled);
	}
	host.savedValues['judger.general.shortestPathImportCategoryEnabled'] = false;
	assert.equal(state().shortestPathImportCategoryEnabled, false);
	host.onDispose();
});

test('category import checkbox restores and serializes both values', () => {
	const html = renderSettings();
	assert.match(html, /<input id="shortestPathImportCategoryEnabled" type="checkbox"/);
	const elements: Record<string, { value: string; checked: boolean }> = {};
	const byId = (id: string) => elements[id] ??= { value: '', checked: false };
	const context = vm.createContext({ byId, serializeFont: () => '', selectedFont: '', Number });
	const binding = html.match(/byId\('shortestPathImportCategoryEnabled'\)\.checked[^;]+;/)?.[0];
	const collect = html.match(/function value\(\) \{[^\n]+/)?.[0];
	assert.ok(binding && collect);
	for (const enabled of [false, true]) {
		vm.runInContext(`var state = { shortestPathImportCategoryEnabled: ${enabled} };\n${binding}\n${collect}`, context);
		assert.equal(byId('shortestPathImportCategoryEnabled').checked, enabled);
		assert.equal(vm.runInContext('value().shortestPathImportCategoryEnabled', context), enabled);
	}
});

test('template reserves native editor space and settings autosaves do not carry stale code', async () => {
	const html = renderSettings();
	assert.match(html, /<div id="cppTemplate"[^>]*role="group"[^>]*data-i18n-ignore><\/div>/);
	assert.doesNotMatch(html, /<textarea[^>]*id="cppTemplate"/);
	const collect = html.match(/function value\(\) \{[^\n]+/)![0];
	assert.doesNotMatch(collect, /cppTemplate/);
	const host = createSettingsHost();
	await host.receive({ type: 'templateEditorLayout', bounds: { left: 20, top: 100, width: 400, height: 360, clipTop: 80, clipBottom: 700 } });
	assert.deepEqual(host.commands, ['_shortestpath.layoutTemplateEditor']);
	await host.receive({ type: 'save', value: { fontSize: 18 } });
	assert.equal(host.updates.includes('judger.language.cpp.Template'), false);
	host.onDispose();
});

test('template geometry follows scroll clipping and hides when its settings category is hidden', () => {
	const html = renderSettings();
	const layout = html.match(/function layoutTemplateEditor\(\) \{[\s\S]*?\n\}/)![0];
	const rect = { left: 220, top: 40 };
	const slot = { clientLeft: 1, clientTop: 1, clientWidth: 600, clientHeight: 360, getBoundingClientRect: () => rect };
	const messages: Array<{ bounds: object }> = [];
	const context = vm.createContext({
		byId: (id: string) => id === 'cppTemplate' ? slot : { getBoundingClientRect: () => ({ top: 100, bottom: 900 }) },
		window: { innerHeight: 800 }, vscode: { postMessage: (message: typeof messages[number]) => messages.push(message) }
	});
	vm.runInContext(layout + '\nlayoutTemplateEditor()', context);
	Object.assign(slot, { clientLeft: 0, clientTop: 0, clientWidth: 0, clientHeight: 0 });
	vm.runInContext('layoutTemplateEditor()', context);
	assert.deepEqual(JSON.parse(JSON.stringify(messages.map(message => message.bounds))), [
		{ left: 221, top: 41, width: 600, height: 360, clipTop: 100, clipBottom: 800 },
		{ left: 220, top: 40, width: 0, height: 0, clipTop: 100, clipBottom: 800 }
	]);
});

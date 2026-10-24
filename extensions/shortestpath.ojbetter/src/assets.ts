/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import { join } from 'path';
import { addIDEProblemEntry, browserBootstrap } from './browserRuntime';
import { platformForUrl, Platform } from './sites';

interface Script {
	file: string;
	name: string;
	version: string;
	requires: string[];
	resources: Record<string, string>;
}

export interface Manifest {
	commit: string;
	scripts: Record<Platform, Script>;
	assets: Record<string, { file: string; sha256: string; integrity?: string }>;
	files: Record<string, string>;
}

/** Fixed upstream function boundaries; fail closed if an update changes their layout. */
export function adaptScript(source: string): string {
	const replace = (name: string, replacement: string) => {
		const start = source.indexOf(`async function ${name}(`);
		const end = source.indexOf('\n}', start) + 2;
		if (start < 0 || end <= start || source.indexOf(`async function ${name}(`, start + 1) >= 0) {
			throw new Error(`OJBetter adapter no longer matches ${name}`);
		}
		source = source.slice(0, start) + replacement + source.slice(end);
	};
	replace('OJB_LoadJS', `async function OJB_LoadJS(url) {
		if (url.endsWith('/selectpage.min.js')) return;
		throw new Error('OJBetter: unsupported dynamic library ' + url);
	}`);
	replace('checkScriptVersion', `async function checkScriptVersion() { /* Bundled scripts update with the IDE. */ }`);
	replace('initMonacoEditor', `async function initMonacoEditor() { OJBetter.monaco.loaderOnload = true; }`);
	// Keep upstream language selection, sample execution and submission, using its
	// actual source textarea directly instead of a second editor implementation.
	replace('createMonacoEditor', `async function createMonacoEditor(language, form) {
		form.editorDiv.remove();
		form.sourceDiv.css({display: 'block', width: '100%', minHeight: '240px', resize: 'vertical', boxSizing: 'border-box', padding: '8px', fontFamily: 'monospace'});
		const label = document.getElementById('shortestpath-ojbetter-ide')?.dataset.pasteLabel;
		if (label) form.sourceDiv.attr({placeholder: label, 'aria-label': label});
		form.sourceDiv.attr({spellcheck: 'false', 'data-i18n-ignore': ''});
		form.submitDiv.append(form.runButton, form.submitButton);
		OJBetter.monaco.editor = {getValue: () => form.sourceDiv.val(), setValue: value => form.sourceDiv.val(value), dispose: () => {}};
		if (!form.sourceDiv.data('shortestpathPasteReady')) {
			form.sourceDiv.data('shortestpathPasteReady', true);
			let edited = false;
			const url = location.href.replace(/#/, '');
			form.sourceDiv.on('input', () => {
				edited = true;
				if (OJBetter.monaco.setting.autoMemoryCode) void saveCode(url, form.sourceDiv.val()).catch(console.error);
			});
			if (OJBetter.monaco.setting.autoMemoryCode) {
				const saved = await getCode(url);
				if (!edited && typeof saved === 'string') form.sourceDiv.val(saved);
			}
		}
	}`);
	const problemEntry = 'async function addProblemPageCodeEditor() {';
	if (source.split(problemEntry).length !== 2) { throw new Error('OJBetter problem entry boundary changed'); }
	source = source.replace(problemEntry, problemEntry + '\naddIDEProblemEntry(importProblem, ideLanguage);');
	const formReady = 'let selectLang = form.selectLang;';
	if (source.split(formReady).length !== 2) { throw new Error('OJBetter paste form boundary changed'); }
	source = source.replace(formReady, 'await createMonacoEditor(null, form);\n' + formReady);
	const initialLanguage = 'selectLang.val(initLang).trigger(\'change\');';
	if (source.split(initialLanguage).length !== 2) { throw new Error('OJBetter initial language boundary changed'); }
	source = source.replace(initialLanguage, `
		if (selectLang.length) {
			const options = selectLang.find('option').filter((_, option) => option.value && option.value !== 'ojb_show_all');
			if (!options.toArray().some(option => option.value === String(initLang))) initLang = options.first().val();
			selectLang.val(initLang).trigger('change');
		} else {
			submitButton.prop('disabled', true);
			if (OJBetter.monaco.onlineCompilerChoice === 'official') runButton.prop('disabled', true);
		}
	`);
	const editorEnabled = /OJBetter\.typeOfPage\.is_problem\s*&&\s*OJBetter\.monaco\.enableOnProblemPage/g;
	if ([...source.matchAll(editorEnabled)].length !== 1) { throw new Error('OJBetter problem entry boundary changed'); }
	source = source.replace(editorEnabled, 'OJBetter.typeOfPage.is_problem');
	// Code blocks use the already bundled highlighter instead of creating more editor runtimes.
	replace('beautifyPreBlocksWithMonaco', `async function beautifyPreBlocksWithMonaco() {
		for (const pre of document.querySelectorAll('pre')) {
			if (pre.classList.contains('source-code-for-copy')) continue;
			const code = pre.querySelector('code') || pre;
			if (!code.childElementCount && !code.dataset.highlighted) hljs.highlightElement(code);
		}
	}`);
	// Keep hidden form controls mounted for upstream settings serialization.
	for (const [marker, replacement] of [
		['<h4 data-i18n="settings:codeEditor.lsp.title"></h4>', '<div hidden><h4 data-i18n="settings:codeEditor.lsp.title"></h4>'],
		['<div id="Complet_config" class="config"></div>', '<div id="Complet_config" class="config"></div></div>']
	]) {
		if (source.split(marker).length !== 2) { throw new Error('OJBetter editor settings adapter boundaries changed'); }
		source = source.replace(marker, replacement);
	}
	replace('initI18next', `async function initI18next() {
		await i18next.init({ lng: OJBetter.localization.scriptLang, resources: ojbetterLocales,
			defaultNS: 'settings', fallbackLng: ['zh', OJBetter.translation.targetLang], load: 'currentOnly' });
		jqueryI18next.init(i18next, $, { useOptionsAttr: true });
	}`);
	return source.replaceAll('window.location.reload()', '__ojbetterReload()').replaceAll('location.reload()', '__ojbetterReload()');
}

/** Read bundled payloads, allowing packaging transforms and local edits. */
export class Assets {
	readonly manifest: Manifest;
	private readonly contents = new Map<string, string>();
	private readonly scripts: Record<Platform, string>;
	private readonly common: string;

	constructor(root: string) {
		this.manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
		for (const file of Object.keys(this.manifest.files)) {
			this.contents.set(file, readFileSync(join(root, file), 'utf8'));
		}
		const requires = this.manifest.scripts.atcoder.requires;
		if (JSON.stringify(requires) !== JSON.stringify(this.manifest.scripts.codeforces.requires)) {
			throw new Error('OJBetter scripts require different dependency order');
		}
		this.common = `
			${this.read('vendor/jquery.min.js.txt')}
			${requires.map(file => this.read(file)).join('\n;\n')}
			${this.read('vendor/selectpage.min.js.txt')}
			${this.read('vendor/katex.min.js.txt')}
			${this.read('vendor/katex-auto-render.min.js.txt')}
			GM_addStyle(${JSON.stringify(this.read('vendor/katex.css.txt'))});
			const MathJax = { Hub: { queue: {pending: 0, running: 0}, Queue: command => {
				renderMathInElement(command[2], {throwOnError: false, delimiters: ${JSON.stringify([
			{ left: '$$$$$$', right: '$$$$$$', display: true },
			{ left: '$$$', right: '$$$', display: false },
			{ left: '$$', right: '$$', display: true },
			{ left: '$', right: '$', display: false },
			{ left: '\\(', right: '\\)', display: false },
			{ left: '\\[', right: '\\]', display: true }
		])}});
			} } };
			const addIDEProblemEntry = ${addIDEProblemEntry.toString()};
			// Compatibility for upstream theme hooks and language detection; no editor implementation here.
			const monaco = {editor: {setTheme: () => {}}, languages: {getLanguages: () => []}};
		`;
		this.scripts = Object.fromEntries((['atcoder', 'codeforces'] as const).map(platform => {
			const script = this.manifest.scripts[platform];
			const resources = Object.fromEntries(Object.entries(script.resources).map(([key, file]) => [key, this.read(file)]));
			const locales: Record<string, Record<string, object>> = {};
			for (const [url, entry] of Object.entries(this.manifest.assets)) {
				const match = new URL(url).pathname.match(/^\/(?:i18n\/([^/]+)\/)?resources\/locales\/([^/]+)\/([^/]+)\.json$/);
				if (match?.[2] === `${platform}-better`) {
					const language = match[1] ?? 'zh';
					(locales[language] ??= {})[match[3]] = JSON.parse(this.read(entry.file));
				}
			}
			return [platform, `
				const GM_info = ${JSON.stringify({ script: { name: script.name, version: script.version }, scriptHandler: 'ShortestPath IDE' })};
				const resources = ${JSON.stringify(resources)};
				const GM_getResourceText = name => resources[name];
				const ojbetterLocales = ${JSON.stringify(locales)};
				${adaptScript(this.read(script.file)).replaceAll('//aowuucdn.oss-accelerate.aliyuncs.com/iconfont/iconfont.woff2', this.read('vendor/iconfont.data.txt'))}
				globalThis.__shortestpathOJBetter = {platform, version: GM_info.script.version, state: OJBetter};
			`];
		})) as Record<Platform, string>;
	}

	private read(file: string): string {
		const content = this.contents.get(file);
		if (content === undefined) {
			throw new Error(`Missing OJBetter asset: ${file}`);
		}
		return content;
	}

	localResource(url: string): string | undefined {
		const normalized = new URL(url);
		normalized.hash = '';
		normalized.search = '';
		const asset = this.manifest.assets[normalized.href];
		return asset ? this.read(asset.file) : undefined;
	}

	source(bindingName: string, enabled: Record<Platform, boolean>, language = 'en'): string {
		return `(async function () {
			const platform = (${platformForUrl.toString()})(location.href);
			if (!platform || !${JSON.stringify(enabled)}[platform] || window !== window.top || globalThis.__shortestpathOJBetterStarting) return;
			globalThis.__shortestpathOJBetterStarting = true;
			try {
				const {GM_getValue, GM_setValue, GM_deleteValue, GM_listValues, GM_addStyle, GM_setClipboard, GM_xmlhttpRequest, getSiteData, flushValues, importProblem} = await (${browserBootstrap.toString()})(${JSON.stringify(bindingName)});
				const ideLanguage = ${JSON.stringify(language)};
				const __ojbetterReload = async () => { await flushValues(); window.location.reload(); };
				if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, {once:true}));
				const siteData = await getSiteData();
				const csrfToken = siteData.csrfToken;
				const Codeforces = {getCsrfToken: () => csrfToken, showMessage: text => { alert(text); }};
				const ace = {edit: element => ({getValue: () => siteData.ace[Number(element.getAttribute('data-shortestpath-ace'))] ?? element.textContent})};
				${this.common}
				if (platform === 'atcoder') { ${this.scripts.atcoder} } else { ${this.scripts.codeforces} }
			} catch (error) {
				globalThis.__shortestpathOJBetterStarting = false;
				console.error('OJBetter initialization failed', error);
			}
		})();`;
	}
}

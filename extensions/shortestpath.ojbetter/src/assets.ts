/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import { join } from 'path';
import { browserBootstrap } from './browserRuntime';
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
		if (url.endsWith('/selectpage.min.js') || url.endsWith('/monaco-editor/0.49.0/min/vs/loader.min.js')) return;
		throw new Error('OJBetter: unsupported dynamic library ' + url);
	}`);
	replace('checkScriptVersion', `async function checkScriptVersion() { /* Bundled scripts update with the IDE. */ }`);
	replace('initMonacoEditor', `async function initMonacoEditor() { OJBetter.monaco.loaderOnload = true; }`);
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
		const workers = Object.fromEntries(['editor', 'json', 'css', 'html', 'typescript'].map(name => [name, this.read(`vendor/monaco-${name}.worker.js.txt`)]));
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
			const workerSources = ${JSON.stringify(workers)};
			globalThis.MonacoEnvironment = { getWorker: (_moduleId, label) => {
				const name = ['json','css','html'].includes(label) ? label : ['javascript','typescript'].includes(label) ? 'typescript' : 'editor';
				const url = URL.createObjectURL(new Blob([workerSources[name]], {type:'text/javascript'}));
				const worker = new Worker(url); URL.revokeObjectURL(url); return worker;
			} };
			${this.read('vendor/monaco.js.txt')}
			globalThis.monaco = shortestpathMonaco;
			GM_addStyle(${JSON.stringify(this.read('vendor/monaco.css.txt'))});
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

	source(bindingName: string, enabled: Record<Platform, boolean>): string {
		return `(async function () {
			const platform = (${platformForUrl.toString()})(location.href);
			if (!platform || !${JSON.stringify(enabled)}[platform] || window !== window.top || globalThis.__shortestpathOJBetterStarting) return;
			globalThis.__shortestpathOJBetterStarting = true;
			try {
				const {GM_getValue, GM_setValue, GM_deleteValue, GM_listValues, GM_addStyle, GM_setClipboard, GM_xmlhttpRequest, getSiteData, flushValues} = await (${browserBootstrap.toString()})(${JSON.stringify(bindingName)});
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

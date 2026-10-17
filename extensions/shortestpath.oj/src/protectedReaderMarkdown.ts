/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import MarkdownIt from 'markdown-it';
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import type { ThemeRegistration } from 'shiki';
import { createMarkdownRendererWithHighlighter } from './markdownRenderer';

const grammars = {
	cpp: () => import('shiki/langs/cpp.mjs'),
	python: () => import('shiki/langs/python.mjs'),
	java: () => import('shiki/langs/java.mjs'),
	javascript: () => import('shiki/langs/javascript.mjs'),
	typescript: () => import('shiki/langs/typescript.mjs'),
	bash: () => import('shiki/langs/bash.mjs'),
	json: () => import('shiki/langs/json.mjs'),
};
// Include the embedded languages that were available with the eager C++ grammar.
const aliases: Record<string, keyof typeof grammars | undefined> = {
	cpp: 'cpp', 'c++': 'cpp', c: 'cpp', 'cpp-macro': 'cpp', glsl: 'cpp', sql: 'cpp', regexp: 'cpp', regex: 'cpp',
	python: 'python', py: 'python', java: 'java',
	javascript: 'javascript', js: 'javascript', cjs: 'javascript', mjs: 'javascript',
	typescript: 'typescript', ts: 'typescript', cts: 'typescript', mts: 'typescript',
	shellscript: 'bash', bash: 'bash', sh: 'bash', shell: 'bash', zsh: 'bash', json: 'json',
};

/** Prepare only the grammars present in this surface, sharing them across later paints. */
export function createProtectedMarkdownRenderer(getTheme: () => string | ThemeRegistration) {
	const highlighter = createHighlighterCore({
		themes: [import('shiki/themes/github-dark.mjs'), import('shiki/themes/github-light.mjs')],
		langs: [],
		engine: createJavaScriptRegexEngine(),
	});
	const renderer = highlighter.then(value => createMarkdownRendererWithHighlighter(value, getTheme));
	const parser = new MarkdownIt({ html: false });
	const loading = new Map<keyof typeof grammars, Promise<void>>();
	const loadLanguages = async (languages: Set<string>) => {
		await Promise.all([...languages].map(async language => {
			const grammar = Object.hasOwn(aliases, language) ? aliases[language] : undefined;
			if (!grammar) { return; }
			let pending = loading.get(grammar);
			if (!pending) {
				pending = (async () => { await (await highlighter).loadLanguage(await grammars[grammar]()); })();
				loading.set(grammar, pending);
			}
			await pending;
		}));
	};
	const prepare = async (markdown: string) => {
		await loadLanguages(new Set(parser.parse(markdown, {}).filter(token => token.type === 'fence').map(token => token.info.trim().split(/\s+/g)[0])));
		return renderer;
	};
	prepare.highlight = async (code: string, language: string) => {
		if (!Object.hasOwn(aliases, language)) { return undefined; }
		await loadLanguages(new Set([language]));
		return (await highlighter).codeToHtml(code, { lang: language, theme: getTheme() });
	};
	prepare.dispose = () => { void highlighter.then(value => value.dispose()); };
	return prepare;
}

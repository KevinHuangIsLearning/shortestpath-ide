/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import MarkdownIt from 'markdown-it';
import markdownItKatex from '@vscode/markdown-it-katex';
import type { HighlighterCore } from 'shiki';
import { registerLatexDelimiterMath } from './markdownItLatexDelimiters';

type RenderEnvironment = { baseUrl: string };

function resolveUrl(value: string, baseUrl: string): string {
	try {
		const url = new URL(value, baseUrl);
		return url.protocol === 'https:' ? url.toString() : '#';
	} catch {
		return '#';
	}
}

function escapeAttribute(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export type ProblemMarkdownRenderer = (markdown: string, baseUrl: string) => string;

export async function createProblemMarkdownRenderer(getTheme: () => string): Promise<ProblemMarkdownRenderer> {
	const { createHighlighter } = await import('shiki');
	const highlighter = await createHighlighter({
		themes: ['github-dark', 'github-light'],
		langs: ['cpp', 'python', 'java', 'javascript', 'typescript', 'bash', 'json', 'text'],
	});

	return createMarkdownRendererWithHighlighter(highlighter, getTheme);
}

function createMarkdownRendererWithHighlighter(highlighter: HighlighterCore, getTheme: () => string): ProblemMarkdownRenderer {
	const markdown = new MarkdownIt({
		html: false,
		breaks: true,
		linkify: false,
	});

	markdown.renderer.rules.fence = (tokens, idx) => {
		const token = tokens[idx];
		const lang = token.info.trim().split(/\s+/g)[0] || 'text';
		const code = token.content;
		try {
			return highlighter.codeToHtml(code, { lang, theme: getTheme() });
		} catch {
			return `<pre><code>${escapeHtml(code)}</code></pre>`;
		}
	};

	markdown.use(markdownItKatex, { throwOnError: false });
	registerLatexDelimiterMath(markdown);

	markdown.validateLink = (url: string): boolean => {
		try {
			const parsed = new URL(url, 'https://shortestpath.cn/');
			return parsed.protocol === 'https:';
		} catch {
			return false;
		}
	};

	const defaultLinkOpen = markdown.renderer.rules.link_open ?? markdown.renderer.renderToken.bind(markdown.renderer);
	markdown.renderer.rules.link_open = (tokens, index, options, env: RenderEnvironment, self) => {
		const token = tokens[index];
		const href = token.attrGet('href');
		token.attrSet('href', href ? resolveUrl(href, env.baseUrl) : '#');
		return defaultLinkOpen(tokens, index, options, env, self);
	};

	markdown.renderer.rules.image = (tokens, index, _options, env: RenderEnvironment) => {
		const token = tokens[index];
		const src = token.attrGet('src');
		return `<img src="${escapeAttribute(src ? resolveUrl(src, env.baseUrl) : '#')}" alt="${escapeAttribute(token.content)}">`;
	};

	return (content: string, baseUrl: string): string => markdown.render(content, { baseUrl });
}

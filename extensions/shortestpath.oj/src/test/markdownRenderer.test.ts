/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import MarkdownIt from 'markdown-it';
import markdownItKatex from '@vscode/markdown-it-katex';
import { registerLatexDelimiterMath } from '../markdownItLatexDelimiters';
import { resolveProblemMarkdownUrl } from '../markdownRenderer';

function createMarkdown(): MarkdownIt {
	const markdown = new MarkdownIt({
		html: false,
		breaks: true,
		linkify: false,
	});
	markdown.use(markdownItKatex, { throwOnError: false });
	registerLatexDelimiterMath(markdown);
	return markdown;
}

suite('ShortestPath OJ Markdown URLs', () => {
	test('resolves root-relative assets against the ShortestPath website', () => {
		assert.equal(
			resolveProblemMarkdownUrl('/assets/problems/299/9f1d54265986-314053_1562642898593_2559_1.jpg', 'https://example.invalid/problem/299'),
			'https://shortestpath.cn/assets/problems/299/9f1d54265986-314053_1562642898593_2559_1.jpg',
		);
	});
});

suite('ShortestPath OJ LaTeX math delimiters', () => {
	test('renders \\(...\\) as inline math like $...$', () => {
		const markdown = createMarkdown();
		assert.equal(
			markdown.render('考虑 \\(n \\le 10^5\\) 个元素。'),
			markdown.render('考虑 $n \\le 10^5$ 个元素。'),
		);
		assert.match(markdown.render('\\(\\alpha\\)'), /class="katex"/);
	});

	test('does not treat an escaped backslash as an opening delimiter', () => {
		const html = createMarkdown().render('字面量 \\\\(a\\\\) 不渲染');
		assert.ok(!html.includes('class="katex"'));
		assert.ok(html.includes('\\(a\\)'));
	});

	test('renders unclosed or empty \\(...\\) as literal text', () => {
		const markdown = createMarkdown();
		assert.ok(!markdown.render('未闭合 \\(a + b').includes('class="katex"'));
		assert.ok(!markdown.render('空 \\(\\) 公式').includes('class="katex"'));
	});

	test('keeps escaped closing delimiters inside the math content', () => {
		const html = createMarkdown().render('\\(x \\in \\\\{1, 2\\\\}\\)');
		assert.match(html, /class="katex"/);
	});

	test('renders \\[...\\] on its own line as display math like $$...$$', () => {
		const markdown = createMarkdown();
		assert.equal(
			markdown.render('\\[x = 1\\]'),
			markdown.render('$$x = 1$$'),
		);
		assert.match(markdown.render('\\[x = 1\\]'), /katex-display/);
	});

	test('renders a multi-line \\[...\\] block as display math', () => {
		const html = createMarkdown().render('之前。\n\n\\[\nx = 1 + 2\n\\]\n\n之后。');
		assert.match(html, /katex-display/);
		assert.ok(html.indexOf('之前。') < html.indexOf('katex-display'));
		assert.ok(html.indexOf('katex-display') < html.indexOf('之后。'));
	});

	test('renders \\[...\\] in the middle of a paragraph as display math', () => {
		const html = createMarkdown().render('答案是 \\[x = 1\\] 所示。');
		assert.match(html, /katex-display/);
	});

	test('renders two display math spans on one line', () => {
		const html = createMarkdown().render('\\[a\\] 和 \\[b\\]');
		assert.equal(html.match(/katex-display/g)?.length, 2);
	});

	test('does not treat an escaped \\[ as display math', () => {
		const html = createMarkdown().render('\\\\[x = 1\\\\]');
		assert.ok(!html.includes('katex-display'));
	});

	test('leaves delimiters inside code spans and fences untouched', () => {
		const markdown = createMarkdown();
		const inlineCode = markdown.render('`\\(n\\)`');
		assert.ok(!inlineCode.includes('class="katex"'));
		assert.ok(inlineCode.includes('\\(n\\)'));
		const fenced = markdown.render('```text\n\\[x = 1\\]\n```');
		assert.ok(!fenced.includes('katex-display'));
	});

	test('renders display math inside a blockquote', () => {
		const html = createMarkdown().render('> \\[x = 1\\]');
		assert.match(html, /<blockquote>[\s\S]*katex-display/);
	});

	test('still renders $...$ and $$...$$ math', () => {
		const markdown = createMarkdown();
		assert.match(markdown.render('$n \\le 10$'), /class="katex"/);
		assert.match(markdown.render('$$x = 1$$'), /katex-display/);
	});
});

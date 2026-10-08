/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import MarkdownIt from 'markdown-it';
import markdownItKatex from '@vscode/markdown-it-katex';
import { registerLatexDelimiterMath } from '../markdownItLatexDelimiters';
import { createProblemMarkdownRenderer, resolveProblemMarkdownUrl } from '../markdownRenderer';
import type { ThemeRegistration } from 'shiki';

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

suite('ShortestPath OJ editor code theme', () => {
	test('the granular bundle preserves highlighting for all previously loaded languages, aliases and themes', async () => {
		const { createHighlighter } = await import('shiki');
		const original = await createHighlighter({
			themes: ['github-dark', 'github-light'],
			langs: ['cpp', 'python', 'java', 'javascript', 'typescript', 'bash', 'json', 'text'],
		});
		try {
			for (const theme of ['github-dark', 'github-light']) {
				const render = await createProblemMarkdownRenderer(() => theme);
				for (const lang of original.getLoadedLanguages().concat('text', 'txt', 'plaintext')) {
					const code = 'if (value < 2) return "你好"; // <script>\n';
					assert.equal(render(`\`\`\`${lang}\n${code}\`\`\``, 'https://shortestpath.cn/'), original.codeToHtml(code, { lang, theme }), `${theme}: ${lang}`);
				}
			}
		} finally {
			original.dispose();
		}
	});

	test('uses custom token colors and updates when a theme with the same name changes', async () => {
		const makeTheme = (foreground: string): ThemeRegistration => ({
			name: 'shortestpath-editor', type: 'dark',
			settings: [
				{ settings: { foreground: '#abcdef', background: '#123456' } },
				{ scope: 'keyword.control', settings: { foreground, fontStyle: 'italic' } },
			],
		});
		let theme = makeTheme('#ff1234');
		const render = await createProblemMarkdownRenderer(() => theme);
		const code = '```cpp\nif (value < 2) return 0; // <script>\n```';
		const first = render(code, 'https://shortestpath.cn/');
		theme = makeTheme('#12ff34');
		const second = render(code, 'https://shortestpath.cn/');
		assert.deepEqual({
			firstColor: first.includes('color:#FF1234'), secondColor: second.includes('color:#12FF34'),
			oldColorRemoved: !second.includes('color:#FF1234'), editorBackground: second.includes('background-color:#123456'),
			escaped: /(?:&lt;|&#x3c;)script/i.test(second) && !second.includes('<script>'),
		}, { firstColor: true, secondColor: true, oldColorRemoved: true, editorBackground: true, escaped: true });
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

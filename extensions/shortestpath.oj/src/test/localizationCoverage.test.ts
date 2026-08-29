/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { test } from 'node:test';

test('allows and covers the OJ Webview localization bootstrap', () => {
	const extensionRoot = path.resolve(__dirname, '../..');
	const template = fs.readFileSync(path.join(extensionRoot, 'resources', 'problemView.html'), 'utf8');
	const localization = fs.readFileSync(path.join(extensionRoot, 'src', 'localization.ts'), 'utf8');

	assert.match(template, /script-src \{\{CSP_SOURCE\}\};/);
	assert.match(template, /data-i18n-ignore>\{\{TITLE\}\}/);
	assert.match(template, /title-meta-line" data-i18n-ignore/);
	assert.match(localization, /'nonce-\$\{nonce\}'/);
	assert.match(localization, /<script nonce="\$\{nonce\}">/);
	assert.match(localization, /script-src\[\^;\]\*'unsafe-inline'/);
	assert.match(localization, /translated!==current/);
	assert.match(localization, /const current=node\.nodeValue\|\|'';const translated=translate\(current\);if\(translated!==current\)node\.nodeValue=translated/);
	assert.doesNotMatch(localization, /node\.nodeValue=translate\(/);
	assert.doesNotMatch(localization, /if\(node\.hasAttribute\(attribute\)\)node\.setAttribute/);
	for (const pattern of ['提示尚未解锁，剩余', '点赞提示问题', '取消点赞提示答案', '上一次提交结果未知']) {
		assert.match(localization, new RegExp(pattern));
	}
	for (const text of ['题目视图', '题面', '评测', '已连接题目网页。', '查看解题报告', '网站操作结果未知，请先查看网页状态。', '解题报告响应无效。']) {
		assert.match(localization, new RegExp(`['"]${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*:`));
	}
	const extension = fs.readFileSync(path.join(extensionRoot, 'src', 'extension.ts'), 'utf8');
	assert.match(extension, /error instanceof Error \? localize\(error\.message\)/);
	assert.match(extension, /difficulty-tag[^`]*data-i18n-ignore[^`]*escapeHtml\(difficulty\.label\)/);
	assert.doesNotMatch(extension, /localize\(difficulty\.label\)/);
	assert.doesNotMatch(localization, /['"]提高['"]\s*:/);
});

test('compiles the OJ bootstrap and translates control attributes without rewrite loops', () => {
	const extensionRoot = path.resolve(__dirname, '../..');
	const localization = fs.readFileSync(path.join(extensionRoot, 'src', 'localization.ts'), 'utf8');
	const literal = localization.match(/const script = (`[\s\S]*?`);/)?.[1];
	assert.ok(literal);
	const script = new Function('nonce', 'strings', `return ${literal};`)('nonce', JSON.stringify({ '已有提交 ID': 'Existing submission ID' })) as string;
	const body = script.replace(/^<script[^>]*>|<\/script>$/g, '');
	assert.doesNotThrow(() => new Function(body));
	let attributeWrites = 0;
	let textWrites = 0;
	class FakeText {
		nodeType = 3;
		parentElement: FakeElement;
		private current = '解题报告尚未解锁，剩余 1 分钟';
		constructor(parent: FakeElement) { this.parentElement = parent; }
		get nodeValue(): string { return this.current; }
		set nodeValue(value: string) { textWrites++; this.current = value; }
	}
	class FakeElement {
		nodeType = 1;
		parentElement: FakeElement | null = null;
		tagName: string;
		childNodes: Array<FakeElement | FakeText> = [];
		private attributes: Map<string, string>;
		constructor(tagName: string) { this.tagName = tagName; this.attributes = tagName === 'INPUT' ? new Map([['placeholder', '已有提交 ID']]) : new Map(); }
		hasAttribute(name: string): boolean { return this.attributes.has(name); }
		getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
		setAttribute(name: string, value: string): void { attributeWrites++; this.attributes.set(name, value); }
		closest(): null { return null; }
	}
	const bodyElement = new FakeElement('BODY');
	const input = new FakeElement('INPUT'); input.parentElement = bodyElement;
	const text = new FakeText(bodyElement); bodyElement.childNodes = [input, text];
	let observerCallback: ((records: Array<{ type: string; target: FakeElement | FakeText }>) => void) | undefined;
	const document = { documentElement: { lang: '' }, body: bodyElement };
	class FakeObserver { constructor(callback: typeof observerCallback) { observerCallback = callback; } observe(): void {} }
	vm.runInNewContext(body, { document, Node: { TEXT_NODE: 3 }, HTMLElement: FakeElement, MutationObserver: FakeObserver });
	assert.equal(input.getAttribute('placeholder'), 'Existing submission ID');
	assert.equal(text.nodeValue, 'The editorial is locked. Remaining 1 分钟');
	assert.equal(attributeWrites, 1);
	assert.equal(textWrites, 1);
	observerCallback?.([{ type: 'attributes', target: input }, { type: 'characterData', target: text }]);
	assert.equal(attributeWrites, 1);
	assert.equal(textWrites, 1);
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type * as vscode from 'vscode';
import { SettingsNavigation, type SettingsPageHost } from '../settingsNavigation';

test('replacing a loaded settings page keeps the loading overlay hidden and its CSP valid', () => {
	const html = fs.readFileSync(path.resolve(__dirname, '../../../../src/vs/workbench/contrib/webview/browser/pre/index.html'), 'utf8');
	const loading = html.match(/if \(loadingIndicator\) \{\s*\/\/ Keep the current page[^\n]*\n\s*loadingIndicator.hidden = [^;]+;/)?.[0];
	assert.ok(loading);
	for (const loaded of [false, true]) {
		const loadingIndicator = { hidden: true };
		vm.runInNewContext(loading + '\n}', { loadingIndicator, getActiveFrame: () => loaded ? {} : undefined });
		assert.equal(loadingIndicator.hidden, loaded);
	}
	const script = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)?.[1];
	assert.ok(script);
	assert.ok(html.includes('sha256-' + createHash('sha256').update(script).digest('base64')));
});

test('local settings categories switch their cards and keep the support action in the header', () => {
	const cards = ['cpp', 'editor'].map(category => ({ dataset: { category }, hidden: false }));
	const buttons = ['cpp', 'editor'].map(category => ({ dataset: { category }, textContent: category, classList: { toggle() {} }, setAttribute() {}, removeAttribute() {} }));
	const title = { textContent: '' }, content = { scrollTop: 10 };
	const compiled = fs.readFileSync(path.join(__dirname, '../simpleSettings.js'), 'utf8');
	const match = /function selectCategory\(category\) \{[\s\S]*?\n\}/.exec(compiled);
	assert.ok(match);
	const context = vm.createContext({ selectedCategory: 'editor', byId: (id: string) => id === 'categoryTitle' ? title : content, document: { querySelectorAll: (selector: string) => selector === '.category' ? buttons : cards } });
	vm.runInContext(match[0], context); vm.runInContext('selectCategory("cpp")', context);
	assert.deepEqual(cards.map(card => card.hidden), [false, true]);
	assert.equal(title.textContent, 'cpp'); assert.equal(content.scrollTop, 0);
	assert.match(compiled, /initialCategory = 'editor'/);
	assert.match(compiled, /let selectedCategory = \$\{JSON\.stringify\(initialCategory\)/);
	assert.match(compiled, /buyMeACoffee/);
});

test('back waits for the current save and rejects late messages from a closed detail page', async () => {
	let handler!: (message: unknown) => unknown;
	let release!: () => void;
	const held = new Promise<void>(resolve => { release = resolve; });
	let restored = false;
	let disposed = false;
	let host!: SettingsPageHost;
	const webview = {
		html: 'root',
		onDidReceiveMessage(listener: typeof handler) { handler = listener; return { dispose() { disposed = true; } }; },
		async postMessage() { return true; }
	};
	const navigation = new SettingsNavigation(webview as unknown as vscode.Webview, html => html, () => { restored = true; webview.html = 'root'; });
	await navigation.open('detail', page => {
		host = page;
		page.webview.html = 'detail';
		page.webview.onDidReceiveMessage(() => held);
	});
	const save = handler({ type: 'save' });
	const back = navigation.back();
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(restored, false);
	release(); await save; await back;
	assert.equal(restored, true);
	assert.equal(disposed, true);
	host.webview.html = 'stale page';
	assert.equal(webview.html, 'root');
	assert.equal(await host.webview.postMessage({ type: 'saved' }), false);
	navigation.dispose();
});

test('leaving a loading detail page prevents its delayed render from replacing settings', async () => {
	let release!: () => void;
	const held = new Promise<void>(resolve => { release = resolve; });
	const webview = { html: 'root' };
	const navigation = new SettingsNavigation(webview as vscode.Webview, html => html, () => { webview.html = 'root'; });
	const opening = navigation.open('slow page', async host => { await held; host.webview.html = 'late detail'; });
	await new Promise(resolve => setImmediate(resolve));
	await navigation.back(); release(); await opening;
	assert.equal(webview.html, 'root');
	assert.equal(navigation.active, false);
	navigation.dispose();
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { test } from 'node:test';
import { DraftStorage } from '../draftStorage';
import { ClientMessage, DraftSnapshot, isClientMessage, isDraftSnapshot } from '../protocol';
import { SaveSession } from '../webview/saveSession';
import { getDrawHtml } from '../webviewHtml';
import { getDrawStrings } from '../strings';

const snapshot = (text: string): DraftSnapshot => ({ scene: JSON.stringify({ type: 'excalidraw', elements: [{ id: 'text', type: 'text', text }], appState: {}, files: {} }), library: '{"type":"excalidrawlib","libraryItems":[]}' });

test('serializes overlapping saves, restores external labels verbatim and leaves no temporary files', async t => {
	const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'shortestpath-draw-'));
	t.after(() => fs.rm(folder, { recursive: true, force: true }));
	const storage = new DraftStorage(folder);
	await Promise.all([storage.save(snapshot('first')), storage.save(snapshot('代码片段 <script> DP[i] = 题意原文')), storage.save(snapshot('last'))]);
	assert.deepEqual({ draft: await storage.read(), files: await fs.readdir(folder) }, { draft: snapshot('last'), files: ['draft.json'] });
	await storage.save(snapshot('代码片段 <script> DP[i] = 题意原文'));
	assert.deepEqual(await new DraftStorage(folder).read(), snapshot('代码片段 <script> DP[i] = 题意原文'));
});

test('preserves the previous draft after a rejected save and recovers from filesystem failures', async t => {
	const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'shortestpath-draw-'));
	t.after(() => fs.rm(folder, { recursive: true, force: true }));
	const storage = new DraftStorage(folder);
	await storage.save(snapshot('kept'));
	await assert.rejects(storage.save({ scene: '{', library: '{}' }));
	assert.deepEqual(await storage.read(), snapshot('kept'));
	const blocked = path.join(folder, 'blocked');
	await fs.writeFile(blocked, 'not a directory');
	const recovery = new DraftStorage(blocked);
	await assert.rejects(recovery.save(snapshot('failed')));
	await fs.unlink(blocked);
	await recovery.save(snapshot('recovered'));
	assert.deepEqual(await recovery.read(), snapshot('recovered'));
});

test('reports damaged storage and distinguishes a missing draft from an unreadable draft', async t => {
	const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'shortestpath-draw-'));
	t.after(() => fs.rm(folder, { recursive: true, force: true }));
	const storage = new DraftStorage(folder);
	assert.equal(await storage.read(), undefined);
	await fs.writeFile(path.join(folder, 'draft.json'), '{"broken":true}');
	await assert.rejects(storage.read());
	assert.equal(await fs.readFile(path.join(folder, 'draft.json'), 'utf8'), '{"broken":true}');
});

test('flushes the latest edit on a mode transfer and ignores stale save acknowledgements', () => {
	const messages: ClientMessage[] = [];
	const session = new SaveSession(message => messages.push(message), 60_000);
	session.accept(snapshot('initial'));
	session.change(snapshot('drag'));
	session.change(snapshot('final'));
	session.flush();
	session.change(snapshot('next'));
	session.acknowledge(2);
	assert.equal(session.status, 'saving');
	session.flush();
	session.acknowledge(2, 'old failure');
	assert.equal(session.status, 'saving');
	session.acknowledge(3);
	assert.deepEqual({ status: session.status, messages }, { status: 'saved', messages: [{ type: 'save', snapshot: snapshot('final'), revision: 2 }, { type: 'save', snapshot: snapshot('next'), revision: 3 }] });
	session.dispose();
});

test('retry keeps unsaved data and accepting a remote scene cancels obsolete local saves', () => {
	const messages: ClientMessage[] = [];
	const session = new SaveSession(message => messages.push(message), 60_000);
	session.accept(snapshot('initial'));
	session.change(snapshot('unsaved'));
	session.flush();
	session.acknowledge(2, 'disk full');
	assert.equal(session.status, 'failed');
	session.retry();
	session.acknowledge(3);
	session.change(snapshot('obsolete'));
	session.accept(snapshot('imported'));
	session.acknowledge(3, 'stale');
	session.dispose();
	assert.deepEqual({ status: session.status, messages }, { status: 'saved', messages: [{ type: 'save', snapshot: snapshot('unsaved'), revision: 2 }, { type: 'save', snapshot: snapshot('unsaved'), revision: 3 }] });
});

test('validates the Webview protocol and confines scripts, fonts and network requests to bundled resources', () => {
	assert.deepEqual([isDraftSnapshot(snapshot('题目正文')), isDraftSnapshot({ scene: '{}', library: '{}' }), isClientMessage({ type: 'save', snapshot: snapshot('x'), revision: -1 }), isClientMessage({ type: 'save', snapshot: snapshot('x'), revision: 1 }), isClientMessage({ type: 'unknown' })], [true, false, false, true, false]);
	const html = getDrawHtml({ resourceRoot: 'https://local.vscode-resource.test/dist', cspSource: 'https://*.vscode-resource.test', language: 'zh-cn', theme: 'dark', title: '<草稿>', companion: false, nonce: 'nonce' });
	assert.match(html, /default-src 'none'/);
	assert.match(html, /connect-src https:\/\/\*\.vscode-resource\.test;/);
	assert.match(html, /font-src https:\/\/\*\.vscode-resource\.test data:/);
	assert.match(html, /type="module" nonce="nonce"/);
	assert.match(html, /'wasm-unsafe-eval'/);
	assert.match(html, /<title>&lt;草稿&gt;<\/title>/);
	assert.doesNotMatch(html, /cdn|'unsafe-eval'|<script[^>]*>[\s\S]+?<\/script>/);
	assert.deepEqual([getDrawStrings('zh-cn').saved, getDrawStrings('en').saved, getDrawStrings('zh-cn').importPrompt, getDrawStrings('en').importPrompt], ['已保存在本机', 'Saved locally', '用导入的画图文件替换当前草稿？', 'Replace the current draft with the imported drawing?']);
});

test('activates both restored panels and ships every offline font alongside the Webview chunks', async () => {
	const root = path.resolve(__dirname, '../..');
	const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
	assert.ok(manifest.activationEvents.includes('onWebviewPanel:shortestpath.draw'));
	assert.ok(manifest.activationEvents.includes('onWebviewPanel:shortestpath.draw.companion'));
	const fonts = await fs.readdir(path.join(root, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts'), { recursive: true });
	for (const font of fonts.filter(file => file.endsWith('.woff2'))) {
		assert.ok((await fs.stat(path.join(root, 'dist/fonts', font))).size > 0, `Missing offline font: ${font}`);
	}
	const inputs = JSON.parse(await fs.readFile(path.join(root, 'dist/metafile.json'), 'utf8'));
	for (const output of Object.values(inputs.outputs) as { imports: { path: string; external?: boolean }[] }[]) {
		for (const dependency of output.imports.filter(item => !item.external)) { await fs.access(path.join(root, dependency.path)); }
	}
	assert.ok((await fs.stat(path.join(root, 'dist/webview.css'))).size > 0);
});

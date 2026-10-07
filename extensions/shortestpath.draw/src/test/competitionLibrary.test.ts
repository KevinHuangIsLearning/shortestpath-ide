/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { test } from 'node:test';
import { initializeCompetitionLibrary, serializeCompetitionLibrary } from '../competitionLibrary';
import competitionLibrary from '../competitionLibrary.json';
import { DraftStorage } from '../draftStorage';
import { ClientMessage, DraftSnapshot } from '../protocol';
import { getDrawStrings } from '../strings';
import { SaveSession } from '../webview/saveSession';

const itemId = (name: string) => `shortestpath-competition-${name}`;

test('bundles exactly the reviewed editable templates with consistent outlines and self-contained bindings', () => {
	const items = initializeCompetitionLibrary(undefined, 'en');
	const summary = items.map(item => ({
		id: item.id.replace('shortestpath-competition-', ''),
		types: Object.fromEntries([...new Set(item.elements.map(element => element.type))].sort().map(type => [type, item.elements.filter(element => element.type === type).length])),
	}));
	assert.deepEqual(summary, [
		{ id: 'array-10', types: { rectangle: 10 } },
		{ id: 'indexed-array-10', types: { rectangle: 10, text: 10 } },
		{ id: 'grid-3', types: { rectangle: 9, text: 6 } },
		{ id: 'grid-5', types: { rectangle: 25, text: 10 } },
		{ id: 'binary-tree-3', types: { arrow: 2, ellipse: 3 } },
		{ id: 'binary-tree-7', types: { arrow: 6, ellipse: 7 } },
		{ id: 'linked-list-5', types: { arrow: 4, rectangle: 10 } },
		{ id: 'key-value-table-5', types: { rectangle: 10, text: 7 } },
		{ id: 'undirected-graph-6', types: { ellipse: 6, line: 7 } },
		{ id: 'diamond-graph-4', types: { ellipse: 4, line: 5 } },
		{ id: 'first-quadrant', types: { arrow: 2 } },
		{ id: 'four-quadrants', types: { arrow: 2 } },
		{ id: 'number-line', types: { arrow: 1, line: 11 } },
		{ id: 'venn-diagram', types: { ellipse: 2 } },
		{ id: 'triangle', types: { line: 1 } },
		{ id: 'hexagon', types: { line: 1 } },
	]);
	assert.equal(new Set(items.map(item => item.id)).size, 16);
	for (const item of items) {
		const ids = new Set(item.elements.map(element => element.id));
		assert.equal(ids.size, item.elements.length);
		for (const element of item.elements) {
			assert.deepEqual([element.strokeColor, element.backgroundColor, element.strokeWidth, element.isDeleted, element.link], ['#1e1e1e', 'transparent', 2, false, null]);
			assert.ok([element.x, element.y, element.width, element.height, element.angle].every(Number.isFinite));
			for (const binding of element.boundElements ?? []) { assert.ok(ids.has(binding.id)); }
			if (element.type === 'arrow') {
				for (const binding of [element.startBinding, element.endBinding]) { if (binding) { assert.ok(ids.has(binding.elementId)); } }
			}
		}
	}
	assert.deepEqual(competitionLibrary.sources.map(source => source.author), ['intradeus', 'Jakub Pawlina', 'TvoozMagnificent', 'Yatrik Patel', 'Lipis']);
});

test('seeds existing drafts without duplicating templates, replacing user edits or sharing mutable asset objects', () => {
	const defaults = initializeCompetitionLibrary(undefined, 'en');
	const edited = { ...defaults[0], name: '我的区间推演', elements: [{ ...defaults[0].elements[0], x: 123, strokeColor: '#ff0000' }] };
	const custom = { ...defaults[1], id: 'custom-user-library', name: '题意原文 <script> DP[i]' };
	const migrated = initializeCompetitionLibrary(JSON.stringify({ type: 'excalidrawlib', libraryItems: [custom, edited] }), 'zh-cn');
	assert.deepEqual({ kept: migrated.slice(0, 2), ids: new Set(migrated.map(item => item.id)).size, total: migrated.length }, { kept: [custom, edited], ids: 17, total: 17 });
	assert.notStrictEqual(migrated[2].elements, defaults[1].elements);
	assert.notStrictEqual(migrated[2].elements[0], defaults[1].elements[0]);
});

test('persists the seeded library without any drawing edit and remembers both individual removals and an empty library', async t => {
	const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'shortestpath-competition-library-'));
	t.after(() => fs.rm(folder, { recursive: true, force: true }));
	const storage = new DraftStorage(folder);
	const scene = JSON.stringify({ type: 'excalidraw', elements: [{ id: 'user-text', type: 'text', text: '题意原文 <script> DP[i]' }], appState: {}, files: {} });
	const old: DraftSnapshot = { scene, library: '{"type":"excalidrawlib","libraryItems":[]}' };
	const messages: ClientMessage[] = [];
	const session = new SaveSession(message => messages.push(message), 60_000);
	session.accept(old, false);
	session.change({ scene, library: serializeCompetitionLibrary(initializeCompetitionLibrary(old.library, 'zh-cn')) });
	session.flush();
	const message = messages[0];
	assert.ok(message.type === 'save');
	await storage.save(message.snapshot);
	let restored = (await new DraftStorage(folder).read())!;
	assert.deepEqual({ scene: restored.scene, count: initializeCompetitionLibrary(restored.library, 'zh-cn').length, saves: messages.length }, { scene, count: 16, saves: 1 });
	const remaining = initializeCompetitionLibrary(restored.library, 'zh-cn').filter(item => item.id !== itemId('array-10'));
	await storage.save({ scene, library: serializeCompetitionLibrary(remaining) });
	restored = (await storage.read())!;
	assert.deepEqual(initializeCompetitionLibrary(restored.library, 'zh-cn'), remaining);
	await storage.save({ scene, library: serializeCompetitionLibrary([]) });
	restored = (await storage.read())!;
	assert.deepEqual({ scene: restored.scene, library: initializeCompetitionLibrary(restored.library, 'en') }, { scene, library: [] });
	session.dispose();
});

test('localizes only built-in names while retaining renamed templates, external names and drawing labels', () => {
	const english = initializeCompetitionLibrary(undefined, 'en');
	const chinese = initializeCompetitionLibrary(serializeCompetitionLibrary(english), 'zh-cn');
	assert.deepEqual(chinese.map(item => item.name), Object.values(getDrawStrings('zh-cn').libraryNames));
	assert.deepEqual(chinese.map(item => item.elements), english.map(item => item.elements));
	assert.deepEqual(initializeCompetitionLibrary(serializeCompetitionLibrary(chinese), 'en'), english);
	const renamed = { ...chinese[0], name: '外部题意：Array · 10 Cells <script>' };
	const custom = { ...chinese[1], id: 'custom', name: '带下标数组 · 10 格' };
	assert.deepEqual(initializeCompetitionLibrary(serializeCompetitionLibrary([renamed, custom]), 'en'), [renamed, custom]);
});

test('ships the templates and attribution in the offline bundle while hiding only the upstream online library actions', async () => {
	const root = path.resolve(__dirname, '../..');
	const meta = JSON.parse(await fs.readFile(path.join(root, 'dist/metafile.json'), 'utf8'));
	assert.ok(Object.hasOwn(meta.inputs, 'src/competitionLibrary.json'));
	const chunks = await fs.readdir(path.join(root, 'dist/chunks'));
	const bundle = (await Promise.all(chunks.filter(file => file.endsWith('.js')).map(file => fs.readFile(path.join(root, 'dist/chunks', file), 'utf8')))).join('\n');
	for (const item of competitionLibrary.libraryItems) { assert.ok(bundle.includes(item.id), `Missing bundled template: ${item.id}`); }
	const notices = await fs.readFile(path.join(root, 'dist/THIRD_PARTY_NOTICES.txt'), 'utf8');
	for (const source of competitionLibrary.sources) { assert.ok(notices.includes(source.author) && notices.includes(source.url)); }
	const css = await fs.readFile(path.join(root, 'dist/webview.css'), 'utf8');
	assert.match(css, /\.sketchpad \.excalidraw \.library-menu-browse-button,\.sketchpad \.excalidraw \.library-menu \[data-testid="?lib-dropdown--remove"?\]\{display:none\}/);
	// Excalidraw has no prop for these actions; detect selector changes when upgrading it.
	const upstream = await fs.readFile(path.join(root, 'node_modules/@excalidraw/excalidraw/dist/dev/index.js'), 'utf8');
	assert.match(upstream, /className: "library-menu-browse-button"/);
	assert.match(upstream, /"data-testid": "lib-dropdown--remove",\s*children: t\("buttons.publishLibrary"\)/);
});

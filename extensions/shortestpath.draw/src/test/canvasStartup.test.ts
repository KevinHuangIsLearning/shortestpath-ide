/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { test } from 'node:test';
import { transform } from 'esbuild';
import type { ExcalidrawProps } from '@excalidraw/excalidraw/types';
import { ClientMessage, DraftSnapshot } from '../protocol';
import { SaveSession } from '../webview/saveSession';

test('keeps a restored draft while the canvas API is loading, then saves live library edits', async t => {
	const root = path.resolve(__dirname, '../..');
	const source = await fs.readFile(path.join(root, 'src/webview/canvas.tsx'), 'utf8');
	const compiled = await transform(`${source}\nexport { Canvas };`, { loader: 'tsx', format: 'cjs', jsx: 'automatic' });
	const effects: (() => void)[] = [];
	const frames: (() => void)[] = [];
	const react = {
		useMemo: <T>(factory: () => T) => factory(),
		useRef: <T>(current?: T) => ({ current }),
		useEffect: (run: () => void) => effects.push(run),
	};
	interface Scene { elements: object[]; appState: object; files: object }
	interface CanvasApi { getAppState(): { isLoading: boolean }; getSceneElements(): object[]; getFiles(): object }
	type CanvasCallbacks = Pick<ExcalidrawProps, 'onLibraryChange' | 'onChange'> & { excalidrawAPI: (api: CanvasApi) => void };
	const serializeScene = (elements: object[], appState: object, files: object) => JSON.stringify({ type: 'excalidraw', elements, appState, files });
	const excalidraw = {
		MainMenu: { DefaultItems: {} }, WelcomeScreen: { Center: {} },
		restore: (scene: Scene) => scene,
		restoreLibraryItems: <T>(items: T) => items,
		serializeAsJSON: serializeScene,
		serializeLibraryAsJSON: (libraryItems: object[]) => JSON.stringify({ type: 'excalidrawlib', libraryItems }),
	};
	const module: { exports: { Canvas?: (props: { snapshot: DraftSnapshot; language: string; theme: 'dark'; session: SaveSession; onApi: (api: CanvasApi, serialize: () => DraftSnapshot) => void; onReady?: () => void }) => CanvasCallbacks } } = { exports: {} };
	vm.runInNewContext(compiled.code, {
		module, console, requestAnimationFrame: (callback: () => void) => frames.push(callback), cancelAnimationFrame() { }, acquireVsCodeApi: () => ({ postMessage() { } }),
		require(id: string): unknown {
			if (id === 'react') { return react; }
			if (id === 'react/jsx-runtime') { return { jsx: (_type: object, props: object) => props, jsxs: (_type: object, props: object) => props }; }
			if (id === 'react-dom/client') { return {}; }
			if (id === './pdfImport') { return {}; }
						if (id === '@excalidraw/excalidraw') { return excalidraw; }
			return require(path.resolve(root, 'out/webview', id));
		},
	});
	const elements = [{ id: 'original', type: 'text', text: '题意原文 <script> DP[i]' }];
	const snapshot: DraftSnapshot = { scene: serializeScene(elements, {}, {}), library: '{"type":"excalidrawlib","libraryItems":[]}' };
	const messages: ClientMessage[] = [];
	const session = new SaveSession(message => messages.push(message), 60_000);
	t.after(() => session.dispose());
	let getSnapshot!: () => DraftSnapshot;
	let ready = 0;
	const props = module.exports.Canvas!({ snapshot, language: 'zh-cn', theme: 'dark', session, onApi: (_api, serialize) => { getSnapshot = serialize; }, onReady: () => ready++ });
	let loading = true;
	let liveElements: object[] = [];
	const api: CanvasApi = {
		getAppState: () => ({ isLoading: loading }),
		getSceneElements: () => liveElements,
		getFiles: () => ({}),
	};
	props.excalidrawAPI!(api);
	assert.equal(ready, 0);
	for (const effect of effects) { effect(); }
	const library = JSON.parse(getSnapshot().library).libraryItems;
	await props.onLibraryChange!(library);
	session.flush();
	assert.deepEqual({ scene: getSnapshot().scene, count: library.length, saves: messages.length }, { scene: snapshot.scene, count: 16, saves: 1 });
	frames.shift()!();
	assert.equal(ready, 0);
	loading = false;
	liveElements = [{ id: 'edited', type: 'text', text: '现在的画布' }];
	frames.shift()!();
	assert.equal(ready, 1);
	props.onChange!(liveElements as never, { isLoading: false } as never, {});
	assert.equal(ready, 1);
	props.onChange!(liveElements as never, { isLoading: false } as never, {});
	assert.equal(ready, 1);
	await props.onLibraryChange!(library.slice(1));
	session.flush();
	const last = messages.at(-1)!;
	assert.ok(last.type === 'save');
	assert.deepEqual({ elements: JSON.parse(last.snapshot.scene).elements, count: JSON.parse(last.snapshot.library).libraryItems.length }, { elements: liveElements, count: 15 });
	session.dispose();
});


test('registers Sketchpad files in a valid dedicated native container', async () => {
	const manifest = JSON.parse(await fs.readFile(path.resolve(__dirname, '../../package.json'), 'utf8'));
	const container = manifest.contributes.viewsContainers.activitybar[0];
	assert.match(container.id, /^[a-zA-Z0-9_-]+$/);
	assert.deepEqual(manifest.contributes.views[container.id].map((view: { id: string }) => view.id), ['shortestpath.draw.files']);
	assert.equal(manifest.contributes.views.explorer, undefined);
	const documentMenus = manifest.contributes.menus['view/item/context'].filter((item: { command: string }) => ['clear', 'import', 'export'].some(action => item.command === `shortestpath.draw.${action}`));
	assert.equal(documentMenus.length, 3);
	assert.ok(documentMenus.every((item: { when: string }) => item.when === 'view == shortestpath.draw.files && viewItem == file'));
	assert.deepEqual(manifest.contributes.menus['editor/title'].map((item: { command: string }) => item.command), ['shortestpath.draw.openBeside', 'shortestpath.draw.openMode']);
});

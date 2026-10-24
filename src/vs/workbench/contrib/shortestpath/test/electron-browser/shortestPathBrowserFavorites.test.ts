/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { InMemoryStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { BrowserFavoritesStore } from '../../../browserView/electron-browser/features/browserFavoritesFeature.js';

suite('ShortestPath browser favorites', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('initializes the default favorite once and respects its removal across reloads', () => {
		const storage = store.add(new InMemoryStorageService());
		const first = store.add(new BrowserFavoritesStore(storage));
		const initial = first.values;
		first.remove('https://shortestpath.cn/');
		const reloaded = store.add(new BrowserFavoritesStore(storage));
		assert.deepStrictEqual({ initial, reloaded: reloaded.values }, { initial: ['https://shortestpath.cn/'], reloaded: [] });
	});

	test('uses the existing workspace favorites and synchronizes both APIs including external writes', () => {
		const storage = store.add(new InMemoryStorageService());
		storage.store('workbench.browser.favorites', JSON.stringify(['https://one.example/', 42]), StorageScope.WORKSPACE, StorageTarget.USER);
		const first = store.add(new BrowserFavoritesStore(storage));
		const second = store.add(new BrowserFavoritesStore(storage));
		first.toggle('https://two.example/');
		second.remove('https://one.example/');
		second.remove('https://one.example/');
		const shared = first.values;
		storage.store('workbench.browser.favorites', '{', StorageScope.WORKSPACE, StorageTarget.USER);
		assert.deepStrictEqual({ shared, corrupted: second.values }, { shared: ['https://two.example/'], corrupted: [] });
	});

	test('persists metadata, custom names, order and icon layout across stores and reloads', () => {
		const storage = store.add(new InMemoryStorageService());
		const first = store.add(new BrowserFavoritesStore(storage));
		first.toggle('https://one.example/');
		first.toggle('https://two.example/');
		first.updateMetadata('https://one.example/', 'Original title', 'https://one.example/icon.png');
		first.rename('https://one.example/', 'My name');
		first.updateMetadata('https://one.example/', 'Updated title');
		first.move('https://two.example/', 'https://one.example/');
		first.setCompact(true);
		const reloaded = store.add(new BrowserFavoritesStore(storage));
		assert.deepStrictEqual({ values: reloaded.values, item: reloaded.entries.find(entry => entry.url === 'https://one.example/'), compact: reloaded.compact }, {
			values: ['https://shortestpath.cn/', 'https://two.example/', 'https://one.example/'],
			item: { url: 'https://one.example/', title: 'Updated title', name: 'My name', favicon: 'https://one.example/icon.png' }, compact: true,
		});
		reloaded.rename('https://one.example/', '');
		assert.strictEqual(first.entries.find(entry => entry.url === 'https://one.example/')!.name, undefined);
	});

});

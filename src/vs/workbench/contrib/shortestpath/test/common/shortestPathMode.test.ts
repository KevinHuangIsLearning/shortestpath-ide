/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { getShortestPathPageMode, isRestorableBrowserUrl, isShortestPathPageMode, parseBrowserState, shortestPathPageCommands } from '../../common/shortestPathMode.js';

suite('ShortestPath browser workspace session', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	test('restores the sketchpad mode and keeps its companion in editor groups', () => {
		assert.deepStrictEqual({
			modes: ['browse', 'solve', 'snippets', 'draw', 'settings', undefined].map(isShortestPathPageMode),
			command: shortestPathPageCommands.draw,
			pages: [
				getShortestPathPageMode('shortestpath.shortestpath-draw', 'shortestpath.draw'),
				getShortestPathPageMode('shortestpath.shortestpath-draw', 'shortestpath.draw.companion'),
				getShortestPathPageMode('another.extension', 'shortestpath.draw'),
				getShortestPathPageMode('shortestpath.shortestpath-setup', 'shortestpath.cppSnippets'),
				getShortestPathPageMode('shortestpath.shortestpath-setup', 'shortestpath.settings'),
			],
		}, { modes: [false, false, true, true, true, false], command: 'shortestpath.draw.open', pages: ['draw', undefined, undefined, 'snippets', 'settings'] });
	});
	test('restores the selected ordinary page after removing authentication and recovery pages', () => {
		assert.deepStrictEqual(parseBrowserState(JSON.stringify({ urls: ['https://shortestpath.cn/login', 'https://shortestpath.cn/topics', 'https://shortestpath.cn/ide/connect?token=secret', 'https://shortestpath.cn/problem/dsu/found/A'], active: 3 })), {
			urls: ['https://shortestpath.cn/topics', 'https://shortestpath.cn/problem/dsu/found/A'], active: 1
		});
	});
	test('rejects malformed session data and unsafe or credential-bearing destinations', () => {
		assert.deepStrictEqual({
			corrupt: parseBrowserState('{'),
			invalid: parseBrowserState(JSON.stringify({ urls: [null, 42, 'javascript:alert(1)'], active: 999 })),
			urls: ['https://user:password@shortestpath.cn/', 'https://shortestpath.cn/login?next=/topics', 'https://shortestpath.cn/?token=secret', 'https://shortestpath.cn/topics', 'http://localhost:3000/topics', 'file:///tmp/example.html'].map(isRestorableBrowserUrl)
		}, { corrupt: { urls: [], active: 0 }, invalid: { urls: [], active: 0 }, urls: [false, false, false, true, true, true] });
	});
	test('keeps distinct native pages and the selected index for duplicate URLs', () => {
		assert.deepStrictEqual(parseBrowserState(JSON.stringify({ urls: ['https://shortestpath.cn/login', 'https://shortestpath.cn/topics', 'https://shortestpath.cn/topics'], ids: ['login', 'first', 'second'], active: 2 })), {
			urls: ['https://shortestpath.cn/topics', 'https://shortestpath.cn/topics'], ids: ['first', 'second'], active: 1
		});
	});
});

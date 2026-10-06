/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isRestorableBrowserUrl, parseBrowserState } from '../../common/shortestPathMode.js';

suite('ShortestPath browser workspace session', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
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

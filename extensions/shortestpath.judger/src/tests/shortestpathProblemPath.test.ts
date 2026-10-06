/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { getShortestPathProblemPath } from '../shortestpathProblemPath';

describe('fixed ShortestPath source paths', () => {
	test.each([
		['/problem/dsu/found/A', '字母互换', ['dsu', 'A_字母互换.cpp']],
		['/upsolving/at/agc078/A', '重排 ABC', ['contest', 'agc078', 'A_重排 ABC.cpp']],
		['/problem/dsu/adv/A', '字母互换', ['dsu', 'A_字母互换.cpp']],
		['/upsolving/cf/123/A', 'Title', ['contest', '123', 'A_Title.cpp']],
		['/upsolving/id/260', '双色换位', ['upsolving', '260_双色换位.cpp']],
		['/problem/dsu/found/A/?from=web#statement', '字母互换', ['dsu', 'A_字母互换.cpp']],
	])('%s preserves the title and uses the fixed directory', (url, title, expected) => {
		expect(getShortestPathProblemPath(`https://shortestpath.cn${url}`, title)).toBe(path.join(...expected));
	});
	test.each([
		'https://example.com/problem/dsu/found/A',
		'https://shortestpath.cn/contests/agc078/problems/A',
		'https://shortestpath.cn/replay/agc078/A',
		'https://shortestpath.cn/teams/123/problems/A',
		'https://shortestpath.cn/problem/dsu/template/A',
		'https://shortestpath.cn/upsolving/id/abc',
		'https://shortestpath.cn/problem/%zz/found/A',
		'not a URL',
	])('leaves unsupported pages unchanged: %s', url => {
		expect(getShortestPathProblemPath(url, 'title')).toBeUndefined();
	});
	test('encoded separators, traversal, reserved names and invalid title characters stay inside the workspace', () => {
		expect(getShortestPathProblemPath('https://shortestpath.cn/problem/%2e%2e%2fdsu/found/A', '重排 ABC: a/b?')).toBe(path.join('.._dsu', 'A_重排 ABC_ a_b_.cpp'));
		expect(getShortestPathProblemPath('https://shortestpath.cn/problem/CON/found/A', 'title. ')).toBe(path.join('_CON', 'A_title.cpp'));
	});
});

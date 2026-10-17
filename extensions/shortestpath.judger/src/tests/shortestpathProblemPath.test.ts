/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { getShortestPathProblemPath } from '../shortestpathProblemPath';

describe('fixed ShortestPath source paths', () => {
	test('recognizes only the explicitly configured loopback origin during local E2E', () => {
		const url = 'http://127.0.0.1:13000/problem/basic-algorithm/found/A';
		expect(getShortestPathProblemPath(url, 'A + B', 'http://127.0.0.1:13000')).toBe(path.join('basic-algorithm', 'A_A + B.cpp'));
		expect(getShortestPathProblemPath(url, 'A + B')).toBeUndefined();
		expect(getShortestPathProblemPath(url, 'A + B', 'http://127.0.0.1:3000')).toBeUndefined();
		expect(getShortestPathProblemPath('https://example.com/problem/dsu/found/A', 'A', 'https://example.com')).toBeUndefined();
	});
	test.each([
		['/problem/dsu/found/A', '字母互换', ['dsu', 'found', 'A_字母互换.cpp']],
		['/upsolving/at/agc078/A', '重排 ABC', ['contest', 'agc078', 'A_重排 ABC.cpp']],
		['/problem/dsu/adv/A', '字母互换', ['dsu', 'adv', 'A_字母互换.cpp']],
		['/upsolving/cf/123/A', 'Title', ['contest', '123', 'A_Title.cpp']],
		['/upsolving/id/260', '双色换位', ['upsolving', '260_双色换位.cpp']],
		['/problem/dsu/found/A/?from=web#statement', '字母互换', ['dsu', 'found', 'A_字母互换.cpp']],
	])('%s preserves the title and uses the fixed directory', (url, title, expected) => {
		expect(getShortestPathProblemPath(`https://shortestpath.cn${url}`, title)).toBe(path.join(...expected));
	});
	test.each(['found', 'adv', 'chal', 'past'])('category %s avoids collisions by default and can be disabled', category => {
		const url = `https://shortestpath.cn/problem/dsu/${category}/A`;
		expect([
			getShortestPathProblemPath(url, 'Title', 'ShortestPath'),
			getShortestPathProblemPath(url, 'Title', 'ShortestPath', false),
		]).toEqual([path.join('ShortestPath', 'dsu', category, 'A_Title.cpp'), path.join('ShortestPath', 'dsu', 'A_Title.cpp')]);
	});
	test.each(['/upsolving/cf/123/A', '/upsolving/at/agc078/A', '/upsolving/id/260'])('category switch does not affect %s', route => {
		const url = `https://shortestpath.cn${route}`;
		expect(getShortestPathProblemPath(url, 'Title', '', false)).toBe(getShortestPathProblemPath(url, 'Title'));
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
	test.each([
		['', ['dsu', 'found', 'A_Title.cpp']],
		['ShortestPath', ['ShortestPath', 'dsu', 'found', 'A_Title.cpp']],
		['  ShortestPath/solutions  ', ['ShortestPath', 'solutions', 'dsu', 'found', 'A_Title.cpp']],
		['ShortestPath\\solutions', ['ShortestPath', 'solutions', 'dsu', 'found', 'A_Title.cpp']],
		['/../CON/', ['_', '_CON', 'dsu', 'found', 'A_Title.cpp']],
	])('directory prefix %s stays relative to the workspace', (prefix, expected) => {
		expect(getShortestPathProblemPath('https://shortestpath.cn/problem/dsu/found/A', 'Title', prefix)).toBe(path.join(...expected));
	});
	test('encoded separators, traversal, reserved names and invalid title characters stay inside the workspace', () => {
		expect(getShortestPathProblemPath('https://shortestpath.cn/problem/%2e%2e%2fdsu/found/A', '重排 ABC: a/b?')).toBe(path.join('.._dsu', 'found', 'A_重排 ABC_ a_b_.cpp'));
		expect(getShortestPathProblemPath('https://shortestpath.cn/problem/CON/found/A', 'title. ')).toBe(path.join('_CON', 'found', 'A_title.cpp'));
	});
});

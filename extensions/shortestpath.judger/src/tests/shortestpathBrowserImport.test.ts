/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import vm from 'vm';
import fs from 'fs';
import path from 'path';
import { minify } from 'terser';
import { isShortestPathProblemPage, shortestPathStartProblemScript } from '../shortestpathBrowserImport';

test.each([
	'/problem/dsu/found/A', '/problem/dsu/adv/B/', '/problem/动态规划/chal/C?from=topic', '/problem/dsu/past/D',
	'/upsolving/id/123', '/upsolving/cf/2078/A', '/upsolving/at/agc078/B', '/replay/team-1/A', '/replay/team-1#B',
])('recognizes ShortestPath problem details: %s', route => {
	expect(isShortestPathProblemPage(`https://shortestpath.cn${route}`)).toBe(true);
});

test('production minification preserves the injected native action and its helper references', async () => {
	const source = fs.readFileSync(path.join(__dirname, '../shortestpathBrowserImport.js'), 'utf8');
	const result = await minify(source, { compress: true, mangle: { toplevel: true } });
	const exports: { shortestPathStartProblemScript?: () => string } = {};
	vm.runInNewContext(result.code!, { exports });
	const click = jest.fn();
	const context = vm.createContext({ URL, location: { href: 'https://shortestpath.cn/upsolving/cf/2078/A' }, document: { querySelectorAll: () => [{ getAttribute: () => '开始做题', disabled: false, click }] } });
	expect([vm.runInContext(exports.shortestPathStartProblemScript!(), context), click.mock.calls.length]).toEqual([true, 1]);
});

test.each([
	'/topics', '/login', '/ide/connect?token=secret', '/upsolving', '/upsolving/cf', '/replay/team-1',
	'/replay/team-1#rank', '/replay/team-1/A#document', '/upsolving/cf/2078/A#rank', '/upsolving/id/0',
	'/problem/dsu/template/A', '/problem/dsu/found/A/editorial', '/upsolving/id/123/editorial',
	'/upsolving/cf/2078/A/editorial', '/replay/team-1/A/editorial', '/problem/%zz/found/A',
	'/problem/dsu/found/%2F', '/upsolving/id/123/extra',
])('excludes other ShortestPath URLs: %s', route => {
	expect(isShortestPathProblemPage(`https://shortestpath.cn${route}`)).toBe(false);
});

test.each(['https://spoj.com/problem/dsu/found/A', 'https://shortestpath.cn.evil.com/problem/dsu/found/A', 'file:///problem/dsu/found/A'])('does not treat another site as ShortestPath: %s', url => {
	expect(isShortestPathProblemPage(url)).toBe(false);
});

test.each(['开始做题', '继续做题', 'IDE 已连接其他题目，点击重新连接', '连接失败，点击重试'])('invokes the existing website action in state %s', label => {
	const click = jest.fn();
	const button = { getAttribute: () => label, disabled: false, click };
	const context = vm.createContext({ URL, location: { href: 'https://shortestpath.cn/problem/dsu/found/A' }, document: { querySelectorAll: () => [button] } });
	expect([vm.runInContext(shortestPathStartProblemScript(), context), click.mock.calls.length]).toEqual([true, 1]);
});

test.each([
	{ route: '/topics', label: '开始做题', disabled: false, result: false },
	{ route: '/problem/dsu/found/A/editorial', label: '开始做题', disabled: false, result: false },
	{ route: '/problem/dsu/found/A', label: '查看题解', disabled: false, result: false },
	{ route: '/problem/dsu/found/A', label: '正在发送题目…', disabled: true, result: true },
])('does not start outside details or while the native button is busy: %j', ({ route, label, disabled, result }) => {
	const click = jest.fn();
	const context = vm.createContext({ URL, location: { href: `https://shortestpath.cn${route}` }, document: { querySelectorAll: () => [{ getAttribute: () => label, disabled, click }] } });
	expect([vm.runInContext(shortestPathStartProblemScript(), context), click.mock.calls.length]).toEqual([result, 0]);
});

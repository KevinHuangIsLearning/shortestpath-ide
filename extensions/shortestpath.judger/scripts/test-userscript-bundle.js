/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const webpack = require('webpack');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-bundle-'));
const root = path.resolve(__dirname, '..');
const config = require('../webpack.config');
config.context = root;
config.mode = 'production';
config.entry = './src/userScripts.ts';
config.output = { path: directory, filename: 'userscripts.js', libraryTarget: 'commonjs2' };
config.plugins = [];
const compiler = webpack(config);
compiler.run(async (error, stats) => {
	try {
		if (error || stats.hasErrors()) { throw error || new Error(stats.toString()); }
		const { parseUserScript, userScriptBootstrap } = require(path.join(directory, 'userscripts.js'));
		const source = '// ==UserScript==\n// @name bundle regression\n// @match https://example.com/*\n// @grant none\n// @run-at document-start\n// ==/UserScript==\nwindow.actual = Judger.code;';
		const window = {}; window.top = window;
		const storage = new Map();
		const context = vm.createContext({ window, URL, location: { href: 'https://example.com/submit' }, document: { readyState: 'complete' }, sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } });
		const code = '`quotes"\n${notCode()}';
		vm.runInContext(userScriptBootstrap(parseUserScript(source), { code }, 'test'), context);
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(window.actual, code);
		assert.equal(window.test.state, 'done');
		for (const file of fs.readdirSync(path.join(root, 'dist/static/userscripts'))) {
			assert.ok(parseUserScript(fs.readFileSync(path.join(root, 'dist/static/userscripts', file), 'utf8')).matches.length);
		}
		console.log('Production-minified userscript bootstrap and packaged metadata passed.');
	} catch (failure) { console.error(failure); process.exitCode = 1; }
	finally { compiler.close(() => fs.rmSync(directory, { recursive: true, force: true })); }
});

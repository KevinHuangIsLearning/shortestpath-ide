/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { test } from 'node:test';

test('webview font uses a local resource allowed by CSP and preserves external code', () => {
	const exports: { withBundledCodeFont?: (html: string, webview: object, extensionUri: string) => string } = {};
	vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../bundledFont.js'), 'utf8'), {
		exports, require: () => ({ Uri: { joinPath: (root: string, ...parts: string[]) => [root, ...parts].join('/') } })
	});
	const html = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';"></head><body><pre data-i18n-ignore>Fira Code &lt;test&gt; 中文</pre></body></html>`;
	const result = exports.withBundledCodeFont!(html, {
		cspSource: 'https://*.vscode-cdn.net', asWebviewUri: (uri: string) => 'https://file.vscode-cdn.net' + uri
	}, '/extension');
	assert.match(result, /font-src https:\/\/\*\.vscode-cdn\.net;/);
	assert.match(result, /src: url\('https:\/\/file\.vscode-cdn\.net\/extension\/resources\/fonts\/FiraCode-VF.ttf'\) format\('truetype'\)/);
	assert.match(result, /font-weight: 300 700/);
	assert.equal(result.slice(result.indexOf('<body>')), html.slice(html.indexOf('<body>')));
});

test('workbench and webview ship the same unmodified variable font and its license', () => {
	const root = path.resolve(__dirname, '../..');
	const core = path.resolve(root, '../../src/vs/workbench/browser/media/fonts');
	const bundled = path.join(root, 'resources/fonts');
	const font = fs.readFileSync(path.join(core, 'FiraCode-VF.ttf'));
	assert.equal(font.readUInt32BE(0), 0x00010000);
	assert.deepStrictEqual(fs.readFileSync(path.join(bundled, 'FiraCode-VF.ttf')), font);
	assert.equal(fs.readFileSync(path.join(bundled, 'LICENSE.txt'), 'utf8'), fs.readFileSync(path.join(core, 'LICENSE.txt'), 'utf8'));
});

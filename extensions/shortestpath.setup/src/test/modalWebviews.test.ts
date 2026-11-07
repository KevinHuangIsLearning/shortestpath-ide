/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

const extensionRoot = path.resolve(__dirname, '../..');

test('opens toolchain diagnostics as a modal webview', () => {
	const diagnostics = fs.readFileSync(path.join(extensionRoot, 'src', 'toolchainDiagnostics.ts'), 'utf8');
	assert.match(diagnostics, /createWebviewPanel\('shortestpath\.toolchainDiagnostics',[\s\S]{0,250}modal: true/);
});

test('opens toolchain diagnostics inside simplified settings without closing the parent', () => {
	const settings = fs.readFileSync(path.join(extensionRoot, 'src', 'simpleSettings.ts'), 'utf8');
	const route = settings.match(/message\?\.type === 'toolchainDiagnostics'\) \{([\s\S]*?)\n\t\t\} else/)?.[1];
	assert.ok(route);
	assert.match(route, /await openDetail\([^\n]+openToolchainDiagnostics\(context, host\)/);
	assert.doesNotMatch(route, /panel\.dispose|executeCommand/);
});

test('opens documentation in the external browser', () => {
	const settings = fs.readFileSync(path.join(extensionRoot, 'src', 'simpleSettings.ts'), 'utf8');
	const openDocumentationPage = settings.match(/async function openDocumentationPage\(\): Promise<void> \{[\s\S]*?\n\}/)?.[0];
	assert.ok(openDocumentationPage);
	assert.match(openDocumentationPage, /vscode\.env\.openExternal\(vscode\.Uri\.parse\(documentationUrl\)\)/);
	assert.doesNotMatch(openDocumentationPage, /openBrowserTab/);

	const newTabEditor = fs.readFileSync(path.resolve(extensionRoot, '../../src/vs/workbench/contrib/shortestpath/browser/shortestPathNewTabEditor.ts'), 'utf8');
	// The solving workspace's empty page now routes directly to the browser mode.
	assert.match(newTabEditor, /executeCommand\('shortestpath.mode.browse'\)/);
	assert.match(newTabEditor, /localizeNewTab\('View Documentation', '查看文档'\)[^\n]+openerService\.open\(URI\.parse\('https:\/\/kevinhuang\.feishu\.cn\/wiki\/LLBBwJQQGil2NnkJXWxcAeaLndd'\), \{ openExternal: true \}\)/);
});

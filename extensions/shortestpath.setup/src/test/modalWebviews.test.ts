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

test('closes simplified settings before opening toolchain diagnostics', () => {
	const settings = fs.readFileSync(path.join(extensionRoot, 'src', 'simpleSettings.ts'), 'utf8');
	assert.match(settings, /message\?\.type === 'toolchainDiagnostics'\) \{\s*panel\.dispose\(\);\s*await vscode\.commands\.executeCommand\('shortestpath\.openToolchainDiagnostics'\)/);
});

test('opens documentation in the external browser', () => {
	const settings = fs.readFileSync(path.join(extensionRoot, 'src', 'simpleSettings.ts'), 'utf8');
	const openDocumentationPage = settings.match(/async function openDocumentationPage\(\): Promise<void> \{[\s\S]*?\n\}/)?.[0];
	assert.ok(openDocumentationPage);
	assert.match(openDocumentationPage, /vscode\.env\.openExternal\(vscode\.Uri\.parse\(documentationUrl\)\)/);
	assert.doesNotMatch(openDocumentationPage, /openBrowserTab/);

	const cphSettings = fs.readFileSync(path.join(extensionRoot, 'src', 'cphSettings.ts'), 'utf8');
	const openCompetitiveChampionDoc = cphSettings.match(/async function openCompetitiveChampionDoc\(\): Promise<void> \{[\s\S]*?\n\}/)?.[0];
	assert.ok(openCompetitiveChampionDoc);
	assert.match(openCompetitiveChampionDoc, /vscode\.env\.openExternal\(vscode\.Uri\.parse\(competitiveChampionDocUrl\)\)/);
	assert.doesNotMatch(openCompetitiveChampionDoc, /openBrowserTab/);

	const newTabEditor = fs.readFileSync(path.resolve(extensionRoot, '../../src/vs/workbench/contrib/shortestpath/browser/shortestPathNewTabEditor.ts'), 'utf8');
	assert.match(newTabEditor, /localizeNewTab\('View Documentation',[\s\S]{0,250}openExternal: true/);
});

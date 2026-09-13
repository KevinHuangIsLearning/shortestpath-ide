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

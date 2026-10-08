/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { suite, test } from 'node:test';

const require = createRequire(import.meta.url);
const vsce = require('@vscode/vsce') as typeof import('@vscode/vsce');
const root = path.resolve(import.meta.dirname, '../../..');

async function collectFixture(extension: string, files: string[]): Promise<string[]> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oi-package-'));
	try {
		await fs.copyFile(path.join(root, 'extensions', extension, '.vscodeignore'), path.join(directory, '.vscodeignore'));
		await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', publisher: 'test', engines: { vscode: '*' } }));
		for (const file of files) {
			await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true });
			await fs.writeFile(path.join(directory, file), 'fixture');
		}
		const selected = await vsce.listFiles({ cwd: directory, packageManager: vsce.PackageManager.None });
		return files.filter(file => selected.includes(file)).sort();
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
}

suite('OI extension package contents', () => {
	test('OJ retains both Webview scripts and bundle notices without unbundled dependencies or tests', async () => {
		const runtime = ['dist/extension.js', 'dist/THIRD_PARTY_NOTICES.txt', 'out/problemView.js', 'out/styleHotReload.js', 'resources/problemView.html', 'resources/katex/katex.min.js'];
		const development = ['out/extension.js', 'out/test/example.test.js', 'node_modules/shiki/dist/index.mjs', 'dist/metafile.json'];
		assert.deepStrictEqual(await collectFixture('shortestpath.oj', [...runtime, ...development]), runtime.sort());
	});

	test('Judger retains compiled parsers, native tools, userscripts and licenses without the companion build tree', async () => {
		const runtime = [
			'dist/extension.js', 'dist/frontend.module.js', 'preview-dist/preview.module.js',
			'dist/static/competitive-companion/parsers.bundle.txt', 'dist/static/competitive-companion/parsers.runtime.txt',
			'dist/static/competitive-companion/LICENSE', 'dist/static/competitive-companion/THIRD-PARTY-LICENSES.txt',
			'dist/static/tools/runner.cpp', 'dist/static/tools/hook.hpp', 'dist/static/testlib/testlib.h',
			'dist/static/userscripts/luogu.user.js', 'LICENSE', 'package.nls.json',
		];
		const development = ['scripts/companion/node_modules/esbuild/bin/esbuild', 'scripts/companion/entry.ts', 'static/competitive-companion/parsers.runtime.txt', 'screenshots/example.png'];
		assert.deepStrictEqual(await collectFixture('shortestpath.judger', [...runtime, ...development]), runtime.sort());
	});

	test('Mermaid retains every shared renderer entry and chunk while excluding superseded outputs', async () => {
		const runtime = [
			'dist/extension.js', 'webview-out/markdown/index.js', 'webview-out/notebook/index.js',
			'webview-out/chat/index.js', 'webview-out/chat/index-editor.js', 'webview-out/chat/codicon.css',
			'webview-out/shared/diagram-HASH.js', 'ThirdPartyNotices.txt', 'package.nls.json',
		];
		const old = ['chat-webview-out/index.js', 'markdown-preview-out/logos.js', 'notebook-out/logos.js', 'out/extension.js'];
		assert.deepStrictEqual(await collectFixture('mermaid-markdown-features', [...runtime, ...old]), runtime.sort());
	});
});

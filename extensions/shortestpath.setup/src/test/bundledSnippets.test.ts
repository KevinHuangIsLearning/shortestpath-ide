/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { installBundledCppSnippets } from '../bundledSnippets';

const extensionPath = path.resolve(__dirname, '../..');

test('a new profile receives the bundled segment tree once, including concurrent startup', async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'shortestpath-snippets-'));
	t.after(() => fs.rm(profile, { recursive: true, force: true }));
	const file = path.join(profile, 'snippets', 'cpp.json');
	await Promise.all([installBundledCppSnippets(file, extensionPath), installBundledCppSnippets(file, extensionPath)]);
	const source = await fs.readFile(file, 'utf8');
	assert.equal(source, await fs.readFile(path.join(extensionPath, 'resources', 'cpp.code-snippets'), 'utf8'));
	const snippets = JSON.parse(source);
	assert.deepEqual(Object.keys(snippets), ['线段树单点更新']);
	assert.equal(snippets['线段树单点更新'].prefix, 'seg_tree');
	await fs.writeFile(file, '{}\n');
	await installBundledCppSnippets(file, extensionPath);
	assert.equal(await fs.readFile(file, 'utf8'), '{}\n');
});

test('existing custom or invalid JSONC snippets are preserved byte for byte', async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'shortestpath-snippets-'));
	t.after(() => fs.rm(profile, { recursive: true, force: true }));
	const file = path.join(profile, 'cpp.json');
	for (const source of ['// user snippets\n{"Custom": {"prefix": "seg_tree", "body": ["custom"]}}', '{ unfinished']) {
		await fs.writeFile(file, source);
		await installBundledCppSnippets(file, extensionPath);
		assert.equal(await fs.readFile(file, 'utf8'), source);
	}
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { test } from 'node:test';
import type * as formatting from '../cppFormatting';

async function createHost(fail = false) {
	const calls: Array<{ source: string; tabSize: number; range?: object }> = [];
	let disposed = 0;
	let command!: (file: string, source: string, tabSize: number, range?: object) => Promise<object[] | undefined>;
	const exports: Partial<typeof formatting> = {};
	const source = await fs.readFile(path.resolve(__dirname, '../cppFormatting.js'), 'utf8');
	vm.runInNewContext(source, { exports, require(id: string) {
		if (id === 'vscode') { return { commands: { registerCommand(_name: string, callback: typeof command) { command = callback; return { dispose() {} }; } } }; }
		if (id === './editorPreview') { return { EditorPreview: class {
			async format(source: string, tabSize: number, range?: object) { calls.push({ source, tabSize, range }); if (fail) { throw new Error('format failed'); } return [{ newText: 'formatted' }]; }
			dispose() { disposed++; }
		} }; }
		return require(id);
	} });
	exports.registerCppFormatting!({ subscriptions: [] });
	return { command, api: exports as typeof formatting, calls, disposed: () => disposed };
}

test('default workspace format rules follow 2, 4 and 8 space indentation', async () => {
	const host = await createHost();
	for (const width of [2, 4, 8]) {
		assert.match(host.api.defaultClangFormatConfig(width), new RegExp(`IndentWidth: ${width}\\nTabWidth: ${width}`));
	}
});

test('native formatting preserves source and range, respects both project rule names and cleans up', async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shortestpath-format-test-'));
	const host = await createHost();
	try {
		const nested = path.join(directory, 'nested'); await fs.mkdir(nested);
		const file = path.join(nested, 'main.cpp');
		const range = { start: { line: 2, character: 0 }, end: { line: 4, character: 0 } };
		await host.command(file, 'original\nsource', 8, range);
		await host.command(file, 'original\nsource', 4, [range, range]);
		assert.deepEqual(host.calls, [{ source: 'original\nsource', tabSize: 8, range }, { source: 'original\nsource', tabSize: 4, range: [range, range] }]);
		assert.equal(host.disposed(), 2);
		for (const name of ['.clang-format', '_clang-format']) {
			const config = path.join(directory, name); await fs.writeFile(config, 'IndentWidth: 4');
			assert.equal(await host.api.findCppFormatConfig(nested), config);
			assert.equal(await host.command(file, 'original', 2), undefined);
			await fs.unlink(config);
		}
		assert.equal(host.calls.length, 2);
		assert.equal((await fs.readdir(nested)).length, 0);
	} finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('native formatting failures propagate and still release temporary resources', async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shortestpath-format-test-'));
	const host = await createHost(true);
	try {
		await assert.rejects(host.command(path.join(directory, 'main.cpp'), 'source', 4), /format failed/);
		assert.equal(host.disposed(), 1);
	} finally { await fs.rm(directory, { recursive: true, force: true }); }
});

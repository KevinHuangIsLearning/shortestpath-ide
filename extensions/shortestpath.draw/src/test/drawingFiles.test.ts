/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { test } from 'node:test';
import { DrawingFiles } from '../drawingFiles';
import { DraftStorage } from '../draftStorage';
import { DraftSnapshot } from '../protocol';

const snapshot = (text: string): DraftSnapshot => ({ scene: JSON.stringify({ type: 'excalidraw', elements: [{ text }] }), library: '{"type":"excalidrawlib","libraryItems":[]}' });

test('migrates the legacy draft, persists folders and restores the active drawing independently', async t => {
	const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'draw-files-'));
	t.after(() => fs.rm(folder, { recursive: true, force: true }));
	await new DraftStorage(folder).save(snapshot('legacy'));
	const files = new DrawingFiles(folder, 'Untitled');
	assert.deepEqual(await files.load(), snapshot('legacy'));
	await files.create('', '题目', 'folder');
	const directory = files.state().entries.find(entry => entry.kind === 'folder')!.id;
	await files.create(directory, '图 <script>', 'file');
	const drawing = files.state().active;
	await files.save(snapshot('second'));
	await files.rename(directory, '树');
	await files.move(drawing, '');
	const restored = new DrawingFiles(folder, 'Untitled');
	assert.deepEqual({ snapshot: await restored.load(), state: restored.state() }, { snapshot: snapshot('second'), state: files.state() });
	assert.deepEqual(await restored.open('draft'), snapshot('legacy'));
	assert.deepEqual(await new DraftStorage(folder).read(), snapshot('legacy'));
	assert.deepEqual((await fs.readdir(folder)).sort(), ['draft.json', 'files.json']);
});

test('rejects invalid names, duplicate siblings and moving folders into descendants; deletes recursively', async t => {
	const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'draw-files-'));
	t.after(() => fs.rm(folder, { recursive: true, force: true }));
	const files = new DrawingFiles(folder, 'Untitled');
	await files.load();
	await files.create('', 'A', 'folder');
	const a = files.state().entries.find(entry => entry.name === 'A')!.id;
	await files.create(a, 'B', 'folder');
	const b = files.state().entries.find(entry => entry.name === 'B')!.id;
	await files.create(b, 'drawing', 'file');
	await files.save(snapshot('nested'));
	const before = files.state();
	await assert.rejects(files.move(a, b));
	await assert.rejects(files.create('', '../outside', 'file'));
	await assert.rejects(files.create('', 'a', 'folder'));
	await assert.rejects(files.move('draft', 'missing'));
	assert.deepEqual(files.state(), before);
	assert.equal(await files.remove(a), true);
	assert.deepEqual(files.state(), { active: 'draft', entries: [{ id: 'draft', parent: '', name: 'Untitled', kind: 'file' }] });
	await files.remove('draft');
	assert.equal(files.state().entries.length, 1);
	assert.equal(await files.load(), undefined);
});

test('preserves corrupted catalogs and leaves the prior catalog intact on failed writes', async t => {
	const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'draw-files-'));
	t.after(() => fs.rm(folder, { recursive: true, force: true }));
	await fs.writeFile(path.join(folder, 'files.json'), 'broken');
	await assert.rejects(new DrawingFiles(folder, 'Untitled').load());
	assert.equal(await fs.readFile(path.join(folder, 'files.json'), 'utf8'), 'broken');
	await fs.unlink(path.join(folder, 'files.json'));
	const files = new DrawingFiles(folder, 'Untitled');
	await files.load();
	await files.save(snapshot('kept'));
	await fs.rename(path.join(folder, 'files.json'), path.join(folder, 'backup.json'));
	await fs.mkdir(path.join(folder, 'files.json'));
	await assert.rejects(files.save(snapshot('failed')));
	assert.deepEqual(await files.load(), snapshot('kept'));
	await fs.rmdir(path.join(folder, 'files.json'));
	await fs.rename(path.join(folder, 'backup.json'), path.join(folder, 'files.json'));
	assert.deepEqual(await new DrawingFiles(folder, 'Untitled').load(), snapshot('kept'));
});

test('deleting the last drawing chooses a unique fallback name beside folders', async t => {
	const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'draw-files-'));
	t.after(() => fs.rm(folder, { recursive: true, force: true }));
	const files = new DrawingFiles(folder, 'Untitled');
	await files.load();
	await files.rename('draft', 'First');
	await files.create('', 'Untitled', 'folder');
	await files.remove('draft');
	assert.deepEqual(files.state().entries.map(entry => [entry.kind, entry.name]), [['folder', 'Untitled'], ['file', 'Untitled 2']]);
	await new DrawingFiles(folder, 'Untitled').load();
});

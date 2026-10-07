/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { FirstRunEditorSession } from '../firstRunEditorSession';

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
}

test('editor page and completion require successful environment checks', async () => {
	const session = new FirstRunEditorSession();
	assert.equal(session.save(async () => { assert.fail('saved too early'); }), false);
	assert.equal(await session.enter('editor', false), false);
	assert.equal(await session.complete(true, async () => { assert.fail('completed on compile page'); }), false);
	assert.equal(await session.enter('editor', true), true);
	assert.equal(await session.complete(false, async () => { assert.fail('completed without environment'); }), false);
});

test('directory transition drains template saves and completion locks edits and transitions', async () => {
	const session = new FirstRunEditorSession();
	await session.enter('template', true);
	const held = deferred();
	const order: string[] = [];
	session.save(async () => { await held.promise; order.push('earlier save'); }, 'template');
	const entering = session.enter('workspace', true);
	assert.equal(session.page, 'template');
	held.resolve();
	await entering;
	session.workspaceFolder = '/code';
	const finalWrite = deferred();
	const completing = session.complete(true, async () => { await finalWrite.promise; order.push('final snapshot'); });
	assert.equal(session.finishing, true);
	assert.equal(session.save(async () => { order.push('late save'); }), false);
	assert.equal(await session.enter('compile', true), false);
	assert.equal(await session.complete(true, async () => { order.push('duplicate completion'); }), false);
	finalWrite.resolve();
	assert.equal(await completing, true);
	assert.deepEqual(order, ['earlier save', 'final snapshot']);
	assert.equal(session.finishing, false);
});

test('completion errors unlock retry and preserve the directory page', async () => {
	const session = new FirstRunEditorSession();
	await session.enter('workspace', true);
	session.workspaceFolder = '/code';
	await assert.rejects(session.complete(true, async () => { throw new Error('settings write failed'); }), /settings write failed/);
	assert.equal(session.finishing, false);
	assert.equal(session.page, 'workspace');
	assert.equal(session.workspaceFolder, '/code');
	assert.equal(session.save(async () => {}, 'template'), false);
	assert.equal(await session.complete(true, async () => {}), true);
});

test('returning to compile waits for saves and retains the same session on reopening', async () => {
	const session = new FirstRunEditorSession();
	await session.enter('editor', true);
	const held = deferred();
	session.save(async () => { await held.promise; });
	const entering = session.enter('compile', true);
	assert.equal(session.page, 'editor');
	held.resolve(); await entering;
	assert.equal(session.page, 'compile');
	await session.enter('editor', true);
	assert.equal(session.page, 'editor');
});

test('completion requires the directory page and a selected directory', async () => {
	const session = new FirstRunEditorSession();
	await session.enter('template', true);
	session.workspaceFolder = '/code';
	assert.equal(await session.complete(true, async () => { assert.fail('completed on template page'); }), false);
	await session.enter('workspace', true);
	session.workspaceFolder = undefined;
	assert.equal(await session.complete(true, async () => { assert.fail('completed without directory'); }), false);
	session.workspaceFolder = '/code';
	assert.equal(await session.complete(false, async () => { assert.fail('completed without environment'); }), false);
});

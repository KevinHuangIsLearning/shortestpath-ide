/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { SolveCoordinator, type SolveContent, type SolveDocument } from '../solveCoordinator';

function activation() {
	const reads: Array<() => void> = [];
	const shown: string[] = [];
	const updated: string[] = [];
	let active: SolveDocument | undefined = { sourcePath: '/A.cpp', instance: {} };
	const content = (sourcePath: string): SolveContent => ({ sourcePath, context: { ref: sourcePath.slice(1, 2), url: 'https://example.com/A', accountId: 'account' } });
	const load = (source: string) => new Promise<SolveContent>(resolve => reads.push(() => resolve(content(source))));
	const coordinator = new SolveCoordinator({
		currentDocument: () => active,
		loadSource: load,
		loadUrl: url => load('/' + url.split('/').pop() + '.cpp'),
		update: value => updated.push(value.context.ref),
		select: value => shown.push(value.context.ref),
		open: async value => { shown.push(value.context.ref); },
	});
	return { coordinator, updated, show: (url: string, source?: string) => coordinator.openUrl(url, source), shown, reads,
		select: (source?: string) => { active = source ? { sourcePath: source, instance: {} } : undefined; coordinator.selectionChanged(); },
		restore: (source: string) => coordinator.restore(content(source)) };
}

test('a slow automatic activation cannot reopen A after the user has selected B', async () => {
	const f = activation();
	const first = f.show('https://example.com/A', '/A.cpp');
	f.select('/B.cpp');
	const second = f.show('https://example.com/B', '/B.cpp');
	f.reads[1]();
	await second;
	f.reads[0]();
	await first;
	assert.deepEqual(f.shown, ['B']);
});

test('leaving the source tab while its cache loads cancels automatic activation', async () => {
	const f = activation();
	const pending = f.show('https://example.com/A', '/A.cpp');
	f.select();
	f.reads[0]();
	await pending;
	assert.deepEqual(f.shown, []);
});

test('an already obsolete automatic request does not read the cache', async () => {
	const f = activation();
	f.select('/B.cpp');
	const pending = f.show('https://example.com/A', '/A.cpp');
	// Release a read on the unfixed implementation so the regression fails rather than hangs.
	f.reads[0]?.();
	await pending;
	assert.deepEqual({ reads: f.reads.length, shown: f.shown }, { reads: 0, shown: [] });
});

test('explicit problem navigation can still open a different source', async () => {
	const f = activation();
	f.select('/B.cpp');
	const pending = f.show('https://example.com/A');
	f.reads[0]();
	await pending;
	assert.deepEqual(f.shown, ['A']);
});

for (const scenario of ['reopen', 'away and back', 'dispose']) {
	test(`pending selection is invalidated by ${scenario}`, async () => {
		const f = activation();
		const pending = f.coordinator.synchronize();
		if (scenario === 'dispose') { f.coordinator.dispose(); }
		else { f.select(); f.select('/A.cpp'); }
		f.reads[0]();
		await pending;
		assert.deepEqual(f.shown, []);
	});
}

test('background restoration updates data without selecting a different document', () => {
	const f = activation();
	f.select('/B.cpp');
	f.restore('/A.cpp');
	assert.deepEqual(f.updated, ['A']);
	assert.deepEqual(f.shown, []);
});

test('repeated notifications for the same tab do not reload or select again', async () => {
	const f = activation();
	const pending = f.coordinator.synchronize();
	f.reads[0]();
	await pending;
	await f.coordinator.synchronize();
	assert.equal(f.reads.length, 1);
	assert.deepEqual(f.shown, ['A']);
});

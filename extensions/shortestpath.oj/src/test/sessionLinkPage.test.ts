/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { SessionLinkPage } from '../sessionLinkPage';

test('session page retries failed opens, reopens closed pages, and closes late disposed results', async context => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	let attempts = 0;
	let closes = 0;
	let resolveLate: ((page: { id: string; close: () => Promise<void> }) => void) | undefined;
	const page = new SessionLinkPage('https://shortestpath.cn/ide/session', async () => {
		attempts++;
		if (attempts === 1) { throw new Error('offline'); }
		if (attempts === 3) { return new Promise(resolve => { resolveLate = resolve; }); }
		return { id: 'page', close: async () => { closes++; } };
	}, () => { });
	page.start(); await setImmediate();
	context.mock.timers.tick(1000); await setImmediate();
	assert.equal(attempts, 2);
	page.pageClosed('unrelated'); context.mock.timers.tick(1000); assert.equal(attempts, 2);
	page.pageClosed('page'); context.mock.timers.tick(1000); await setImmediate();
	assert.equal(attempts, 3);
	page.dispose(); resolveLate?.({ id: 'late', close: async () => { closes++; } });
	await setImmediate();
	assert.equal(closes, 1);
	context.mock.timers.tick(60_000); assert.equal(attempts, 3);
});

test('a page handle with failed navigation is rebuilt until the native relay connects', async context => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	let connected = false;
	let opens = 0;
	let closes = 0;
	const page = new SessionLinkPage('https://shortestpath.cn/ide/session', async () => ({ id: String(++opens), close: async () => { closes++; } }), () => { }, () => connected);
	page.start(); await setImmediate();
	context.mock.timers.tick(30_000); await setImmediate();
	assert.equal(opens, 2); assert.equal(closes, 1);
	connected = true;
	context.mock.timers.tick(30_000); await setImmediate();
	assert.equal(opens, 2);
	page.dispose();
	context.mock.timers.tick(60_000); await setImmediate();
	assert.equal(opens, 2); assert.equal(closes, 2);
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionLinkRelay } from '../sessionLinkRelay';

type Frame = { type: string; data: object };
function harness() {
	const relay = new SessionLinkRelay();
	const frames = new Map<number, Frame[]>();
	const send = (id: number, type: string, data: object, origin = 'https://shortestpath.cn') => relay.handle(id, origin, type, data, (type, data) => {
		const received = frames.get(id) ?? []; received.push({ type, data }); frames.set(id, received);
	});
	const state = (id: number, userId: string | null, sessionRef: string) => send(id, 'session.link.state', { userId, sessionRef, challenge: String(id).repeat(43) });
	return { relay, frames, send, state };
}

test('external login attaches the authenticated native relay using scoped authorization codes', () => {
	const { relay, frames, send, state } = harness();
	send(1, 'session.link.hello', { token: relay.token });
	send(2, 'session.link.hello', {});
	state(1, null, ''); state(2, '7', '10:1');
	assert.deepEqual(frames.get(2)?.at(-1), { type: 'session.link.offer', data: { targetId: 1, challenge: '1'.repeat(43) } });
	// A duplicate status probe cannot cancel the in-flight grant.
	state(1, null, '');
	send(2, 'session.link.grant', { targetId: 1, code: 'c'.repeat(43) });
	assert.deepEqual(frames.get(1)?.at(-1), { type: 'session.link.redeem', data: { code: 'c'.repeat(43), challenge: '1'.repeat(43) } });
	state(1, '7', '10:1');
	const before = frames.get(1)?.length;
	send(2, 'session.link.grant', { targetId: 1, code: 'c'.repeat(43) });
	assert.equal(frames.get(1)?.length, before);
});

test('native login automatically attaches an external browser and does not switch different accounts', () => {
	const { relay, frames, send, state } = harness();
	send(1, 'session.link.hello', { token: relay.token });
	send(2, 'session.link.hello', {});
	state(2, null, ''); state(1, '7', '10:1');
	assert.deepEqual(frames.get(1)?.at(-1), { type: 'session.link.offer', data: { targetId: 2, challenge: '2'.repeat(43) } });
	state(2, '8', '11:1');
	const before = frames.get(1)?.length;
	state(1, '7', '12:1');
	assert.equal(frames.get(1)?.filter(frame => frame.type === 'session.link.offer').length, 1);
	assert.ok((frames.get(1)?.length ?? 0) >= (before ?? 0));
});

test('bootstrap, source identity and same-origin boundaries protect automatic grants', () => {
	const { relay, frames, send, state } = harness();
	send(1, 'session.link.hello', { token: 'wrong' });
	assert.deepEqual(frames.get(1), [{ type: 'session.link.error', data: { code: 'invalid_bootstrap' } }]);
	send(1, 'session.link.hello', { token: relay.token }); state(1, null, '');
	state(2, '7', '10:1'); // Unregistered peers cannot act as a source.
	send(3, 'session.link.hello', {}, 'http://localhost:3000');
	send(3, 'session.link.state', { userId: '7', sessionRef: '10:1', challenge: '3'.repeat(43) }, 'http://localhost:3000');
	assert.equal(frames.get(2)?.some(frame => frame.type === 'session.link.offer') ?? false, false);
	assert.equal(frames.get(3)?.some(frame => frame.type === 'session.link.offer'), false);
	send(2, 'session.link.hello', {}); state(2, '7', '10:1');
	const before = frames.get(1)?.length;
	send(3, 'session.link.grant', { targetId: 1, code: 'c'.repeat(43) }, 'http://localhost:3000');
	assert.equal(frames.get(1)?.length, before);
	send(2, 'session.link.pause', {});
	relay.remove(2);
	send(2, 'session.link.grant', { targetId: 1, code: 'c'.repeat(43) });
	assert.equal(frames.get(1)?.at(-1)?.type, 'session.link.resume');
});


test('mutations pause only matching accounts and resume only their recipients', () => {
	const { relay, frames, send, state } = harness();
	send(1, 'session.link.hello', { token: relay.token }); state(1, '7', '10:1');
	send(2, 'session.link.hello', {}); state(2, '8', '11:1');
	send(1, 'session.link.pause', {}); send(1, 'session.link.resume', {});
	assert.equal(frames.get(2)?.some(frame => frame.type === 'session.link.pause' || frame.type === 'session.link.resume'), false);
	state(2, '7', '10:1');
	send(1, 'session.link.pause', {});
	assert.equal(frames.get(2)?.at(-1)?.type, 'session.link.pause');
	state(1, '9', '12:1'); send(1, 'session.link.resume', {});
	assert.equal(frames.get(2)?.at(-1)?.type, 'session.link.resume');
});

test('failed grants cannot form an immediate offer loop', () => {
	const { relay, frames, send, state } = harness();
	send(1, 'session.link.hello', { token: relay.token }); state(1, null, '');
	send(2, 'session.link.hello', {}); state(2, '7', '10:1');
	send(2, 'session.link.failed', { targetId: 1 });
	for (let i = 0; i < 10; i++) { state(1, null, ''); state(2, '7', '10:1'); }
	assert.equal(frames.get(2)?.filter(frame => frame.type === 'session.link.offer').length, 1);
});

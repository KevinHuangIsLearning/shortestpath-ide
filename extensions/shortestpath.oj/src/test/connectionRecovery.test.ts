/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { ShortestPathOjLocalBridge } from '../shortestpathOjLocalBridge';
import { parseProblemBindData } from '../shortestpathOjProtocol';
import { ConnectionRecovery, RecoveryState } from '../connectionRecovery';
import { bindPayload } from './fixtures';
import { getWorkspaceProblemRecoveryContext, readWorkspaceProblemRecoveryContext } from '../workspaceProblemCache';

const payload = { ...bindPayload, problem: { ...bindPayload.problem, target: { kind: 'training', problemId: '1', problemRef: bindPayload.problem.ref }, accountId: '1', publicContent: { title: 'A' }, localTest: { enabled: true, reason: '' } } };
const problem = parseProblemBindData(payload, 2);

test('real bridge resumes an evicted problem from its minimal persisted identity without importing samples or executing actions', async () => {
	let imports = 0;
	let resumes = 0;
	let activations = 0;
	const states: string[] = [];
	const bridge = new ShortestPathOjLocalBridge({ importProblem: async () => { imports++; return 'created'; }, resumeProblem: async () => { resumes++; }, activateProblem: () => {}, activateBoundProblem: async () => { activations++; }, updateProblemState: async () => {}, handleEvent() {}, handleDisconnect() {}, handleRecoveryStatus: (_ref, state) => states.push(state) }, 0);
	const socket = new WebSocket(`ws://127.0.0.1:${await bridge.listeningPort()}/shortestpath-oj`, 'shortestpath-oj-v2', { origin: 'https://shortestpath.cn' });
	await new Promise<void>(resolve => socket.once('open', resolve));
	const request = (type: string, data: object, sessionId?: string) => new Promise<{ ok: boolean; sessionId?: string; data?: { accountId?: string }; error?: { code: string } }>(resolve => {
		const id = randomUUID();
		const listener = (raw: Buffer) => { const value = JSON.parse(raw.toString()); if (value.replyTo === id) { socket.off('message', listener); resolve(value); } };
		socket.on('message', listener);
		socket.send(JSON.stringify({ version: 2, kind: 'request', id, type, data, sessionId }));
	});
	try {
		const identity = readWorkspaceProblemRecoveryContext(JSON.parse(JSON.stringify(getWorkspaceProblemRecoveryContext(problem))));
		assert.ok(identity);
		assert.deepEqual(Object.keys(identity).sort(), ['accountId', 'ref', 'target', 'url']);
		const token = bridge.prepareRecovery(identity);
		assert.equal((await request('bridge.recovery.context', { token })).data?.accountId, '1');
		assert.equal((await request('bridge.recovery.status', { token, status: 'login_required' })).ok, true);
		assert.deepEqual(states, ['login_required']);
		assert.equal((await request('bridge.recovery.status', { token, status: 'verification_required' })).ok, true);
		assert.equal(states.at(-1), 'verification_required');
		assert.equal((await request('problem.resume', { ...payload, token, problem: { ...payload.problem, accountId: '2' } })).error?.code, 'context_mismatch');
		assert.equal((await request('problem.resume', { ...payload, token, problem: { ...payload.problem, target: { ...payload.problem.target, problemId: '2' } } })).ok, false);
		assert.equal((await request('problem.resume', { ...payload, token: randomUUID() })).error?.code, 'recovery_expired');
		const resumed = await request('problem.resume', { ...payload, token });
		assert.deepEqual({ imports, resumes, connected: bridge.isBound(problem.ref), session: Boolean(resumed.sessionId) }, { imports: 0, resumes: 1, connected: true, session: true });
		assert.equal((await request('problem.activate', {}, 'obsolete')).ok, false);
		assert.equal((await request('problem.activate', {}, resumed.sessionId)).ok, true);
		assert.deepEqual({ imports, resumes, activations, session: bridge.getActiveSession()?.sessionId }, { imports: 0, resumes: 1, activations: 1, session: resumed.sessionId });
		bridge.cancelRecovery();
		assert.equal((await request('problem.resume', { ...payload, token })).error?.code, 'recovery_expired');
	} finally { socket.terminate(); await bridge.close(); }
});

test('a selected problem change expires a resume already awaiting state refresh', async () => {
	let release!: () => void;
	let entered!: () => void;
	const waiting = new Promise<void>(resolve => { entered = resolve; });
	let activated = 0;
	const bridge = new ShortestPathOjLocalBridge({ importProblem: async () => 'created', resumeProblem: async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); }, activateProblem: () => { activated++; }, updateProblemState: async () => {}, handleEvent() {}, handleDisconnect() {} }, 0);
	const socket = new WebSocket(`ws://127.0.0.1:${await bridge.listeningPort()}/shortestpath-oj`, 'shortestpath-oj-v2', { origin: 'https://shortestpath.cn' });
	await new Promise<void>(resolve => socket.once('open', resolve));
	try {
		const token = bridge.prepareRecovery(problem);
		const response = new Promise<{ ok: boolean }>(resolve => socket.once('message', raw => resolve(JSON.parse(raw.toString()))));
		socket.send(JSON.stringify({ version: 2, kind: 'request', id: randomUUID(), type: 'problem.resume', data: { ...payload, token } }));
		await waiting;
		bridge.prepareRecovery({ ...problem, ref: 'DSU/found/B' });
		release();
		assert.deepEqual({ ok: (await response).ok, activated }, { ok: false, activated: 0 });
	} finally { socket.terminate(); await bridge.close(); }
});

test('recovery owns one page, pauses for login, and closes obsolete asynchronous pages', async () => {
	const states: RecoveryState[] = [];
	const closed: string[] = [];
	const resolveOpens: Array<(page: { id: string; close(): Promise<void>; show(): Promise<void> }) => void> = [];
	let opens = 0;
	const manager = new ConnectionRecovery({ open: async () => { opens++; return new Promise(resolve => { resolveOpens.push(resolve); }); }, prepare: () => randomUUID(), cancel() {}, isBound: () => false, status: (_ref, state) => states.push(state) }, 1000, 1);
	const page = (id: string) => ({ id, close: async () => { closed.push(id); }, show: async () => {} });
	try {
		manager.select(problem);
		manager.select(problem);
		assert.equal(opens, 1);
		manager.select({ ...problem, accountId: '2' });
		resolveOpens[0](page('obsolete'));
		resolveOpens[1](page('current'));
		await new Promise(resolve => setTimeout(resolve, 0));
		manager.websiteStatus(problem.ref, 'login_required');
		const before = opens;
		manager.select({ ...problem, accountId: '2' });
		await new Promise(resolve => setTimeout(resolve, 10));
		assert.deepEqual({ opens, last: states.at(-1) }, { opens: before, last: 'login_required' });
	} finally { manager.dispose(); }
	assert.deepEqual(closed, ['obsolete', 'current']);
});

for (const state of ['login_required', 'account_mismatch', 'verification_required'] as const) {
	test(`${state} automatically shows the existing page once and returns to solve after recovery`, async () => {
		let opens = 0;
		let shown = 0;
		let returns = 0;
		const manager = new ConnectionRecovery({
			open: async () => { opens++; return { id: 'recovery', close: async () => {}, show: async () => { shown++; } }; },
			prepare: () => randomUUID(), cancel() {}, isBound: () => false, status() {},
			returnToSolve: async () => { returns++; },
		}, 1000, 1);
		try {
			manager.select(problem);
			await new Promise(resolve => setTimeout(resolve, 0));
			manager.websiteStatus('another-problem', state);
			assert.equal(shown, 0);
			manager.websiteStatus(problem.ref, state);
			manager.websiteStatus(problem.ref, state);
			manager.websiteStatus(problem.ref, 'connecting');
			manager.websiteStatus(problem.ref, state);
			await Promise.resolve();
			assert.deepEqual({ opens, shown, returns }, { opens: 1, shown: 1, returns: 0 });
			manager.connected(problem, true);
			manager.websiteStatus(problem.ref, state);
			await Promise.resolve();
			assert.deepEqual({ opens, shown, returns }, { opens: 1, shown: 2, returns: 1 });
		} finally { manager.dispose(); }
	});
}

test('login required during navigation automatically shows the page once and reuses it after recovery', async () => {
	let resolveOpen!: (page: { id: string; close(): Promise<void>; show(): Promise<void> }) => void;
	let shown = 0;
	let closed = 0;
	let opens = 0;
	let returns = 0;
	const manager = new ConnectionRecovery({
		open: () => { opens++; return new Promise(resolve => { resolveOpen = resolve; }); },
		prepare: () => randomUUID(), cancel() {}, isBound: () => false, status() {},
		returnToSolve: async () => { returns++; },
	}, 1000, 1);
	try {
		manager.select(problem);
		manager.websiteStatus(problem.ref, 'login_required');
		manager.websiteStatus(problem.ref, 'login_required');
		resolveOpen({ id: 'login', close: async () => { closed++; }, show: async () => { shown++; } });
		await new Promise(resolve => setTimeout(resolve, 0));
		assert.equal(shown, 1);
		manager.connected(problem, true);
		await new Promise(resolve => setTimeout(resolve, 0));
		assert.deepEqual({ closed, opens, returns }, { closed: 0, opens: 1, returns: 1 });
		assert.equal(shown, 1);
	} finally { manager.dispose(); }
	assert.equal(closed, 1);
});

test('recovery before navigation completes cancels the automatic redirect', async () => {
	let resolveOpen!: (page: { id: string; close(): Promise<void>; show(): Promise<void> }) => void;
	let shown = 0;
	let returns = 0;
	let bound = false;
	const manager = new ConnectionRecovery({
		open: () => new Promise(resolve => { resolveOpen = resolve; }),
		prepare: () => randomUUID(), cancel() {}, isBound: () => bound, status() {},
		returnToSolve: async () => { returns++; },
	}, 1000, 1);
	try {
		manager.select(problem);
		manager.websiteStatus(problem.ref, 'verification_required');
		bound = true;
		manager.connected(problem, true);
		resolveOpen({ id: 'connected', close: async () => {}, show: async () => { shown++; } });
		await new Promise(resolve => setTimeout(resolve, 0));
		assert.deepEqual({ shown, returns }, { shown: 0, returns: 0 });
	} finally { manager.dispose(); }
});

test('verification on an already bound relay returns to solve when the challenge completes', async () => {
	const states: RecoveryState[] = [];
	let bound = false;
	let shown = 0;
	let returns = 0;
	const manager = new ConnectionRecovery({
		open: async () => ({ id: 'bound', close: async () => {}, show: async () => { shown++; } }),
		prepare: () => randomUUID(), cancel() {}, isBound: () => bound, status: (_ref, state) => states.push(state),
		returnToSolve: async () => { returns++; },
	}, 1000, 1);
	try {
		manager.select(problem);
		await new Promise(resolve => setTimeout(resolve, 0));
		bound = true;
		manager.connected(problem, true);
		manager.websiteStatus(problem.ref, 'verification_required');
		manager.websiteStatus(problem.ref, 'connecting');
		manager.websiteStatus(problem.ref, 'connecting');
		await Promise.resolve();
		assert.deepEqual({ shown, returns, last: states.at(-1) }, { shown: 1, returns: 1, last: 'connected' });
		manager.websiteStatus(problem.ref, 'verification_required');
		await Promise.resolve();
		assert.equal(shown, 2);
	} finally { manager.dispose(); }
});

test('verification and a visible page survive the deadline without rereading the problem', async () => {
	const states: RecoveryState[] = [];
	let opens = 0;
	let closed = 0;
	let bound = false;
	const manager = new ConnectionRecovery({
		open: async () => { opens++; return { id: 'verification', close: async () => { closed++; }, show: async () => {} }; },
		prepare: () => randomUUID(), cancel() {}, isBound: () => bound, status: (_ref, state) => states.push(state),
	}, 5, 1);
	try {
		manager.select(problem);
		await new Promise(resolve => setTimeout(resolve, 0));
		manager.websiteStatus(problem.ref, 'verification_required');
		manager.select(problem);
		await new Promise(resolve => setTimeout(resolve, 20));
		assert.deepEqual({ opens, closed, last: states.at(-1) }, { opens: 1, closed: 0, last: 'verification_required' });
		await manager.login();
		manager.websiteStatus(problem.ref, 'connecting');
		manager.websiteStatus(problem.ref, 'error');
		manager.select(problem);
		await new Promise(resolve => setTimeout(resolve, 20));
		assert.deepEqual({ opens, closed }, { opens: 1, closed: 0 });
		bound = true;
		manager.connected(problem, true);
		// A queued challenge-completion notification can arrive after resume.
		manager.websiteStatus(problem.ref, 'connecting');
		assert.equal(states.at(-1), 'connected');
		manager.pageClosed('verification');
		await new Promise(resolve => setTimeout(resolve, 20));
		assert.equal(opens, 2);
	} finally { manager.dispose(); }
});

test('relay errors allow website retries before replacing the page', async () => {
	let opens = 0;
	let closed = 0;
	const manager = new ConnectionRecovery({
		open: async () => { opens++; return { id: 'relay', close: async () => { closed++; }, show: async () => {} }; },
		prepare: () => randomUUID(), cancel() {}, isBound: () => false, status() {},
	}, 1000, 1);
	try {
		manager.select(problem);
		await new Promise(resolve => setTimeout(resolve, 0));
		manager.websiteStatus(problem.ref, 'error');
		await new Promise(resolve => setTimeout(resolve, 20));
		assert.deepEqual({ opens, closed }, { opens: 1, closed: 0 });
	} finally { manager.dispose(); }
});

test('closing a visible relay restores timeout protection for its hidden replacement', async () => {
	let opens = 0;
	let replaced!: () => void;
	const replacementTimedOut = new Promise<void>(resolve => { replaced = resolve; });
	const manager = new ConnectionRecovery({
		open: async () => {
			const id = String(++opens);
			if (opens === 3) { replaced(); }
			return { id, close: async () => {}, show: async () => {} };
		},
		prepare: () => randomUUID(), cancel() {}, isBound: () => false, status() {},
	}, 20, 1);
	try {
		manager.select(problem);
		await new Promise(resolve => setTimeout(resolve, 0));
		await manager.login();
		manager.pageClosed('1');
		await replacementTimedOut;
		assert.equal(opens, 3);
	} finally { manager.dispose(); }
});

test('a silent connection timeout reports retry state and replaces the old page', async () => {
	const states: RecoveryState[] = [];
	const closed: string[] = [];
	let opens = 0;
	let bound = false;
	let retried!: () => void;
	const retry = new Promise<void>(resolve => { retried = resolve; });
	const manager = new ConnectionRecovery({
		open: async () => {
			const id = String(++opens);
			if (opens === 2) { bound = true; retried(); }
			return { id, close: async () => { closed.push(id); }, show: async () => {} };
		},
		prepare: () => randomUUID(), cancel() {}, isBound: () => bound, status: (_ref, state) => states.push(state),
	}, 5, 1);
	try {
		manager.select(problem);
		await retry;
		assert.ok(states.includes('error'));
		assert.deepEqual(closed, ['1']);
		assert.equal(opens, 2);
	} finally { manager.dispose(); }
});

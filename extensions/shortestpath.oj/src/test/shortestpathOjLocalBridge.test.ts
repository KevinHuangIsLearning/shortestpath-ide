/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { RawData, WebSocket } from 'ws';
import { OutcomeUnknownError, ShortestPathOjLocalBridge } from '../shortestpathOjLocalBridge';
import { bridgeProtocol, ImportedProblem, IncomingEvent, ProblemState } from '../shortestpathOjProtocol';
import { bindPayload, statePayload } from './fixtures';

test('enforces one active session, reuses same binding, and replaces the old page', async () => {
	const imports: ImportedProblem[] = [];
	const states: ProblemState[] = [];
	const events: IncomingEvent[] = [];
	const bridge = createBridge(imports, states, events);
	const port = await bridge.listeningPort();
	await assert.rejects(openSocket(port, 'https://example.com'), /Unexpected server response: 401/);
	const first = await openSocket(port);
	try {
		const initial = await sendRequest(first, 'problem.bind', bindPayload);
		const sessionId = stringField(initial, 'sessionId');
		assert.deepStrictEqual(
			{ type: initial.type, ok: initial.ok, action: recordField(initial, 'data').action, sessionId: sessionId.length > 0 },
			{ type: 'problem.bind.result', ok: true, action: 'created', sessionId: true },
		);

		const reactivated = await sendRequest(first, 'problem.bind', bindPayload);
		assert.deepStrictEqual(
			{ sessionId: reactivated.sessionId, action: recordField(reactivated, 'data').action },
			{ sessionId, action: 'reactivated' },
		);

		const mismatch = await sendRequest(first, 'problem.state.sync', { state: statePayload }, 'wrong-session');
		assert.equal(recordField(mismatch, 'error').code, 'session_mismatch');
		const synced = await sendRequest(first, 'problem.state.sync', { state: statePayload }, sessionId);
		assert.deepStrictEqual({ ok: synced.ok, updates: states.length }, { ok: true, updates: 1 });

		const replacementEvent = nextMessage(first, message => message.type === 'session.replaced');
		const closed = new Promise<{ code: number; reason: string }>(resolve => {
			first.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
		});
		const second = await openSocket(port);
		try {
			const replacementPayload = {
				...bindPayload,
				problem: {
					...bindPayload.problem,
					ref: 'DSU/found/B',
					title: '第二题',
					url: 'https://shortestpath.cn/problem/DSU/found/B',
				},
			};
			const rebound = await sendRequest(second, 'problem.bind', replacementPayload);
			assert.equal(recordField(rebound, 'data').replacedPrevious, true);
			const event = await replacementEvent;
			assert.deepStrictEqual(
				{
					version: event.version,
					hasId: typeof event.id === 'string' && event.id.length > 0,
					type: event.type,
					sessionId: event.sessionId,
					data: event.data,
					close: await closed,
					active: bridge.getActiveSession()?.problemRef,
				},
				{
					version: 1,
					hasId: true,
					type: 'session.replaced',
					sessionId,
					data: { reason: 'another_problem_bound', activeProblemRef: 'DSU/found/B' },
					close: { code: 4001, reason: 'problem_replaced' },
					active: 'DSU/found/B',
				},
			);
		} finally {
			second.terminate();
		}
	} finally {
		first.terminate();
		await bridge.close();
	}
});

test('validates IDE request responses and accepts terminal event snapshots', async () => {
	const imports: ImportedProblem[] = [];
	const states: ProblemState[] = [];
	const events: IncomingEvent[] = [];
	const bridge = createBridge(imports, states, events);
	const port = await bridge.listeningPort();
	const socket = await openSocket(port);
	try {
		const bound = await sendRequest(socket, 'problem.bind', bindPayload);
		const sessionId = stringField(bound, 'sessionId');
		socket.on('message', data => {
			const request = JSON.parse(data.toString()) as Record<string, unknown>;
			if (request.type !== 'hint.answer.request') {
				return;
			}
			socket.send(JSON.stringify({
				version: 1,
				id: 'website-response',
				replyTo: request.id,
				type: 'hint.answer.result',
				sessionId,
				ok: true,
				data: {
					state: 'revealed',
					hintId: '123',
					answer: { format: 'markdown', content: '答案' },
					viewedAtUnixMs: 1_785_320_000_001,
					likes: {
						question: { liked: false, count: 3 },
						answer: { liked: false, count: 1 },
					},
				},
			}));
		});
		assert.equal((await bridge.requestHintAnswer('DSU/found/A', '123')).state, 'revealed');

		socket.send(JSON.stringify({
			version: 1,
			id: 'finished-event',
			type: 'stress.finished',
			sessionId,
			data: {
				task: {
					taskId: '78',
					submissionId: '456',
					status: 'found',
					roundsPlanned: 120,
					roundsExecuted: 37,
					counterExample: { input: '1', expected: '2', actual: '3' },
					billing: { amount: 0, currency: 'free', refundAmount: 0 },
					createdAt: '2026-07-29T12:31:00Z',
					finishedAt: '2026-07-29T12:32:10Z',
				},
			},
		}));
		await waitFor(() => events.length === 1);
		assert.deepStrictEqual(
			events[0].type === 'stress.finished' ? events[0].data.task.counterExample : undefined,
			{ input: '1', expected: '2', actual: '3' },
		);

		const unsupported = await sendRequest(socket, 'future.request', {}, sessionId);
		assert.equal(recordField(unsupported, 'error').code, 'unsupported_type');
	} finally {
		socket.terminate();
		await bridge.close();
	}
});

test('keeps the previous active session when a later import fails', async () => {
	const bridge = new ShortestPathOjLocalBridge({
		async importProblem(problem) {
			if (problem.ref.endsWith('/B')) {
				throw new Error('import failed');
			}
			return 'created';
		},
		async updateProblemState() { },
		handleEvent() { },
		handleDisconnect() { },
	}, 0);
	const port = await bridge.listeningPort();
	const first = await openSocket(port);
	const second = await openSocket(port);
	try {
		await sendRequest(first, 'problem.bind', bindPayload);
		const failed = await sendRequest(second, 'problem.bind', {
			...bindPayload,
			problem: {
				...bindPayload.problem,
				ref: 'DSU/found/B',
				url: 'https://shortestpath.cn/problem/DSU/found/B',
			},
		});
		assert.deepStrictEqual(
			{ ok: failed.ok, code: recordField(failed, 'error').code, active: bridge.getActiveSession()?.problemRef },
			{ ok: false, code: 'request_failed', active: 'DSU/found/A' },
		);
		assert.equal(recordField(failed, 'error').message, 'import failed');
	} finally {
		first.terminate();
		second.terminate();
		await bridge.close();
	}
});

test('times out a hanging bind without blocking the next bind', async () => {
	let importCount = 0;
	let activeImports = 0;
	let maximumActiveImports = 0;
	const bridge = new ShortestPathOjLocalBridge({
		async importProblem(_problem, signal) {
			importCount++;
			activeImports++;
			maximumActiveImports = Math.max(maximumActiveImports, activeImports);
			if (importCount === 1) {
				try {
					return await new Promise<'created'>((_resolve, reject) => {
						signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
					});
				} finally {
					activeImports--;
				}
			}
			activeImports--;
			return 'created';
		},
		async updateProblemState() { },
		handleEvent() { },
		handleDisconnect() { },
	}, 0, '127.0.0.1', 20);
	const port = await bridge.listeningPort();
	const first = await openSocket(port);
	const second = await openSocket(port);
	try {
		const timedOut = await sendRequest(first, 'problem.bind', bindPayload);
		const rebound = await sendRequest(second, 'problem.bind', {
			...bindPayload,
			problem: {
				...bindPayload.problem,
				ref: 'DSU/found/B',
				url: 'https://shortestpath.cn/problem/DSU/found/B',
			},
		});
		assert.deepStrictEqual(
			{
				timeoutCode: recordField(timedOut, 'error').code,
				timeoutMessage: recordField(timedOut, 'error').message,
				nextOk: rebound.ok,
				active: bridge.getActiveSession()?.problemRef,
				maximumActiveImports,
			},
			{
				timeoutCode: 'request_failed',
				timeoutMessage: '题目导入超时。',
				nextOk: true,
				active: 'DSU/found/B',
				maximumActiveImports: 1,
			},
		);
	} finally {
		first.terminate();
		second.terminate();
		await bridge.close();
	}
});

test('preserves outcome-unknown semantics when replacing a session with a pending submission', async () => {
	const bridge = createBridge([], [], []);
	const port = await bridge.listeningPort();
	const first = await openSocket(port);
	const second = await openSocket(port);
	try {
		await sendRequest(first, 'problem.bind', bindPayload);
		const requestReceived = nextMessage(first, message => message.type === 'submission.request');
		const pending = bridge.requestSubmission('DSU/found/A', 'operation-id', 'cpp20', 'int main() {}');
		const rejected = assert.rejects(pending, error => error instanceof OutcomeUnknownError);
		await requestReceived;
		await sendRequest(second, 'problem.bind', {
			...bindPayload,
			problem: {
				...bindPayload.problem,
				ref: 'DSU/found/B',
				url: 'https://shortestpath.cn/problem/DSU/found/B',
			},
		});
		await rejected;
	} finally {
		first.terminate();
		second.terminate();
		await bridge.close();
	}
});

test('treats a mismatched side-effect response as outcome unknown', async () => {
	const bridge = createBridge([], [], []);
	const port = await bridge.listeningPort();
	const socket = await openSocket(port);
	try {
		const bound = await sendRequest(socket, 'problem.bind', bindPayload);
		const sessionId = stringField(bound, 'sessionId');
		socket.on('message', data => {
			const request = JSON.parse(data.toString()) as Record<string, unknown>;
			if (request.type !== 'hint.answer.request') {
				return;
			}
			socket.send(JSON.stringify({
				version: 1,
				id: 'mismatched-response',
				replyTo: request.id,
				type: 'hint.answer.result',
				sessionId,
				ok: true,
				data: {
					state: 'open_required',
					hintId: 'different-hint',
				},
			}));
		});
		await assert.rejects(
			bridge.requestHintAnswer('DSU/found/A', '123'),
			error => error instanceof OutcomeUnknownError,
		);
	} finally {
		socket.terminate();
		await bridge.close();
	}
});

function createBridge(imports: ImportedProblem[], states: ProblemState[], events: IncomingEvent[]): ShortestPathOjLocalBridge {
	return new ShortestPathOjLocalBridge({
		async importProblem(problem) {
			const action = imports.some(item => item.ref === problem.ref) ? 'updated' : 'created';
			imports.push(problem);
			return action;
		},
		async updateProblemState(_problemRef, state) {
			states.push(state);
		},
		handleEvent(_problemRef, event) {
			events.push(event);
		},
		handleDisconnect() { },
	}, 0);
}

function openSocket(port: number, origin = 'https://shortestpath.cn'): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(`ws://127.0.0.1:${port}/shortestpath-oj`, bridgeProtocol, { origin });
		socket.once('open', () => resolve(socket));
		socket.once('error', reject);
	});
}

function sendRequest(socket: WebSocket, type: string, data: unknown, sessionId?: string): Promise<Record<string, unknown>> {
	const id = `${type}-${Math.random()}`;
	return new Promise(resolve => {
		const listener = (raw: RawData) => {
			const response = JSON.parse(raw.toString()) as Record<string, unknown>;
			if (response.replyTo !== id) {
				return;
			}
			socket.off('message', listener);
			resolve(response);
		};
		socket.on('message', listener);
		socket.send(JSON.stringify({ version: 1, id, type, sessionId, data }));
	});
}

function nextMessage(socket: WebSocket, predicate: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
	return new Promise(resolve => {
		const listener = (raw: RawData) => {
			const message = JSON.parse(raw.toString()) as Record<string, unknown>;
			if (!predicate(message)) {
				return;
			}
			socket.off('message', listener);
			resolve(message);
		};
		socket.on('message', listener);
	});
}

function recordField(value: Record<string, unknown>, field: string): Record<string, unknown> {
	const result = value[field];
	assert.ok(typeof result === 'object' && result !== null && !Array.isArray(result));
	return result as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, field: string): string {
	const result = value[field];
	assert.equal(typeof result, 'string');
	return result as string;
}

async function waitFor(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 1000;
	while (!predicate()) {
		if (Date.now() > deadline) {
			throw new Error('Timed out waiting for bridge event.');
		}
		await new Promise(resolve => setTimeout(resolve, 5));
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { OutcomeUnknownError, ShortestPathOjLocalBridge } from '../shortestpathOjLocalBridge';
import type { Memento } from 'vscode';
import { parseIncomingEvent, parseProblemBindData } from '../shortestpathOjProtocol';
import { bindPayload } from './fixtures';
import { hasProblemStatementChanged } from '../problemStatementVersion';
import { sanitizeSubmissionHistoryEntry } from '../submissionHistory';
import { validatePublicProblemContent } from '../publicProblemValidation';
import { AuxiliaryOperationRecovery } from '../auxiliaryOperationRecovery';

const v2 = { ...bindPayload, problem: { ...bindPayload.problem, target: { kind: 'training', problemId: '1', problemRef: bindPayload.problem.ref }, accountId: '1', publicContent: { title: 'A' }, localTest: { enabled: true, reason: '' } } };

test('v2 hello, binding, renewed sessions and handshake Origin are validated by the real bridge', async () => {
	const bridge = new ShortestPathOjLocalBridge({ importProblem: async () => 'created', activateProblem: async () => {}, updateProblemState: async () => {}, handleEvent() {}, handleDisconnect() {} }, 0);
	const socket = new WebSocket(`ws://127.0.0.1:${await bridge.listeningPort()}/shortestpath-oj`, ['shortestpath-oj-v2', 'shortestpath-oj-v1'], { origin: 'https://shortestpath.cn' });
	await new Promise<void>(resolve => socket.once('open', resolve));
	const send = (type: string, data: unknown) => new Promise<any>(resolve => {
		const id = randomUUID(); const listener = (raw: Buffer) => { const message = JSON.parse(raw.toString()); if (message.replyTo === id) { socket.off('message', listener); resolve(message); } };
		socket.on('message', listener); socket.send(JSON.stringify({ version: 2, kind: 'request', id, type, data }));
	});
	try {
		assert.equal(socket.protocol, 'shortestpath-oj-v2');
		const hello = await send('bridge.hello', {}); assert.equal(hello.ok, true); assert.equal(hello.sessionId, undefined); assert.equal(hello.data.protocolMajor, 2);
		const first = await send('problem.bind', v2); assert.equal(first.ok, true);
		const second = await send('problem.bind', v2); assert.equal(second.ok, true); assert.notEqual(second.sessionId, first.sessionId);
		const wrongOrigin = await send('problem.bind', { ...v2, problem: { ...v2.problem, url: 'https://example.com/problem/DSU/found/A' } }); assert.equal(wrongOrigin.ok, false);
	} finally { socket.terminate(); await bridge.close(); }
});

test('v2 isolates contest/standalone identity and validates every rendered public module', () => {
	const contest = { ...v2, problem: { ...v2.problem, ref: 'contest/e2e/A', url: 'https://shortestpath.cn/contests/e2e/problems/A', target: { kind: 'contest', problemId: '1', contestId: '2', contestRef: 'e2e', contestProblemId: '3', problemLabel: 'A' } } };
	assert.equal(parseProblemBindData(contest, 2).target?.kind, 'contest');
	assert.throws(() => parseProblemBindData({ ...contest, problem: { ...contest.problem, ref: 'contest/e2e/B' } }, 2));
	assert.throws(() => validatePublicProblemContent({ interaction: { schema_version: 1 } }));
	assert.throws(() => validatePublicProblemContent({ judge_runtime: { components: [] } }));
	assert.throws(() => validatePublicProblemContent({ local_judging: { schema_version: 999, kind: 'grader', files: [] } }));
	const problem = parseProblemBindData(v2, 2);
	assert.equal(hasProblemStatementChanged(problem, { ...problem, publicContent: { ...problem.publicContent, capabilities: { can_submit: false } } as unknown as NonNullable<typeof problem.publicContent> }), false);
});

test('v2 retains OI details, hidden null-time results and empty-input diagnostic counterexamples', () => {
	const snapshot = { submissionId: '1', language: 'cpp20', status: 'hidden', score: 0, maxTimeMs: 0, maxMemoryKB: 0, judgedAt: null, generation: 2, resultHidden: true, detailState: 'complete', details: [{ seq: 1, caseName: 'case1', status: 'WA', timeMs: 1, memoryKB: 1, testPoint: 'small', testPointScore: 40, outcome: 0.5 }] };
	const event = parseIncomingEvent('submission.finished', snapshot, 2);
	assert.equal(event.type, 'submission.finished');
	if (event.type === 'submission.finished') { assert.equal(event.data.details[0].outcome, 0.5); assert.equal(sanitizeSubmissionHistoryEntry(event.data)?.judgedAt, null); assert.equal(sanitizeSubmissionHistoryEntry(event.data)?.resultHidden, true); assert.equal(sanitizeSubmissionHistoryEntry(event.data)?.generation, 2); }
	assert.equal(parseIncomingEvent('stress.finished', { task: { taskId: '1', submissionId: '1', status: 'found', roundsPlanned: 1000, roundsExecuted: 1, billing: { amount: 0, currency: 'gold', refundAmount: 0 }, createdAt: 'now', finishedAt: 'now', counterExample: { input: '', expected: '', actual: 'wrong' }, counterExampleTruncated: true, interactionTrace: 'trace' } }, 2).type, 'stress.finished');
});

test('paid auxiliary retry persists the original key across restart and resolves a committed receipt without another start', async () => {
	const values = new Map<string, unknown>();
	const store: Memento = { get: <T>(key: string, fallback?: T): T => (values.get(key) ?? fallback) as T, update: async (key: string, value: unknown) => { values.set(key, value); }, keys: () => [...values.keys()] };
	let sentKey = ''; let starts = 0;
	const bridge = { requestAuxiliary: async (_ref: string, type: string, data: Record<string, unknown>) => {
		if (type === 'correction.start.request') { starts++; sentKey = String(data.operationId); throw new OutcomeUnknownError(); }
		if (type === 'operation.status.request') { assert.equal(data.operationId, sentKey); return { state: 'applied', resource_id: 9 }; }
		if (type === 'correction.get.request') { return { task: { task_id: 9 } }; }
		return { state: 'watching' };
	} } as unknown as ShortestPathOjLocalBridge;
	const problem = parseProblemBindData(v2, 2);
	await assert.rejects(new AuxiliaryOperationRecovery(store).start(bridge, problem, 'correction', '1', { acknowledgedCost: true }), OutcomeUnknownError);
	const result = await new AuxiliaryOperationRecovery(store).start(bridge, problem, 'correction', '1', { acknowledgedCost: true });
	assert.deepEqual(result, { task: { task_id: 9 } }); assert.equal(starts, 1);
	await assert.rejects(new AuxiliaryOperationRecovery(store).start(bridge, { ...problem, url: problem.url.replace('shortestpath.cn', 'www.shortestpath.cn') }, 'correction', '1', { acknowledgedCost: true }), OutcomeUnknownError);
	assert.equal(starts, 2);
	await assert.rejects(new AuxiliaryOperationRecovery(store).start(bridge, { ...problem, target: { kind: 'training', problemId: '2', problemRef: problem.ref } }, 'correction', '1', { acknowledgedCost: true }), OutcomeUnknownError);
	assert.equal(starts, 3);
});

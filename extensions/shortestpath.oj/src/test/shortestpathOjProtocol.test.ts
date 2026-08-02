/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	applyEditorialLikeResult,
	applyEditorialLockRemaining,
	applyHintLockRemaining,
	applyLikeResult,
	parseHintAnswerResult,
	parseIncomingEvent,
	parseMessage,
	parseProblemBindData,
	parseProblemStateSyncData,
	ProtocolValidationError,
} from '../shortestpathOjProtocol';
import { bindPayload, statePayload } from './fixtures';

test('parses the official problem.bind data model', () => {
	const problem = parseProblemBindData(bindPayload);
	assert.deepStrictEqual(
		{
			ref: problem.ref,
			title: problem.title,
		statement: problem.statement.description?.content,
		sampleExplanation: problem.samples[0].explanation,
			timerMode: problem.state.timer.mode,
			hintQuestion: problem.state.hints[0].question?.content,
			language: problem.capabilities.submission.languages[0],
			stressRounds: problem.capabilities.stress.defaultRounds,
		},
		{
			ref: 'DSU/found/A',
			title: '并查集入门',
		statement: '# 题目\n\n求答案。',
		sampleExplanation: '这个样例的答案是 `1`。',
			timerMode: 'timed',
			hintQuestion: '维护什么？',
			language: { id: 'cpp20', name: 'cpp20', compileArgs: 'g++ -std=gnu++20' },
			stressRounds: 120,
		},
	);
});

test('allows accepted and running to be independent and applies final like counts', () => {
	const state = parseProblemStateSyncData({
		state: {
			...statePayload,
			timer: { ...statePayload.timer, running: false, accepted: false },
		},
	});
	const problem = applyLikeResult(parseProblemBindData(bindPayload), {
		hintId: '123',
		target: 'answer',
		liked: true,
		questionLiked: false,
		answerLiked: true,
		questionLikeCount: 4,
		answerLikeCount: 2,
	});
	assert.deepStrictEqual(
		{ running: state.timer.running, accepted: state.timer.accepted, likes: problem.state.hints[0].likes },
		{
			running: false,
			accepted: false,
			likes: {
				question: { liked: false, count: 4 },
				answer: { liked: true, count: 2 },
			},
		},
	);
});

test('uses wait times returned by the website for hints and editorials', () => {
	const problem = parseProblemBindData(bindPayload);
	const withHintWait = applyHintLockRemaining(problem, '123', 45_000);
	const withEditorialWait = applyEditorialLockRemaining(withHintWait, 90_000);
	assert.deepStrictEqual(
		{
			hint: withEditorialWait.state.hints[0],
			editorial: withEditorialWait.state.editorial,
		},
		{
			hint: { ...problem.state.hints[0], unlocked: false, remainingMs: 45_000 },
			editorial: { ...problem.state.editorial, remainingMs: 90_000 },
		},
	);
});

test('applies final like counts to an available editorial', () => {
	const editorial = applyEditorialLikeResult({
		state: 'available',
		hints: [{
			hintId: '123',
			seq: 1,
			question: { format: 'markdown', content: '问题' },
			answer: { format: 'markdown', content: '答案' },
			questionLiked: false,
			answerLiked: false,
			questionLikeCount: 3,
			answerLikeCount: 1,
		}],
		simpleContent: { format: 'markdown', content: '简化题解' },
		content: { format: 'markdown', content: '详细题解' },
		solutionCode: 'int main() {}',
	}, {
		hintId: '123',
		target: 'answer',
		liked: true,
		questionLiked: false,
		answerLiked: true,
		questionLikeCount: 4,
		answerLikeCount: 2,
	});
	assert.deepStrictEqual(editorial, {
		state: 'available',
		hints: [{
			hintId: '123',
			seq: 1,
			question: { format: 'markdown', content: '问题' },
			answer: { format: 'markdown', content: '答案' },
			questionLiked: false,
			answerLiked: true,
			questionLikeCount: 4,
			answerLikeCount: 2,
		}],
		simpleContent: { format: 'markdown', content: '简化题解' },
		content: { format: 'markdown', content: '详细题解' },
		solutionCode: 'int main() {}',
	});
});

test('strictly validates response envelopes', () => {
	assert.throws(
		() => parseMessage({
			version: 1,
			id: 'response',
			replyTo: 'request',
			type: 'hint.answer.result',
			sessionId: 'session',
			ok: 'yes',
		}),
		(error: unknown) => error instanceof ProtocolValidationError && error.code === 'invalid_message',
	);
	assert.throws(
		() => parseMessage({ version: 2, id: 'request', type: 'problem.bind', data: bindPayload }),
		(error: unknown) => error instanceof ProtocolValidationError && error.code === 'unsupported_version',
	);
});

test('parses complete submission snapshots and preserves open status strings', () => {
	const event = parseIncomingEvent('submission.finished', {
		submissionId: '456',
		language: 'cpp20',
		status: 'FUTURE_STATUS',
		score: 20,
		maxTimeMs: 18,
		maxMemoryKB: 6144,
		createdAt: '2026-07-29T12:34:50Z',
		judgedAt: '2026-07-29T12:34:56Z',
		detailState: 'complete',
		details: [{
			seq: 3,
			caseName: 'case-03',
			status: 'WA',
			timeMs: 18,
			memoryKB: 6144,
			diagnosticCode: 'wrong_answer',
		}],
	});
	assert.deepStrictEqual(
		event.type === 'submission.finished'
			? { status: event.data.status, detailState: event.data.detailState, detail: event.data.details[0] }
			: undefined,
		{
			status: 'FUTURE_STATUS',
			detailState: 'complete',
			detail: {
				seq: 3,
				caseName: 'case-03',
				status: 'WA',
				timeMs: 18,
				memoryKB: 6144,
				diagnosticCode: 'wrong_answer',
				message: undefined,
				checkerOutput: undefined,
				exitCode: undefined,
				stderrExcerpt: undefined,
			},
		},
	);
});

test('accepts unavailable final details and open-required hint answers', () => {
	const event = parseIncomingEvent('submission.finished', {
		submissionId: '456',
		language: 'cpp20',
		status: 'WA',
		score: 0,
		maxTimeMs: 18,
		maxMemoryKB: 6144,
		judgedAt: '2026-07-29T12:34:56Z',
		detailState: 'unavailable',
		detailError: {
			source: 'website',
			code: 'details_unavailable',
			message: '详情暂不可用。',
		},
	});
	assert.deepStrictEqual(
		{
			submission: event.type === 'submission.finished' ? { detailState: event.data.detailState, details: event.data.details } : undefined,
			hint: parseHintAnswerResult({ state: 'open_required', hintId: '123' }),
		},
		{
			submission: { detailState: 'unavailable', details: [] },
			hint: { state: 'open_required', hintId: '123', remainingMs: 0, unlockAt: undefined },
		},
	);
});

test('rejects unsupported problem URLs and duplicate hint ids', () => {
	assert.throws(() => parseProblemBindData({
		...bindPayload,
		problem: { ...bindPayload.problem, url: 'https://www.shortestpath.cn/problem/DSU/found/A' },
	}), /problem\.url/);
	assert.throws(() => parseProblemBindData({
		...bindPayload,
		state: { ...statePayload, hints: [statePayload.hints[0], statePayload.hints[0]] },
	}), /不能重复/);
	assert.throws(() => parseProblemBindData({
		...bindPayload,
		problem: { ...bindPayload.problem, ref: '__proto__' },
	}), /三段规范路径/);
	assert.throws(() => parseProblemBindData({
		...bindPayload,
		problem: { ...bindPayload.problem, ref: 'Other/found/A' },
	}), /必须与 problem\.url/);
});

test('rejects inconsistent terminal submission and stress snapshots', () => {
	const baseFinished = {
		submissionId: '456',
		language: 'cpp20',
		status: 'WA',
		score: 0,
		maxTimeMs: 18,
		maxMemoryKB: 6144,
		judgedAt: '2026-07-29T12:34:56Z',
		detailState: 'complete',
		details: [],
	};
	assert.throws(() => parseIncomingEvent('submission.finished', {
		...baseFinished,
		judgedAt: null,
	}), /judgedAt/);
	assert.throws(() => parseIncomingEvent('submission.finished', {
		...baseFinished,
		detailState: 'unavailable',
	}), /detailError/);
	assert.throws(() => parseIncomingEvent('stress.finished', {
		task: {
			taskId: '78',
			submissionId: '456',
			status: 'found',
			roundsPlanned: 10,
			roundsExecuted: 11,
			billing: { amount: 0, currency: 'free', refundAmount: 0 },
			createdAt: '2026-07-29T12:31:00Z',
		},
	}), /roundsExecuted/);
});

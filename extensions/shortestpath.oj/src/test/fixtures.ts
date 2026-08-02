/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const statePayload = {
	timer: {
		mode: 'timed',
		running: true,
		accepted: false,
		elapsedMs: 125_000,
		capturedAtUnixMs: 1_785_320_000_000,
	},
	progress: { status: 'opened', bestScore: 0, submitCount: 1 },
	hints: [{
		id: '123',
		seq: 1,
		unlocked: true,
		viewed: false,
		remainingMs: 0,
		question: { format: 'markdown', content: '维护什么？' },
		likes: {
			question: { liked: false, count: 3 },
			answer: { liked: false, count: 1 },
		},
	}],
	editorial: {
		remainingMs: 0,
		preAcViewed: false,
		requiresConfirmation: true,
		confirmationMessage: '确认查看吗？',
	},
};

export const bindPayload = {
	problem: {
		ref: 'DSU/found/A',
		title: '并查集入门',
		url: 'https://shortestpath.cn/problem/DSU/found/A',
		topic: { slug: 'DSU', title: '并查集' },
		flags: { isTemplate: false, isExample: false },
		statement: {
			description: { format: 'markdown', content: '# 题目\n\n求答案。' },
			inputFormat: { format: 'markdown', content: '输入。' },
			outputFormat: { format: 'markdown', content: '输出。' },
			constraints: { format: 'markdown', content: '$n \\le 10$' },
		},
		samples: [{ input: '1\n', output: '1\n', explanation: '这个样例的答案是 `1`。' }],
		limits: { timeMs: 1000, memoryMB: 256 },
		judge: { mode: 'acm', checkerType: 'default', floatEpsilon: null },
		metadata: { difficulty: 2, coreAlgorithm: '并查集', auxiliaryAlgorithms: ['路径压缩'] },
	},
	state: statePayload,
	capabilities: {
		hintAnswer: true,
		hintLike: true,
		editorial: true,
		submission: {
			enabled: true,
			progressPush: true,
			progressMode: 'websocket_snapshot',
			compileErrorPush: true,
			compileInfo: 'args_stage_terminal_error',
			finalResultPush: true,
			watchExisting: true,
			languages: [{ id: 'cpp20', name: 'cpp20', compileArgs: 'g++ -std=gnu++20' }],
		},
		stress: {
			supported: true,
			mode: 'problem',
			contextRequired: true,
			defaultRounds: 120,
			progressPush: true,
			progressMode: 'polling_snapshot',
			roundProgress: 'terminal_only',
			nominalPollIntervalMs: 3000,
			finalResultPush: true,
		},
	},
};

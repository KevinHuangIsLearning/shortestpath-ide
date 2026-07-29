/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const bridgePort = 21474;
export const bridgePath = '/shortestpath-oj';
export const bridgeProtocol = 'shortestpath-oj-v1';
export const protocolVersion = 1;

const shortestPathProblemUrl = /^https:\/\/shortestpath\.cn\/problem\/[^/?#]+\/[^/?#]+\/[^/?#]+$/;
const problemRefPattern = /^[^/?#]+\/[^/?#]+\/[^/?#]+$/;

export type MarkdownContent = {
	format: 'markdown';
	content: string;
};

export type ProblemState = {
	timer: {
		mode: 'timed' | 'untimed';
		running: boolean;
		accepted: boolean;
		elapsedMs: number;
		capturedAtUnixMs: number;
	};
	progress: {
		status: string;
		bestScore: number;
		submitCount: number;
	};
	hints: ProblemHint[];
	editorial: {
		remainingMs: number;
		preAcViewed: boolean;
		requiresConfirmation: boolean;
		confirmationMessage: string;
	};
};

export type HintLikes = {
	question: { liked: boolean; count: number };
	answer: { liked: boolean; count: number };
};

export type ProblemHint = {
	id: string;
	seq: number;
	unlocked: boolean;
	viewed: boolean;
	remainingMs: number;
	question?: MarkdownContent;
	likes: HintLikes;
};

export type SubmissionLanguage = {
	id: string;
	name: string;
	compileArgs: string;
};

export type ProblemCapabilities = {
	hintAnswer: boolean;
	hintLike: boolean;
	editorial: boolean;
	submission: {
		enabled: boolean;
		progressPush: boolean;
		progressMode: string;
		compileErrorPush: boolean;
		compileInfo: string;
		finalResultPush: boolean;
		watchExisting: boolean;
		languages: SubmissionLanguage[];
	};
	stress: {
		supported: boolean;
		mode: string;
		contextRequired: boolean;
		defaultRounds: number;
		progressPush: boolean;
		progressMode: string;
		roundProgress: string;
		nominalPollIntervalMs: number;
		finalResultPush: boolean;
	};
};

export type ImportedProblem = {
	ref: string;
	title: string;
	url: string;
	topic: { slug: string; title: string };
	flags: { isTemplate: boolean; isExample: boolean };
	statement: {
		description?: MarkdownContent;
		inputFormat?: MarkdownContent;
		outputFormat?: MarkdownContent;
		constraints?: MarkdownContent;
	};
	samples: Array<{ input: string; output: string; explanation: string }>;
	limits: { timeMs: number; memoryMB: number };
	judge: {
		mode: 'acm' | 'oi';
		checkerType: string;
		floatEpsilon: number | null;
	};
	metadata: {
		difficulty: number;
		coreAlgorithm: string;
		auxiliaryAlgorithms: string[];
	};
	state: ProblemState;
	capabilities: ProblemCapabilities;
};

export type WebsiteError = {
	source: 'protocol' | 'website';
	code: string;
	message: string;
	retryAfterSeconds?: number;
	fieldErrors?: Record<string, string>;
};

export type ProtocolRequest = {
	version: 1;
	id: string;
	type: string;
	sessionId?: string;
	data: unknown;
};

export type ProtocolResponse = {
	version: 1;
	id: string;
	replyTo: string;
	type: string;
	sessionId?: string;
	ok: boolean;
	data?: unknown;
	error?: WebsiteError;
};

export type HintAnswerResult =
	| { state: 'locked' | 'open_required'; hintId: string; remainingMs: number; unlockAt?: string }
	| { state: 'revealed'; hintId: string; answer: MarkdownContent; viewedAtUnixMs: number; likes: HintLikes };

export type LikeResult = {
	hintId: string;
	target: 'question' | 'answer';
	liked: boolean;
	questionLiked: boolean;
	answerLiked: boolean;
	questionLikeCount: number;
	answerLikeCount: number;
};

export type EditorialResult =
	| { state: 'locked'; remainingMs: number; unlockReason: string; unlockAt?: string }
	| {
		state: 'available';
		hints: Array<{
			hintId: string;
			seq: number;
			question: MarkdownContent;
			answer: MarkdownContent;
			questionLiked: boolean;
			answerLiked: boolean;
			questionLikeCount: number;
			answerLikeCount: number;
		}>;
		simpleContent: MarkdownContent;
		content: MarkdownContent;
		solutionCode: string;
		updatedAt?: string;
	};

export type SubmissionResult = {
	state: 'submitted';
	submissionId: string;
	language: string;
	status: string;
	message: string;
};

export type SubmissionWatchResult = {
	submissionId: string;
	state: 'watching' | 'finished';
	language: string;
	status: string;
};

export type SubmissionDetail = {
	seq: number;
	caseName: string;
	status: string;
	timeMs: number;
	memoryKB: number;
	message?: string;
	diagnosticCode?: string;
	checkerOutput?: string;
	exitCode?: number;
	stderrExcerpt?: string;
};

export type SubmissionSnapshot = {
	submissionId: string;
	language: string;
	status: string;
	stage?: string;
	score: number;
	maxTimeMs: number;
	maxMemoryKB: number;
	judgedAt: string | null;
	createdAt?: string;
	detailState?: 'complete' | 'unavailable';
	compileErrorMessage?: string;
	detailError?: WebsiteError;
	details: SubmissionDetail[];
	userStatus?: {
		status: string;
		bestScore: number;
		submitCount: number;
		hintsViewed: number;
	};
};

export type StressTask = {
	taskId: string;
	submissionId: string;
	status: string;
	roundsPlanned: number;
	roundsExecuted: number;
	billing: { amount: number; currency: string; refundAmount: number };
	createdAt: string;
	finishedAt?: string;
	counterExample?: { input: string; expected: string; actual: string };
	errorMessage?: string;
};

export type StressContext = {
	availability: {
		state: 'ready' | 'not_configured';
		message: string;
		requiredAction: string;
		missing: string[];
	};
	defaultRounds: number;
	billingDescription: string;
	eligibleSubmissions: Array<{
		submissionId: string;
		status: string;
		score: number;
		language: string;
		createdAt: string;
	}>;
	tasks: StressTask[];
};

export type StressStartResult = {
	state: 'accepted';
	task: StressTask;
	billingDescription: string;
};

export type IncomingEvent =
	| { type: 'submission.progress'; data: SubmissionSnapshot }
	| { type: 'submission.finished'; data: SubmissionSnapshot }
	| { type: 'stress.progress'; data: { task: StressTask } }
	| { type: 'stress.finished'; data: { task: StressTask } };

export function problemKey(problem: Pick<ImportedProblem, 'ref'> | string): string {
	return typeof problem === 'string' ? problem : problem.ref;
}

export function parseMessage(value: unknown): ProtocolRequest | ProtocolResponse {
	const message = record(value, '消息必须是 JSON 对象。');
	if (message.version !== protocolVersion) {
		throw new ProtocolValidationError('unsupported_version', '不支持的协议版本。');
	}
	const id = nonEmptyString(message.id, 'id');
	const type = nonEmptyString(message.type, 'type');
	const sessionId = optionalNonEmptyString(message.sessionId, 'sessionId');
	if (message.replyTo !== undefined) {
		const replyTo = nonEmptyString(message.replyTo, 'replyTo');
		if (typeof message.ok !== 'boolean') {
			throw new ProtocolValidationError('invalid_message', 'ok 必须是布尔值。');
		}
		const error = message.error === undefined ? undefined : parseWebsiteError(message.error);
		if (message.ok && error !== undefined) {
			throw new ProtocolValidationError('invalid_message', '成功响应不能包含 error。');
		}
		if (!message.ok && error === undefined) {
			throw new ProtocolValidationError('invalid_message', '失败响应必须包含 error。');
		}
		return { version: 1, id, replyTo, type, sessionId, ok: message.ok, data: message.data, error };
	}
	if (message.ok !== undefined) {
		throw new ProtocolValidationError('invalid_message', '请求或事件不能包含 ok。');
	}
	return { version: 1, id, type, sessionId, data: message.data };
}

export function parseProblemBindData(value: unknown): ImportedProblem {
	const data = record(value, 'problem.bind.data 无效。');
	const problem = parseProblem(data.problem);
	return {
		...problem,
		state: parseProblemState(data.state),
		capabilities: parseCapabilities(data.capabilities),
	};
}

export function parseProblemStateSyncData(value: unknown): ProblemState {
	return parseProblemState(record(value, 'problem.state.sync.data 无效。').state);
}

export function parseHintAnswerResult(value: unknown): HintAnswerResult {
	const data = record(value, '提示答案响应无效。');
	const state = oneOf(data.state, ['locked', 'open_required', 'revealed'] as const, 'state');
	const hintId = nonEmptyString(data.hintId, 'hintId');
	if (state !== 'revealed') {
		return {
			state,
			hintId,
			remainingMs: data.remainingMs === undefined && state === 'open_required' ? 0 : nonNegativeNumber(data.remainingMs, 'remainingMs'),
			unlockAt: optionalString(data.unlockAt, 'unlockAt'),
		};
	}
	return {
		state,
		hintId,
		answer: markdown(data.answer, 'answer'),
		viewedAtUnixMs: nonNegativeNumber(data.viewedAtUnixMs, 'viewedAtUnixMs'),
		likes: parseLikes(data.likes, 'likes'),
	};
}

export function parseLikeResult(value: unknown): LikeResult {
	const data = record(value, '点赞响应无效。');
	return {
		hintId: nonEmptyString(data.hintId, 'hintId'),
		target: oneOf(data.target, ['question', 'answer'] as const, 'target'),
		liked: booleanValue(data.liked, 'liked'),
		questionLiked: booleanValue(data.questionLiked, 'questionLiked'),
		answerLiked: booleanValue(data.answerLiked, 'answerLiked'),
		questionLikeCount: nonNegativeInteger(data.questionLikeCount, 'questionLikeCount'),
		answerLikeCount: nonNegativeInteger(data.answerLikeCount, 'answerLikeCount'),
	};
}

export function parseEditorialResult(value: unknown): EditorialResult {
	const data = record(value, '解题报告响应无效。');
	const state = oneOf(data.state, ['locked', 'available'] as const, 'state');
	if (state === 'locked') {
		return {
			state,
			remainingMs: nonNegativeNumber(data.remainingMs, 'remainingMs'),
			unlockReason: stringValue(data.unlockReason, 'unlockReason'),
			unlockAt: optionalString(data.unlockAt, 'unlockAt'),
		};
	}
	return {
		state,
		hints: array(data.hints, 'hints').map((value, index) => {
			const hint = record(value, `hints[${index}]`);
			return {
				hintId: nonEmptyString(hint.hintId, `hints[${index}].hintId`),
				seq: nonNegativeInteger(hint.seq, `hints[${index}].seq`),
				question: markdown(hint.question, `hints[${index}].question`),
				answer: markdown(hint.answer, `hints[${index}].answer`),
				questionLiked: booleanValue(hint.questionLiked, `hints[${index}].questionLiked`),
				answerLiked: booleanValue(hint.answerLiked, `hints[${index}].answerLiked`),
				questionLikeCount: nonNegativeInteger(hint.questionLikeCount, `hints[${index}].questionLikeCount`),
				answerLikeCount: nonNegativeInteger(hint.answerLikeCount, `hints[${index}].answerLikeCount`),
			};
		}),
		simpleContent: markdown(data.simpleContent, 'simpleContent'),
		content: markdown(data.content, 'content'),
		solutionCode: stringValue(data.solutionCode, 'solutionCode'),
		updatedAt: optionalString(data.updatedAt, 'updatedAt'),
	};
}

export function parseSubmissionResult(value: unknown): SubmissionResult {
	const data = record(value, '提交响应无效。');
	return {
		state: oneOf(data.state, ['submitted'] as const, 'state'),
		submissionId: decimalString(data.submissionId, 'submissionId'),
		language: nonEmptyString(data.language, 'language'),
		status: nonEmptyString(data.status, 'status'),
		message: nonEmptyString(data.message, 'message'),
	};
}

export function parseSubmissionWatchResult(value: unknown): SubmissionWatchResult {
	const data = record(value, '观察提交响应无效。');
	return {
		submissionId: decimalString(data.submissionId, 'submissionId'),
		state: oneOf(data.state, ['watching', 'finished'] as const, 'state'),
		language: nonEmptyString(data.language, 'language'),
		status: nonEmptyString(data.status, 'status'),
	};
}

export function parseStressContext(value: unknown): StressContext {
	const data = record(value, '对拍上下文响应无效。');
	const availability = record(data.availability, 'availability');
	return {
		availability: {
			state: oneOf(availability.state, ['ready', 'not_configured'] as const, 'availability.state'),
			message: stringValue(availability.message, 'availability.message'),
			requiredAction: stringValue(availability.requiredAction, 'availability.requiredAction'),
			missing: stringArray(availability.missing, 'availability.missing'),
		},
		defaultRounds: positiveInteger(data.defaultRounds, 'defaultRounds'),
		billingDescription: stringValue(data.billingDescription, 'billingDescription'),
		eligibleSubmissions: array(data.eligibleSubmissions, 'eligibleSubmissions').map((value, index) => {
			const submission = record(value, `eligibleSubmissions[${index}]`);
			return {
				submissionId: decimalString(submission.submissionId, `eligibleSubmissions[${index}].submissionId`),
				status: nonEmptyString(submission.status, `eligibleSubmissions[${index}].status`),
				score: nonNegativeNumber(submission.score, `eligibleSubmissions[${index}].score`),
				language: nonEmptyString(submission.language, `eligibleSubmissions[${index}].language`),
				createdAt: nonEmptyString(submission.createdAt, `eligibleSubmissions[${index}].createdAt`),
			};
		}),
		tasks: array(data.tasks, 'tasks').map((task, index) => parseStressTask(task, `tasks[${index}]`)),
	};
}

export function parseStressStartResult(value: unknown): StressStartResult {
	const data = record(value, '启动对拍响应无效。');
	return {
		state: oneOf(data.state, ['accepted'] as const, 'state'),
		task: parseStressTask(data.task, 'task'),
		billingDescription: stringValue(data.billingDescription, 'billingDescription'),
	};
}

export function parseIncomingEvent(type: string, value: unknown): IncomingEvent {
	const data = record(value, `${type}.data 无效。`);
	switch (type) {
		case 'submission.progress':
			return { type, data: parseSubmissionSnapshot(data, false) };
		case 'submission.finished':
			return { type, data: parseSubmissionSnapshot(data, true) };
		case 'stress.progress': {
			const task = parseStressTask(data.task, 'task');
			if (task.status !== 'queued' && task.status !== 'running') {
				throw new ProtocolValidationError('invalid_request', 'stress.progress 必须携带活动任务。');
			}
			return { type, data: { task } };
		}
		case 'stress.finished': {
			const task = parseStressTask(data.task, 'task');
			if (!['found', 'not_found', 'error', 'timeout'].includes(task.status)) {
				throw new ProtocolValidationError('invalid_request', 'stress.finished 必须携带终态任务。');
			}
			return { type, data: { task } };
		}
		default:
			throw new ProtocolValidationError('unsupported_type', `不支持的事件类型：${type}`);
	}
}

export function applyProblemState(problem: ImportedProblem, state: ProblemState): ImportedProblem {
	return { ...problem, state };
}

export function applyLikeResult(problem: ImportedProblem, result: LikeResult): ImportedProblem {
	return {
		...problem,
		state: {
			...problem.state,
			hints: problem.state.hints.map(hint => hint.id === result.hintId ? {
				...hint,
				likes: {
					question: { liked: result.questionLiked, count: result.questionLikeCount },
					answer: { liked: result.answerLiked, count: result.answerLikeCount },
				},
			} : hint),
		},
	};
}

export function findProblemRefForSourcePath(sourcePaths: Readonly<Record<string, string>>, sourcePath: string): string | undefined {
	return Object.keys(sourcePaths).find(ref => sourcePaths[ref] === sourcePath);
}

export class ProtocolValidationError extends Error {
	constructor(
		readonly code: 'invalid_message' | 'invalid_request' | 'unsupported_version' | 'unsupported_type',
		message: string,
	) {
		super(message);
	}
}

function parseProblem(value: unknown): Omit<ImportedProblem, 'state' | 'capabilities'> {
	const problem = record(value, 'problem 无效。');
	const url = nonEmptyString(problem.url, 'problem.url');
	if (!shortestPathProblemUrl.test(url)) {
		throw new ProtocolValidationError('invalid_request', 'problem.url 不是支持的普通训练题地址。');
	}
	const topic = record(problem.topic, 'problem.topic');
	const flags = record(problem.flags, 'problem.flags');
	const statement = record(problem.statement, 'problem.statement');
	const limits = record(problem.limits, 'problem.limits');
	const judge = record(problem.judge, 'problem.judge');
	const metadata = record(problem.metadata, 'problem.metadata');
	const samples = array(problem.samples, 'problem.samples').map((value, index) => {
		const sample = record(value, `problem.samples[${index}]`);
		return {
			input: stringValue(sample.input, `problem.samples[${index}].input`),
			output: stringValue(sample.output, `problem.samples[${index}].output`),
			explanation: optionalString(sample.explanation, `problem.samples[${index}].explanation`) ?? '',
		};
	});
	const ref = nonEmptyString(problem.ref, 'problem.ref');
	if (!problemRefPattern.test(ref)) {
		throw new ProtocolValidationError('invalid_request', 'problem.ref 必须是 topic/group/code 三段规范路径。');
	}
	const topicSlug = nonEmptyString(topic.slug, 'problem.topic.slug');
	const urlSegments = problemRefSegmentsFromUrl(url);
	const refSegments = ref.split('/');
	if (urlSegments.join('/') !== ref || refSegments[0] !== topicSlug) {
		throw new ProtocolValidationError('invalid_request', 'problem.ref 必须与 problem.url 和 problem.topic.slug 一致。');
	}
	return {
		ref,
		title: nonEmptyString(problem.title, 'problem.title'),
		url,
		topic: {
			slug: topicSlug,
			title: nonEmptyString(topic.title, 'problem.topic.title'),
		},
		flags: {
			isTemplate: booleanValue(flags.isTemplate, 'problem.flags.isTemplate'),
			isExample: booleanValue(flags.isExample, 'problem.flags.isExample'),
		},
		statement: {
			description: optionalMarkdown(statement.description, 'problem.statement.description'),
			inputFormat: optionalMarkdown(statement.inputFormat, 'problem.statement.inputFormat'),
			outputFormat: optionalMarkdown(statement.outputFormat, 'problem.statement.outputFormat'),
			constraints: optionalMarkdown(statement.constraints, 'problem.statement.constraints'),
		},
		samples,
		limits: {
			timeMs: nonNegativeNumber(limits.timeMs, 'problem.limits.timeMs'),
			memoryMB: nonNegativeNumber(limits.memoryMB, 'problem.limits.memoryMB'),
		},
		judge: {
			mode: oneOf(judge.mode, ['acm', 'oi'] as const, 'problem.judge.mode'),
			checkerType: nonEmptyString(judge.checkerType, 'problem.judge.checkerType'),
			floatEpsilon: judge.floatEpsilon === null ? null : nonNegativeNumber(judge.floatEpsilon, 'problem.judge.floatEpsilon'),
		},
		metadata: {
			difficulty: nonNegativeNumber(metadata.difficulty, 'problem.metadata.difficulty'),
			coreAlgorithm: stringValue(metadata.coreAlgorithm, 'problem.metadata.coreAlgorithm'),
			auxiliaryAlgorithms: stringArray(metadata.auxiliaryAlgorithms, 'problem.metadata.auxiliaryAlgorithms'),
		},
	};
}

function parseProblemState(value: unknown): ProblemState {
	const state = record(value, 'state 无效。');
	const timer = record(state.timer, 'state.timer');
	const progress = record(state.progress, 'state.progress');
	const editorial = record(state.editorial, 'state.editorial');
	const hints = array(state.hints, 'state.hints').map((value, index) => {
		const hint = record(value, `state.hints[${index}]`);
		return {
			id: nonEmptyString(hint.id, `state.hints[${index}].id`),
			seq: nonNegativeInteger(hint.seq, `state.hints[${index}].seq`),
			unlocked: booleanValue(hint.unlocked, `state.hints[${index}].unlocked`),
			viewed: booleanValue(hint.viewed, `state.hints[${index}].viewed`),
			remainingMs: nonNegativeNumber(hint.remainingMs, `state.hints[${index}].remainingMs`),
			question: optionalMarkdown(hint.question, `state.hints[${index}].question`),
			likes: parseLikes(hint.likes, `state.hints[${index}].likes`),
		};
	});
	assertUnique(hints.map(hint => hint.id), 'state.hints[].id');
	return {
		timer: {
			mode: oneOf(timer.mode, ['timed', 'untimed'] as const, 'state.timer.mode'),
			running: booleanValue(timer.running, 'state.timer.running'),
			accepted: booleanValue(timer.accepted, 'state.timer.accepted'),
			elapsedMs: nonNegativeNumber(timer.elapsedMs, 'state.timer.elapsedMs'),
			capturedAtUnixMs: nonNegativeNumber(timer.capturedAtUnixMs, 'state.timer.capturedAtUnixMs'),
		},
		progress: {
			status: nonEmptyString(progress.status, 'state.progress.status'),
			bestScore: nonNegativeNumber(progress.bestScore, 'state.progress.bestScore'),
			submitCount: nonNegativeInteger(progress.submitCount, 'state.progress.submitCount'),
		},
		hints,
		editorial: {
			remainingMs: nonNegativeNumber(editorial.remainingMs, 'state.editorial.remainingMs'),
			preAcViewed: booleanValue(editorial.preAcViewed, 'state.editorial.preAcViewed'),
			requiresConfirmation: booleanValue(editorial.requiresConfirmation, 'state.editorial.requiresConfirmation'),
			confirmationMessage: stringValue(editorial.confirmationMessage, 'state.editorial.confirmationMessage'),
		},
	};
}

function problemRefSegmentsFromUrl(url: string): string[] {
	try {
		return new URL(url).pathname.split('/').slice(2).map(segment => decodeURIComponent(segment));
	} catch {
		throw new ProtocolValidationError('invalid_request', 'problem.url 包含无效路径编码。');
	}
}

function parseCapabilities(value: unknown): ProblemCapabilities {
	const capabilities = record(value, 'capabilities 无效。');
	const submission = record(capabilities.submission, 'capabilities.submission');
	const stress = record(capabilities.stress, 'capabilities.stress');
	const languages = array(submission.languages, 'capabilities.submission.languages').map((value, index) => {
		const language = record(value, `capabilities.submission.languages[${index}]`);
		return {
			id: nonEmptyString(language.id, `capabilities.submission.languages[${index}].id`),
			name: nonEmptyString(language.name, `capabilities.submission.languages[${index}].name`),
			compileArgs: stringValue(language.compileArgs, `capabilities.submission.languages[${index}].compileArgs`),
		};
	});
	assertUnique(languages.map(language => language.id), 'capabilities.submission.languages[].id');
	return {
		hintAnswer: booleanValue(capabilities.hintAnswer, 'capabilities.hintAnswer'),
		hintLike: booleanValue(capabilities.hintLike, 'capabilities.hintLike'),
		editorial: booleanValue(capabilities.editorial, 'capabilities.editorial'),
		submission: {
			enabled: booleanValue(submission.enabled, 'capabilities.submission.enabled'),
			progressPush: booleanValue(submission.progressPush, 'capabilities.submission.progressPush'),
			progressMode: nonEmptyString(submission.progressMode, 'capabilities.submission.progressMode'),
			compileErrorPush: booleanValue(submission.compileErrorPush, 'capabilities.submission.compileErrorPush'),
			compileInfo: nonEmptyString(submission.compileInfo, 'capabilities.submission.compileInfo'),
			finalResultPush: booleanValue(submission.finalResultPush, 'capabilities.submission.finalResultPush'),
			watchExisting: booleanValue(submission.watchExisting, 'capabilities.submission.watchExisting'),
			languages,
		},
		stress: {
			supported: booleanValue(stress.supported, 'capabilities.stress.supported'),
			mode: nonEmptyString(stress.mode, 'capabilities.stress.mode'),
			contextRequired: booleanValue(stress.contextRequired, 'capabilities.stress.contextRequired'),
			defaultRounds: positiveInteger(stress.defaultRounds, 'capabilities.stress.defaultRounds'),
			progressPush: booleanValue(stress.progressPush, 'capabilities.stress.progressPush'),
			progressMode: nonEmptyString(stress.progressMode, 'capabilities.stress.progressMode'),
			roundProgress: nonEmptyString(stress.roundProgress, 'capabilities.stress.roundProgress'),
			nominalPollIntervalMs: positiveInteger(stress.nominalPollIntervalMs, 'capabilities.stress.nominalPollIntervalMs'),
			finalResultPush: booleanValue(stress.finalResultPush, 'capabilities.stress.finalResultPush'),
		},
	};
}

function parseSubmissionSnapshot(value: unknown, finished: boolean): SubmissionSnapshot {
	const data = record(value, '提交快照无效。');
	const detailState = data.detailState === undefined ? undefined : oneOf(data.detailState, ['complete', 'unavailable'] as const, 'detailState');
	if (finished && detailState === undefined) {
		throw new ProtocolValidationError('invalid_request', 'submission.finished 必须包含 detailState。');
	}
	const detailError = data.detailError === undefined ? undefined : parseWebsiteError(data.detailError);
	if (finished && data.judgedAt === null) {
		throw new ProtocolValidationError('invalid_request', 'submission.finished.judgedAt 不能为 null。');
	}
	if (detailState === 'unavailable' && detailError === undefined) {
		throw new ProtocolValidationError('invalid_request', 'detailState 为 unavailable 时必须包含 detailError。');
	}
	if (detailState === 'complete' && detailError !== undefined) {
		throw new ProtocolValidationError('invalid_request', 'detailState 为 complete 时不能包含 detailError。');
	}
	const detailValues = data.details === undefined && detailState === 'unavailable' ? [] : array(data.details, 'details');
	const details = detailValues.map((value, index) => {
		const detail = record(value, `details[${index}]`);
		return {
			seq: nonNegativeInteger(detail.seq, `details[${index}].seq`),
			caseName: nonEmptyString(detail.caseName, `details[${index}].caseName`),
			status: nonEmptyString(detail.status, `details[${index}].status`),
			timeMs: nonNegativeNumber(detail.timeMs, `details[${index}].timeMs`),
			memoryKB: nonNegativeNumber(detail.memoryKB, `details[${index}].memoryKB`),
			message: optionalString(detail.message, `details[${index}].message`),
			diagnosticCode: optionalString(detail.diagnosticCode, `details[${index}].diagnosticCode`),
			checkerOutput: optionalString(detail.checkerOutput, `details[${index}].checkerOutput`),
			exitCode: optionalNumber(detail.exitCode, `details[${index}].exitCode`),
			stderrExcerpt: optionalString(detail.stderrExcerpt, `details[${index}].stderrExcerpt`),
		};
	});
	const userStatus = data.userStatus === undefined ? undefined : record(data.userStatus, 'userStatus');
	return {
		submissionId: decimalString(data.submissionId, 'submissionId'),
		language: nonEmptyString(data.language, 'language'),
		status: nonEmptyString(data.status, 'status'),
		stage: optionalString(data.stage, 'stage'),
		score: nonNegativeNumber(data.score, 'score'),
		maxTimeMs: nonNegativeNumber(data.maxTimeMs, 'maxTimeMs'),
		maxMemoryKB: nonNegativeNumber(data.maxMemoryKB, 'maxMemoryKB'),
		judgedAt: data.judgedAt === null ? null : nonEmptyString(data.judgedAt, 'judgedAt'),
		createdAt: optionalString(data.createdAt, 'createdAt'),
		detailState,
		compileErrorMessage: optionalString(data.compileErrorMessage, 'compileErrorMessage'),
		detailError,
		details,
		userStatus: userStatus ? {
			status: nonEmptyString(userStatus.status, 'userStatus.status'),
			bestScore: nonNegativeNumber(userStatus.bestScore, 'userStatus.bestScore'),
			submitCount: nonNegativeInteger(userStatus.submitCount, 'userStatus.submitCount'),
			hintsViewed: nonNegativeInteger(userStatus.hintsViewed, 'userStatus.hintsViewed'),
		} : undefined,
	};
}

function parseStressTask(value: unknown, name: string): StressTask {
	const task = record(value, `${name} 无效。`);
	const billing = record(task.billing, `${name}.billing`);
	const counterExample = task.counterExample === undefined ? undefined : record(task.counterExample, `${name}.counterExample`);
	const roundsPlanned = positiveInteger(task.roundsPlanned, `${name}.roundsPlanned`);
	const roundsExecuted = nonNegativeInteger(task.roundsExecuted, `${name}.roundsExecuted`);
	const status = nonEmptyString(task.status, `${name}.status`);
	if (roundsExecuted > roundsPlanned) {
		throw new ProtocolValidationError('invalid_request', `${name}.roundsExecuted 不能超过 roundsPlanned。`);
	}
	if (status === 'found' && counterExample === undefined) {
		throw new ProtocolValidationError('invalid_request', `${name}.status 为 found 时必须包含 counterExample。`);
	}
	if (status !== 'found' && counterExample !== undefined) {
		throw new ProtocolValidationError('invalid_request', `${name}.counterExample 只能用于 found 终态。`);
	}
	return {
		taskId: decimalString(task.taskId, `${name}.taskId`),
		submissionId: decimalString(task.submissionId, `${name}.submissionId`),
		status,
		roundsPlanned,
		roundsExecuted,
		billing: {
			amount: nonNegativeNumber(billing.amount, `${name}.billing.amount`),
			currency: nonEmptyString(billing.currency, `${name}.billing.currency`),
			refundAmount: nonNegativeNumber(billing.refundAmount, `${name}.billing.refundAmount`),
		},
		createdAt: nonEmptyString(task.createdAt, `${name}.createdAt`),
		finishedAt: optionalString(task.finishedAt, `${name}.finishedAt`),
		counterExample: counterExample ? {
			input: stringValue(counterExample.input, `${name}.counterExample.input`),
			expected: stringValue(counterExample.expected, `${name}.counterExample.expected`),
			actual: stringValue(counterExample.actual, `${name}.counterExample.actual`),
		} : undefined,
		errorMessage: optionalString(task.errorMessage, `${name}.errorMessage`),
	};
}

function parseLikes(value: unknown, name: string): HintLikes {
	const likes = record(value, `${name} 无效。`);
	const question = record(likes.question, `${name}.question`);
	const answer = record(likes.answer, `${name}.answer`);
	return {
		question: {
			liked: booleanValue(question.liked, `${name}.question.liked`),
			count: nonNegativeInteger(question.count, `${name}.question.count`),
		},
		answer: {
			liked: booleanValue(answer.liked, `${name}.answer.liked`),
			count: nonNegativeInteger(answer.count, `${name}.answer.count`),
		},
	};
}

function parseWebsiteError(value: unknown): WebsiteError {
	const error = record(value, 'error 无效。');
	const fieldErrors = error.fieldErrors === undefined ? undefined : record(error.fieldErrors, 'error.fieldErrors');
	return {
		source: oneOf(error.source, ['protocol', 'website'] as const, 'error.source'),
		code: nonEmptyString(error.code, 'error.code'),
		message: nonEmptyString(error.message, 'error.message'),
		retryAfterSeconds: error.retryAfterSeconds === undefined ? undefined : nonNegativeNumber(error.retryAfterSeconds, 'error.retryAfterSeconds'),
		fieldErrors: fieldErrors ? Object.fromEntries(Object.entries(fieldErrors).map(([key, item]) => [key, stringValue(item, `error.fieldErrors.${key}`)])) : undefined,
	};
}

function record(value: unknown, message: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new ProtocolValidationError('invalid_request', message);
	}
	return value as Record<string, unknown>;
}

function array(value: unknown, name: string): unknown[] {
	if (!Array.isArray(value)) {
		throw new ProtocolValidationError('invalid_request', `${name} 必须是数组。`);
	}
	return value;
}

function markdown(value: unknown, name: string): MarkdownContent {
	const content = record(value, `${name} 无效。`);
	if (content.format !== 'markdown' || typeof content.content !== 'string') {
		throw new ProtocolValidationError('invalid_request', `${name} 必须是 Markdown 内容。`);
	}
	return { format: 'markdown', content: content.content };
}

function optionalMarkdown(value: unknown, name: string): MarkdownContent | undefined {
	return value === undefined ? undefined : markdown(value, name);
}

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new ProtocolValidationError('invalid_request', `${name} 必须是非空字符串。`);
	}
	return value;
}

function decimalString(value: unknown, name: string): string {
	const result = nonEmptyString(value, name);
	if (!/^\d+$/.test(result)) {
		throw new ProtocolValidationError('invalid_request', `${name} 必须是十进制字符串。`);
	}
	return result;
}

function stringValue(value: unknown, name: string): string {
	if (typeof value !== 'string') {
		throw new ProtocolValidationError('invalid_request', `${name} 必须是字符串。`);
	}
	return value;
}

function optionalString(value: unknown, name: string): string | undefined {
	return value === undefined ? undefined : stringValue(value, name);
}

function booleanValue(value: unknown, name: string): boolean {
	if (typeof value !== 'boolean') {
		throw new ProtocolValidationError('invalid_request', `${name} 必须是布尔值。`);
	}
	return value;
}

function nonNegativeNumber(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new ProtocolValidationError('invalid_request', `${name} 必须是非负数。`);
	}
	return value;
}

function optionalNumber(value: unknown, name: string): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new ProtocolValidationError('invalid_request', `${name} 必须是数字。`);
	}
	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	const result = nonNegativeNumber(value, name);
	if (!Number.isInteger(result)) {
		throw new ProtocolValidationError('invalid_request', `${name} 必须是整数。`);
	}
	return result;
}

function positiveInteger(value: unknown, name: string): number {
	const result = nonNegativeInteger(value, name);
	if (result === 0) {
		throw new ProtocolValidationError('invalid_request', `${name} 必须是正整数。`);
	}
	return result;
}

function stringArray(value: unknown, name: string): string[] {
	return array(value, name).map((item, index) => stringValue(item, `${name}[${index}]`));
}

function oneOf<T extends string>(value: unknown, values: readonly T[], name: string): T {
	if (typeof value !== 'string' || !values.includes(value as T)) {
		throw new ProtocolValidationError('invalid_request', `${name} 的值无效。`);
	}
	return value as T;
}

function optionalNonEmptyString(value: unknown, name: string): string | undefined {
	return value === undefined ? undefined : nonEmptyString(value, name);
}

function assertUnique(values: readonly string[], name: string): void {
	if (new Set(values).size !== values.length) {
		throw new ProtocolValidationError('invalid_request', `${name} 不能重复。`);
	}
}

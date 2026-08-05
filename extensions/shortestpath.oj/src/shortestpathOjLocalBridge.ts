/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import { AddressInfo } from 'net';
import { RawData, WebSocket, WebSocketServer } from 'ws';
import {
	bridgePath,
	bridgeProtocol,
	EditorialResult,
	HintAnswerResult,
	ImportedProblem,
	IncomingEvent,
	LikeResult,
	parseEditorialResult,
	parseHintAnswerResult,
	parseIncomingEvent,
	parseLikeResult,
	parseMessage,
	parseProblemBindData,
	parseProblemStateSyncData,
	parseStressContext,
	parseStressStartResult,
	parseSubmissionResult,
	parseSubmissionWatchResult,
	ProblemState,
	ProtocolRequest,
	ProtocolResponse,
	ProtocolValidationError,
	StressContext,
	StressStartResult,
	SubmissionResult,
	SubmissionWatchResult,
	WebsiteError,
} from './shortestpathOjProtocol';

const maximumMessageBytes = 8 * 1024 * 1024;
const regularRequestTimeoutMs = 2 * 60_000;
const submissionRequestTimeoutMs = 15 * 60_000;
const defaultImportTimeoutMs = 15_000;
const allowedBrowserOrigins = new Set(['https://shortestpath.cn']);
const incomingEventTypes = new Set(['submission.progress', 'submission.finished', 'stress.progress', 'stress.finished']);

export type ImportAction = 'created' | 'updated';

export type LocalBridgeHandlers = {
	importProblem(problem: ImportedProblem, signal: AbortSignal): Promise<ImportAction>;
	activateProblem?(problem: ImportedProblem): Promise<void> | void;
	updateProblemState(problemRef: string, state: ProblemState): Promise<void>;
	handleEvent(problemRef: string, event: IncomingEvent): Promise<void> | void;
	handleDisconnect(problemRef: string): Promise<void> | void;
};

export type ActiveSession = {
	sessionId: string;
	problemRef: string;
};

type PendingRequest = {
	expectedType: string;
	sideEffect: boolean;
	resolve(response: ProtocolResponse): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
	longRunningTimer: ReturnType<typeof setTimeout>;
	longRunningNoticeShown: boolean;
	problemRef: string;
};

type BridgeConnection = {
	socket: WebSocket;
	pending: Map<string, PendingRequest>;
	queue: Promise<void>;
};

type InternalActiveSession = ActiveSession & {
	connection: BridgeConnection;
};

export class WebsiteRequestError extends Error {
	constructor(readonly websiteError: WebsiteError) {
		super(formatWebsiteError(websiteError));
	}
}

export class OutcomeUnknownError extends Error {
	constructor() {
		super('网站操作结果未知，请先查看网页状态。');
	}
}

export class ShortestPathOjLocalBridge {
	private readonly server: WebSocketServer;
	private readonly connections = new Set<BridgeConnection>();
	private readonly longRunningRequestListeners = new Set<(problemRef: string, active: boolean) => void>();
	private activeSession: InternalActiveSession | undefined;
	private bindQueue = Promise.resolve();

	constructor(
		private readonly handlers: LocalBridgeHandlers,
		port: number,
		host = '127.0.0.1',
		private readonly importTimeoutMs = defaultImportTimeoutMs,
		private readonly longRunningRequestDelayMs = 1_000,
	) {
		this.server = new WebSocketServer({
			host,
			port,
			path: bridgePath,
			maxPayload: maximumMessageBytes,
			handleProtocols: protocols => protocols.has(bridgeProtocol) ? bridgeProtocol : false,
			verifyClient: (info: { origin: string }) => allowedBrowserOrigins.has(info.origin),
		});
		this.server.on('connection', socket => this.accept(socket));
	}

	onError(listener: (error: Error) => void): void {
		this.server.on('error', listener);
	}

	onListening(listener: () => void): void {
		this.server.on('listening', listener);
	}

	onLongRunningRequest(listener: (problemRef: string, active: boolean) => void): { dispose(): void } {
		this.longRunningRequestListeners.add(listener);
		return { dispose: () => this.longRunningRequestListeners.delete(listener) };
	}

	getActiveSession(): ActiveSession | undefined {
		const active = this.activeSession;
		return active ? { sessionId: active.sessionId, problemRef: active.problemRef } : undefined;
	}

	isBound(problemRef: string): boolean {
		const active = this.activeSession;
		return active?.problemRef === problemRef && active.connection.socket.readyState === WebSocket.OPEN;
	}

	async listeningPort(): Promise<number> {
		const current = this.server.address();
		if (current) {
			return (current as AddressInfo).port;
		}
		await new Promise<void>((resolve, reject) => {
			this.server.once('listening', resolve);
			this.server.once('error', reject);
		});
		return (this.server.address() as AddressInfo).port;
	}

	async close(): Promise<void> {
		for (const connection of this.connections) {
			this.rejectPending(connection, new Error('ShortestPath OJ bridge is shutting down.'));
			connection.socket.close(1001, 'ide_shutting_down');
		}
		this.connections.clear();
		this.activeSession = undefined;
		await new Promise<void>(resolve => this.server.close(() => resolve()));
	}

	async requestHintAnswer(problemRef: string, hintId: string): Promise<HintAnswerResult> {
		const response = await this.request(problemRef, 'hint.answer.request', { hintId }, 'hint.answer.result', true);
		return parseSideEffectResult(() => {
			const result = parseHintAnswerResult(response.data);
			if (result.hintId !== hintId) {
				throw new Error('提示答案响应与请求不匹配。');
			}
			return result;
		});
	}

	async requestLike(problemRef: string, hintId: string, target: 'question' | 'answer', liked: boolean): Promise<LikeResult> {
		const response = await this.request(problemRef, 'hint.like.set', { hintId, target, liked }, 'hint.like.set.result', true);
		return parseSideEffectResult(() => {
			const result = parseLikeResult(response.data);
			if (result.hintId !== hintId || result.target !== target) {
				throw new Error('点赞响应与请求不匹配。');
			}
			return result;
		});
	}

	async requestEditorial(problemRef: string, confirmed: boolean): Promise<EditorialResult> {
		const response = await this.request(problemRef, 'editorial.request', { confirmed }, 'editorial.result', true);
		return parseSideEffectResult(() => parseEditorialResult(response.data));
	}

	async requestSubmission(problemRef: string, operationId: string, language: string, sourceCode: string): Promise<SubmissionResult> {
		const response = await this.request(
			problemRef,
			'submission.request',
			{ operationId, language, sourceCode },
			'submission.result',
			true,
			submissionRequestTimeoutMs,
		);
		return parseSideEffectResult(() => {
			const result = parseSubmissionResult(response.data);
			if (result.language !== language) {
				throw new Error('提交响应的语言与请求不匹配。');
			}
			return result;
		});
	}

	async requestSubmissionWatch(problemRef: string, submissionId: string): Promise<SubmissionWatchResult> {
		const result = parseSubmissionWatchResult((await this.request(
			problemRef,
			'submission.watch.request',
			{ submissionId },
			'submission.watch.result',
			false,
		)).data);
		if (result.submissionId !== submissionId) {
			throw new Error('观察提交响应与请求不匹配。');
		}
		return result;
	}

	async requestStressContext(problemRef: string): Promise<StressContext> {
		return parseStressContext((await this.request(problemRef, 'stress.context.request', {}, 'stress.context.result', false)).data);
	}

	async requestStressStart(problemRef: string, submissionId: string, rounds: number): Promise<StressStartResult> {
		const response = await this.request(
			problemRef,
			'stress.start.request',
			{ submissionId, rounds },
			'stress.start.result',
			true,
		);
		return parseSideEffectResult(() => {
			const result = parseStressStartResult(response.data);
			if (result.task.submissionId !== submissionId) {
				throw new Error('对拍响应的提交 ID 与请求不匹配。');
			}
			return result;
		});
	}

	private accept(socket: WebSocket): void {
		const connection: BridgeConnection = { socket, pending: new Map(), queue: Promise.resolve() };
		this.connections.add(connection);
		socket.on('message', (data, isBinary) => {
			if (isBinary) {
				this.closeInvalidFrame(connection);
				return;
			}
			connection.queue = connection.queue
				.then(() => this.handleRawMessage(connection, data))
				.catch(error => this.logUnhandledError(connection, error));
		});
		socket.on('close', () => this.removeConnection(connection));
		socket.on('error', () => this.removeConnection(connection));
	}

	private async handleRawMessage(connection: BridgeConnection, rawData: RawData): Promise<void> {
		if (Array.isArray(rawData) || rawData instanceof ArrayBuffer) {
			this.closeInvalidFrame(connection);
			return;
		}
		const text = rawData.toString('utf8');
		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch {
			this.closeInvalidFrame(connection);
			return;
		}
		let message: ProtocolRequest | ProtocolResponse;
		try {
			message = parseMessage(raw);
		} catch (error) {
			if (this.rejectMalformedResponse(connection, raw, error)) {
				return;
			}
			this.respondToInvalidMessage(connection, raw, error);
			return;
		}
		if (isProtocolResponse(message)) {
			this.resolveResponse(connection, message);
			return;
		}
		if (message.type === 'problem.bind') {
			this.bindQueue = this.bindQueue
				.catch(() => undefined)
				.then(() => this.bindProblem(connection, message));
			await this.bindQueue;
			return;
		}
		if (message.type === 'problem.state.sync') {
			await this.syncProblemState(connection, message);
			return;
		}
		if (incomingEventTypes.has(message.type)) {
			await this.receiveEvent(connection, message);
			return;
		}
		if (looksLikeEvent(message.type)) {
			return;
		}
		this.sendFailure(connection, message.id, `${message.type}.result`, message.sessionId, 'unsupported_type', `不支持的消息类型：${message.type}`);
	}

	private async bindProblem(connection: BridgeConnection, request: ProtocolRequest): Promise<void> {
		if (request.sessionId !== undefined) {
			this.sendFailure(connection, request.id, 'problem.bind.result', undefined, 'invalid_request', 'problem.bind 不能携带 sessionId。');
			return;
		}
		let problem: ImportedProblem;
		try {
			problem = parseProblemBindData(request.data);
		} catch (error) {
			this.sendProtocolFailure(connection, request, 'problem.bind.result', error);
			return;
		}
		const current = this.activeSession;
		const reactivated = current?.connection === connection && current.problemRef === problem.ref;
		let action: ImportAction;
		try {
			action = await this.runImport(problem);
		} catch (error) {
			this.sendFailure(connection, request.id, 'problem.bind.result', undefined, 'request_failed', errorMessage(error));
			return;
		}
		const sessionId = reactivated ? current.sessionId : randomUUID();
		const replaced = current !== undefined && !reactivated;
		const next: InternalActiveSession = { sessionId, problemRef: problem.ref, connection };
		try {
			await this.handlers.activateProblem?.(problem);
		} catch (error) {
			this.sendFailure(connection, request.id, 'problem.bind.result', undefined, 'request_failed', errorMessage(error));
			return;
		}
		this.activeSession = next;
		this.sendSuccess(connection, request.id, 'problem.bind.result', sessionId, {
			active: true,
			action: reactivated ? 'reactivated' : action,
			replacedPrevious: replaced,
			message: '题目已在 ShortestPath IDE 中打开。',
		});
		if (replaced && current.connection !== connection) {
			this.send(current.connection, {
				version: 1,
				id: randomUUID(),
				type: 'session.replaced',
				sessionId: current.sessionId,
				data: {
					reason: 'another_problem_bound',
					activeProblemRef: problem.ref,
				},
			});
			this.rejectPending(current.connection, new Error('会话已被另一道题替换。'));
			current.connection.socket.close(4001, 'problem_replaced');
		}
	}

	private async syncProblemState(connection: BridgeConnection, request: ProtocolRequest): Promise<void> {
		const active = this.validateActiveRequest(connection, request, 'problem.state.sync.result');
		if (!active) {
			return;
		}
		try {
			const state = parseProblemStateSyncData(request.data);
			await this.handlers.updateProblemState(active.problemRef, state);
			this.sendSuccess(connection, request.id, 'problem.state.sync.result', active.sessionId, {});
		} catch (error) {
			this.sendProtocolFailure(connection, request, 'problem.state.sync.result', error, active.sessionId);
		}
	}

	private async receiveEvent(connection: BridgeConnection, request: ProtocolRequest): Promise<void> {
		const active = this.validateActiveEvent(connection, request);
		if (!active) {
			return;
		}
		try {
			const event = parseIncomingEvent(request.type, request.data);
			await this.handlers.handleEvent(active.problemRef, event);
		} catch {
			// Events are one-way snapshots. Invalid events are ignored and never acknowledged.
		}
	}

	private request(
		problemRef: string,
		type: string,
		data: object,
		expectedType: string,
		sideEffect: boolean,
		timeoutMs = regularRequestTimeoutMs,
	): Promise<ProtocolResponse> {
		const active = this.activeSession;
		if (!active || active.problemRef !== problemRef || active.connection.socket.readyState !== WebSocket.OPEN) {
			return Promise.reject(new Error('题目网页未连接，请从网站重新在 ShortestPath IDE 中打开。'));
		}
		if (type === 'submission.request' && [...active.connection.pending.values()].some(pending => pending.expectedType === 'submission.result')) {
			return Promise.reject(new Error('当前会话已有一个提交请求正在处理。'));
		}
		const id = randomUUID();
		return new Promise<ProtocolResponse>((resolve, reject) => {
			const timer = setTimeout(() => {
				active.connection.pending.delete(id);
				this.completePendingRequest(pending);
				reject(sideEffect ? new OutcomeUnknownError() : new Error(`请求超时：${type}`));
			}, timeoutMs);
			const longRunningTimer = setTimeout(() => {
				if (!active.connection.pending.has(id)) {
					return;
				}
				pending.longRunningNoticeShown = true;
				this.fireLongRunningRequest(problemRef, true);
			}, this.longRunningRequestDelayMs);
			const pending: PendingRequest = {
				expectedType,
				sideEffect,
				resolve,
				reject,
				timer,
				longRunningTimer,
				longRunningNoticeShown: false,
				problemRef,
			};
			active.connection.pending.set(id, pending);
			this.send(active.connection, {
				version: 1,
				id,
				type,
				sessionId: active.sessionId,
				data,
			}, error => {
				if (!error) {
					return;
				}
				active.connection.pending.delete(id);
				this.completePendingRequest(pending);
				reject(sideEffect ? new OutcomeUnknownError() : error);
			});
		});
	}

	private resolveResponse(connection: BridgeConnection, response: ProtocolResponse): void {
		const pending = connection.pending.get(response.replyTo);
		if (!pending) {
			return;
		}
		connection.pending.delete(response.replyTo);
		this.completePendingRequest(pending);
		const active = this.activeSession;
		if (!active || active.connection !== connection || response.sessionId !== active.sessionId) {
			pending.reject(pending.sideEffect ? new OutcomeUnknownError() : new Error('响应会话与当前活动题目不匹配。'));
			return;
		}
		if (response.type !== pending.expectedType) {
			pending.reject(pending.sideEffect ? new OutcomeUnknownError() : new Error(`响应类型不匹配：应为 ${pending.expectedType}，实际为 ${response.type}。`));
			return;
		}
		if (!response.ok) {
			pending.reject(new WebsiteRequestError(response.error!));
			return;
		}
		pending.resolve(response);
	}

	private validateActiveRequest(connection: BridgeConnection, request: ProtocolRequest, resultType: string): InternalActiveSession | undefined {
		const active = this.activeSession;
		if (!active || active.connection !== connection) {
			this.sendFailure(connection, request.id, resultType, request.sessionId, active ? 'session_replaced' : 'not_bound', active ? '会话已被另一道题替换。' : '当前连接尚未绑定题目。');
			return undefined;
		}
		if (request.sessionId !== active.sessionId) {
			this.sendFailure(connection, request.id, resultType, active.sessionId, 'session_mismatch', 'sessionId 与当前活动会话不一致。');
			return undefined;
		}
		return active;
	}

	private validateActiveEvent(connection: BridgeConnection, request: ProtocolRequest): InternalActiveSession | undefined {
		const active = this.activeSession;
		return active?.connection === connection && request.sessionId === active.sessionId ? active : undefined;
	}

	private removeConnection(connection: BridgeConnection): void {
		if (!this.connections.delete(connection)) {
			return;
		}
		const active = this.activeSession;
		if (active?.connection === connection) {
			this.activeSession = undefined;
			void this.handlers.handleDisconnect(active.problemRef);
		}
		this.rejectPending(connection);
	}

	private rejectPending(connection: BridgeConnection, error?: Error): void {
		for (const pending of connection.pending.values()) {
			this.completePendingRequest(pending);
			pending.reject(pending.sideEffect ? new OutcomeUnknownError() : (error ?? new Error('题目网页连接已断开。')));
		}
		connection.pending.clear();
	}

	private respondToInvalidMessage(connection: BridgeConnection, raw: unknown, error: unknown): void {
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
			return;
		}
		const partial = raw as { id?: unknown; type?: unknown; sessionId?: unknown };
		if (typeof partial.id !== 'string' || typeof partial.type !== 'string') {
			return;
		}
		const code = error instanceof ProtocolValidationError ? error.code : 'invalid_message';
		const sessionId = typeof partial.sessionId === 'string' ? partial.sessionId : undefined;
		this.sendFailure(connection, partial.id, `${partial.type}.result`, sessionId, code, errorMessage(error));
	}

	private rejectMalformedResponse(connection: BridgeConnection, raw: unknown, error: unknown): boolean {
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
			return false;
		}
		const replyTo = (raw as { replyTo?: unknown }).replyTo;
		if (typeof replyTo !== 'string') {
			return false;
		}
		const pending = connection.pending.get(replyTo);
		if (!pending) {
			return true;
		}
		connection.pending.delete(replyTo);
		this.completePendingRequest(pending);
		pending.reject(pending.sideEffect ? new OutcomeUnknownError() : new Error(errorMessage(error)));
		return true;
	}

	private completePendingRequest(pending: PendingRequest): void {
		clearTimeout(pending.timer);
		clearTimeout(pending.longRunningTimer);
		if (pending.longRunningNoticeShown) {
			pending.longRunningNoticeShown = false;
			this.fireLongRunningRequest(pending.problemRef, false);
		}
	}

	private fireLongRunningRequest(problemRef: string, active: boolean): void {
		for (const listener of this.longRunningRequestListeners) {
			listener(problemRef, active);
		}
	}

	private sendProtocolFailure(
		connection: BridgeConnection,
		request: ProtocolRequest,
		type: string,
		error: unknown,
		sessionId?: string,
	): void {
		this.sendFailure(
			connection,
			request.id,
			type,
			sessionId,
			error instanceof ProtocolValidationError ? error.code : 'request_failed',
			errorMessage(error),
		);
	}

	private sendSuccess(connection: BridgeConnection, replyTo: string, type: string, sessionId: string, data: object): void {
		this.send(connection, { version: 1, id: randomUUID(), replyTo, type, sessionId, ok: true, data });
	}

	private sendFailure(
		connection: BridgeConnection,
		replyTo: string,
		type: string,
		sessionId: string | undefined,
		code: string,
		message: string,
	): void {
		this.send(connection, {
			version: 1,
			id: randomUUID(),
			replyTo,
			type,
			sessionId,
			ok: false,
			error: { source: 'protocol', code, message },
		});
	}

	private send(connection: BridgeConnection, message: object, callback?: (error?: Error) => void): void {
		if (connection.socket.readyState === WebSocket.OPEN) {
			connection.socket.send(JSON.stringify(message), callback);
		} else {
			callback?.(new Error('WebSocket is not open.'));
		}
	}

	private closeInvalidFrame(connection: BridgeConnection): void {
		connection.socket.close(1003, 'text_json_required');
	}

	private logUnhandledError(connection: BridgeConnection, error: unknown): void {
		this.rejectPending(connection, new Error(errorMessage(error)));
	}

	private async runImport(problem: ImportedProblem): Promise<ImportAction> {
		const controller = new AbortController();
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, this.importTimeoutMs);
		try {
			const action = await this.handlers.importProblem(problem, controller.signal);
			if (timedOut) {
				throw new Error('题目导入超时。');
			}
			return action;
		} catch (error) {
			if (timedOut) {
				throw new Error('题目导入超时。');
			}
			throw error;
		} finally {
			clearTimeout(timer);
		}
	}
}

function looksLikeEvent(type: string): boolean {
	return type.endsWith('.progress') || type.endsWith('.finished');
}

function isProtocolResponse(message: ProtocolRequest | ProtocolResponse): message is ProtocolResponse {
	return (message as ProtocolResponse).replyTo !== undefined;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function formatWebsiteError(error: WebsiteError): string {
	const details = error.fieldErrors ? Object.values(error.fieldErrors).join('；') : '';
	const retry = error.retryAfterSeconds === undefined ? '' : `（${error.retryAfterSeconds} 秒后可重试）`;
	return [error.message, details].filter(Boolean).join('；') + retry;
}

function parseSideEffectResult<T>(parse: () => T): T {
	try {
		return parse();
	} catch {
		throw new OutcomeUnknownError();
	}
}

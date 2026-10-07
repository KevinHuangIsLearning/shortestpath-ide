/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LocalTestRequest, LocalTestsSnapshot, readLocalTestsSnapshot, localTestErrorMessage, isOfficialLocalTest } from './localTests';
import { renderLocalTests, renderLocalTestsToolbar } from './localTestsView';
import { ProblemRatingSession, isRating, Rating } from './problemRating';
import { renderLocalJudgingMarkdown } from './localJudgingMarkdown';
import { ConnectionRecovery, RecoveryState } from './connectionRecovery';
import { CorrectionView } from './correctionView';
import { AuxiliaryOperationRecovery } from './auxiliaryOperationRecovery';
import type { SubmissionCorrectionAvailability, SubmissionCorrectionTaskResponse, SubmissionListResponse } from './generated/api-contract';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as vscode from 'vscode';
import { localize, localizeFormat, localizeWebviewHtml } from './localization';
import { canRequestEditorial, describeEditorialLockReason, getCurrentEditorialRemainingMs, getEditorialConfirmationMessage, shouldConfirmEditorial } from './editorialAccess';
import { describeJudgeType, describeSubmissionDetailStatus, describeSubmissionStage, describeSubmissionStatus } from './judgeDisplay';
import { createProblemMarkdownRenderer, ProblemMarkdownRenderer } from './markdownRenderer';
import { EditorCodeTheme } from './editorCodeTheme';
import { defaultProblemSourceRatio } from './problemPanelLayout';
import { findOpenFileViewColumn, OpenFileTabGroup, shouldHideProblemPanelWhenSourceCloses } from './problemPanelLifecycle';
import { ImportAction, LocalBridgeHandlers, OutcomeUnknownError, ShortestPathOjLocalBridge } from './shortestpathOjLocalBridge';
import { mergeSubmissionHistory, sanitizeSubmissionHistoryEntry, SubmissionHistoryEntry, toSubmissionHistoryEntry } from './submissionHistory';
import { isValidSourcePath, encodeSourcePath } from './sourcePath';
import { appendPreviousStatementVersion, canReuseProblemSource, hasProblemStatementChanged, ProblemStatementSnapshot, sanitizeProblemStatementVersions } from './problemStatementVersion';
import { formatElapsedTimer } from './timerDisplay';
import { assertUniqueWorkspaceProblemRecordFileNames, getWorkspaceProblemRecordFileName, getWorkspaceProblemCacheEvictions, touchWorkspaceProblemCache, getWorkspaceProblemRecoveryContext, readWorkspaceProblemRecoveryContext, WorkspaceProblemRecoveryContext } from './workspaceProblemCache';
import { listProblemRecords, ProblemRecordFileSystem } from './workspaceProblemRecordStorage';
import { migrateLegacyWorkspaceCache } from './workspaceProblemCacheMigration';
import {
	applyEditorialLikeResult,
	applyEditorialLockRemaining,
	applyAcceptedSubmission,
	applyHintLockRemaining,
	applyLikeResult,
	applyProblemState,
	EditorialResult,
	findProblemRefForSourcePath,
	HintAnswerResult,
	ImportedProblem,
	IncomingEvent,
	LikeResult,
	MarkdownContent,
	ProblemHint,
	ProblemState,
	ProblemCapabilities,
	StressContext,
	StressTask,
	SubmissionLanguage,
	SubmissionSnapshot,
	parseEditorialResult,
	parseStressStartResult,
	restoreCachedProblemCompatibilityWarnings,
	bridgePort,
} from './shortestpathOjProtocol';

const workspaceCacheDirectoryName = '.shortestpath';
const legacyWorkspaceCacheFileName = 'oj-problems.json';
const workspaceProblemRecordVersion = 2;
const workspaceFolderRequiredMessage = localize('请先在 ShortestPath IDE 中打开一个文件夹，再从网站导入题目。');
const workspaceCachesNeedingRewrite = new WeakSet<WorkspaceProblemCache>();
const workspaceCacheRecordLocations = new WeakMap<WorkspaceProblemCache, Map<string, string>>();
const workspaceCacheRecordContents = new WeakMap<WorkspaceProblemCache, Map<string, string>>();
const workspaceCacheSourceContents = new WeakMap<WorkspaceProblemCache, string>();
const workspaceCacheLegacyContents = new WeakMap<WorkspaceProblemCache, string>();
const workspaceCacheLocationsMigrated = new Set<string>();
let workspaceCacheStorageRoot: vscode.Uri | undefined;
let workspaceCacheMutationTail = Promise.resolve();
let workspaceCacheMigration: Promise<void> | undefined;
let persistPendingSubmissionAttempts: () => Promise<void> = async () => {};

async function openUrl(url: string): Promise<void> {
	const commands = await vscode.commands.getCommands();
	if (commands.includes('shortestpath.browser.open')) {
		await vscode.commands.executeCommand('shortestpath.browser.open', url);
		return;
	}
	if (commands.includes('simpleBrowser.show')) {
		await vscode.commands.executeCommand('simpleBrowser.show', url);
		return;
	}
	await vscode.env.openExternal(vscode.Uri.parse(url));
}

type WorkspaceProblemCache = {
	version: 4;
	problems: Record<string, ImportedProblem>;
	sourcePaths: Record<string, string>;
	submissions: Record<string, SubmissionHistoryEntry[]>;
	editorials: Record<string, EditorialResult>;
	previousStatements: Record<string, ProblemStatementSnapshot[]>;
	lastUsedAt: Record<string, number>;
	recoveryContexts: Record<string, WorkspaceProblemRecoveryContext>;
};

type CphImportResult = { succeeded: boolean; sourcePath?: string };

type CachedWorkspaceProblemCache = Omit<Partial<WorkspaceProblemCache>, 'version'> & { version?: 3 | 4 };

type WorkspaceProblemRecord = {
	version: 1 | typeof workspaceProblemRecordVersion;
	problem: ImportedProblem;
	sourcePath?: string;
	submissions: SubmissionHistoryEntry[];
	editorial?: EditorialResult;
	previousStatements?: ProblemStatementSnapshot[];
	lastUsedAt?: number;
};

function isWrongAnswerStatus(status: string): boolean {
	return status === 'WA' || status === 'Wrong Answer' || /\bWA\b/i.test(status);
}

function hasIncompatibleProblemState(problem: ImportedProblem): boolean {
	return problem.compatibilityWarnings.some(warning => warning.includes('题目状态不兼容'));
}

let renderProblemMarkdown: ProblemMarkdownRenderer = (content) => {
	return content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
};
let markdownContentCache = new WeakMap<MarkdownContent, Map<string, string>>();
const hintAnswerCache = new Map<string, MarkdownContent>();

function hintAnswerCacheKey(problemRef: string, hintId: string): string {
	return `${problemRef}/${hintId}`;
}

function getShikiTheme(): string {
	const kind = vscode.window.activeColorTheme.kind;
	if (kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight) {
		return 'github-light';
	}
	return 'github-dark';
}

function renderMarkdownContent(content: MarkdownContent, baseUrl: string): string {
	let byBaseUrl = markdownContentCache.get(content);
	if (!byBaseUrl) {
		byBaseUrl = new Map();
		markdownContentCache.set(content, byBaseUrl);
	}
	let html = byBaseUrl.get(baseUrl);
	if (html === undefined) {
		html = renderProblemMarkdown(content.content, baseUrl);
		byBaseUrl.set(baseUrl, html);
	}
	return html;
}
type CphProblemForSubmission = { url?: unknown; srcPath?: unknown };
type SubmissionAttempt = {
	accountId?: string;
	contextKey?: string;
	operationId: string;
	language: string;
	sourceCode: string;
	sourcePath: string;
};

type ProblemPanelState = {
	localTests?: LocalTestsSnapshot;
	localTestsError?: string;
	localTestsPending?: boolean;
	problem: ImportedProblem;
	compatibilityWarningDismissed: boolean;
	connected: boolean;
	statusMessage: string;
	recoveryState?: RecoveryState;
	rating?: ProblemRatingSession;
	answers: Map<string, MarkdownContent>;
	hintMessages: Map<string, string>;
	hintRemainingReceivedAtMs?: Map<string, number>;
	editorial?: EditorialResult;
	cachedEditorial?: EditorialResult;
	submissions: Map<string, SubmissionSnapshot | SubmissionHistoryEntry>;
	finishedSubmissions: Set<string>;
	disconnectedSubmissions: Set<string>;
	stressContext?: StressContext;
	stressTasks: Map<string, StressTask>;
	finishedStressTasks: Set<string>;
	disconnectedStressTasks: Set<string>;
	addingStressCounterExamples: Set<string>;
	addedStressCounterExamples: Set<string>;
	operationsInFlight: Set<string>;
	editorialRemainingReceivedAtMs: number;
	sourcePath?: string;
	previousStatements: ProblemStatementSnapshot[];
	statementVersionIndex: number;
};

type ProblemPanelActions = {
	recover(problem: ImportedProblem): void;
	activatePanel?(): void;
	sourceChanged?(problem: ImportedProblem, previous: string | undefined, sourcePath: string): Promise<void>;
	stopRecovery(): void;
	retryConnection(): void;
	login(): Promise<void>;
	answer(problem: ImportedProblem, hintId: string): Promise<HintAnswerResult>;
	refreshHints(problem: ImportedProblem): Promise<void>;
	like(problem: ImportedProblem, hintId: string, target: 'question' | 'answer', liked: boolean): Promise<LikeResult>;
	editorial(problem: ImportedProblem): Promise<EditorialResult | undefined>;
	submit(problem: ImportedProblem): Promise<void>;
	correct(problem: ImportedProblem, submissionId: string): Promise<void>;
	loadRating(problem: ImportedProblem): Promise<unknown>;
	saveRating(problem: ImportedProblem, rating: Rating): Promise<unknown>;
	refreshHistory(problem: ImportedProblem): Promise<void>;
	watchSubmission(problem: ImportedProblem, submissionId: string): Promise<void>;
	loadStress(problem: ImportedProblem): Promise<StressContext>;
	startStress(problem: ImportedProblem, submissionId: string, rounds: number): Promise<StressTask>;
	addStressCounterExample(problem: ImportedProblem, task: StressTask, sourcePath?: string): Promise<void>;
	loadSubmissionHistory(problem: ImportedProblem): Promise<SubmissionHistoryEntry[]>;
	saveSubmissionHistory(problem: ImportedProblem, submission: SubmissionHistoryEntry): Promise<void>;
	loadEditorial(problem: ImportedProblem): Promise<EditorialResult | undefined>;
	saveEditorial(problem: ImportedProblem, editorial: EditorialResult): Promise<void>;
	loadPreviousStatements(problem: ImportedProblem): Promise<ProblemStatementSnapshot[]>;
	deletePreviousStatement(problem: ImportedProblem, versionIndex: number): Promise<ProblemStatementSnapshot[]>;
};

class ShortestPathOjProblemPanel {
	get problemRef(): string | undefined { return this.state?.problem.ref; }
	get currentProblem(): ImportedProblem | undefined { return this.state?.problem; }
	private panel: vscode.WebviewPanel | undefined;
	private state: ProblemPanelState | undefined;
	private sentSections: ProblemViewSections | undefined;
	private sentTimerJson = '';
	private pendingSections: ProblemViewSections | undefined;
	private pendingTimer: ProblemViewTimer | undefined;
	private webviewReady = false;
	private renderedProblemRef: string | undefined;
	private editorialPanel: vscode.WebviewPanel | undefined;
	private longRunningOperationNoticeCount = 0;
	private longRunningOperationNoticeVisible = false;
	private operationToastMessage: string | undefined;
	private operationToastTimer: ReturnType<typeof setTimeout> | undefined;
	private editorialRequestInFlight = false;
	private editorialRequestToken = 0;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly template: string,
		private readonly actions: ProblemPanelActions,
		private readonly unknownStressStarts: Set<string>,
	) { }

	showProblem(problem: ImportedProblem, connected: boolean, sourcePath?: string, fromWebsite = false): void {
		if (!this.state || recoveryContext(this.state.problem) !== recoveryContext(problem) || hasProblemStatementChanged(this.state.problem, problem)) {
			this.state?.rating?.dispose();
			this.longRunningOperationNoticeCount = 0;
			this.longRunningOperationNoticeVisible = false;
			this.clearOperationToast();
			this.editorialPanel?.dispose();
			this.editorialPanel = undefined;
			this.editorialRequestInFlight = false;
			this.editorialRequestToken++;
			const answers = new Map<string, MarkdownContent>();
			for (const hint of problem.state.hints) {
				const cached = hintAnswerCache.get(hintAnswerCacheKey(problem.ref, hint.id));
				if (cached) {
					answers.set(hint.id, cached);
				}
			}
			this.state = {
				problem,
				compatibilityWarningDismissed: false,
				connected,
				statusMessage: connected ? '已连接题目网页。' : '正在重新连接…',
				answers,
				hintMessages: new Map(),
				submissions: new Map(),
				finishedSubmissions: new Set(),
				disconnectedSubmissions: new Set(),
				stressTasks: new Map(),
				finishedStressTasks: new Set(),
				disconnectedStressTasks: new Set(),
				addingStressCounterExamples: new Set(),
				addedStressCounterExamples: new Set(),
				operationsInFlight: new Set(),
				editorialRemainingReceivedAtMs: Date.now(),
				sourcePath,
				previousStatements: [],
				statementVersionIndex: 0,
			};
			const state = this.state;
			state.rating = new ProblemRatingSession(
				() => this.actions.loadRating(state.problem),
				rating => this.actions.saveRating(state.problem, rating),
				() => { if (this.state === state) { this.render(); } },
			);
			void Promise.all([
				this.actions.loadSubmissionHistory(problem),
				this.actions.loadEditorial(problem),
				this.actions.loadPreviousStatements(problem),
			]).then(([submissions, editorial, previousStatements]) => {
				if (this.state !== state || state.problem.ref !== problem.ref) {
					return;
				}
				for (const submission of submissions) {
					const existing = state.submissions.get(submission.submissionId);
					if (!existing || !isLiveSubmission(existing)) {
						state.submissions.set(submission.submissionId, submission);
					}
					state.finishedSubmissions.add(submission.submissionId);
				}
				// A user can request a fresh report before this asynchronous cache
				// load completes. Keep that newer result instead of replacing it
				// with the older cached copy.
				if (state.cachedEditorial === undefined) {
					state.cachedEditorial = editorial;
				}
				if (state.editorial === undefined) {
					state.editorial = editorial;
				}
				const previousStatementCount = state.previousStatements.length;
				state.previousStatements = previousStatements;
				if (previousStatementCount !== previousStatements.length) {
					this.renderedProblemRef = undefined;
				}
				this.render();
			}).catch(error => console.error('Failed to load ShortestPath OJ cached content.', error));
		} else {
			this.state.problem = problem;
			this.state.connected = connected;
			this.state.statusMessage = connected ? '已连接题目网页。' : '正在重新连接…';
			if (fromWebsite) {
				this.state.editorialRemainingReceivedAtMs = Date.now();
			}
			if (sourcePath) {
				this.state.sourcePath = sourcePath;
			}
			this.refreshEditorial();
		}
		if (!connected) { this.actions.recover(problem); }
		this.updateProblemPanelTitle();
		const panelCreated = this.ensureProblemPanel();
		this.render();
		const panel = this.panel;
		if (!panelCreated && panel) {
			panel.reveal(panel.viewColumn, true);
		}
	}

	updateProblemState(problemRef: string, state: ProblemState, capabilities?: ProblemCapabilities): void {
		if (!this.state || this.state.problem.ref !== problemRef) {
			return;
		}
		if (hasIncompatibleProblemState(this.state.problem)) {
			return;
		}
		this.state.problem = applyProblemState(this.state.problem, state);
		this.state.hintRemainingReceivedAtMs?.clear();
		if (capabilities) { this.state.problem.capabilities = capabilities; }
		this.state.editorialRemainingReceivedAtMs = Date.now();
		this.render();
	}

	handleEvent(problemRef: string, event: IncomingEvent): void {
		const state = this.state;
		if (!state || state.problem.ref !== problemRef) {
			return;
		}
		if (event.type === 'correction.snapshot') { return; }
		if (event.type === 'submission.progress' || event.type === 'submission.finished') {
			const snapshot = event.data;
			const previous = state.submissions.get(snapshot.submissionId);
			const previousGeneration = previous?.generation ?? 1;
			if ((snapshot.generation ?? 1) < previousGeneration) { return; }
			if ((snapshot.generation ?? 1) > previousGeneration) { state.finishedSubmissions.delete(snapshot.submissionId); }
			const wasFinished = state.finishedSubmissions.has(snapshot.submissionId);
			if (event.type === 'submission.progress' && wasFinished) {
				return;
			}
			state.submissions.set(snapshot.submissionId, snapshot);
			state.disconnectedSubmissions.delete(snapshot.submissionId);
			if (event.type === 'submission.finished') {
				if (!wasFinished) { void vscode.commands.executeCommand('shortestpath.mode.notifyResult'); }
				if (snapshot.status.toUpperCase() === 'AC' && !snapshot.resultHidden) { state.rating?.observeAccepted(snapshot.submissionId); }
				state.finishedSubmissions.add(snapshot.submissionId);
				void this.actions.saveSubmissionHistory(state.problem, toSubmissionHistoryEntry(snapshot)).catch(error => console.error('Failed to save ShortestPath OJ submission history.', error));
			}
			state.problem = applyAcceptedSubmission(state.problem, snapshot.status, snapshot.userStatus?.status);
		} else {
			const task = event.data.task;
			if (event.type === 'stress.progress' && state.finishedStressTasks.has(task.taskId)) {
				return;
			}
			state.stressTasks.set(task.taskId, task);
			state.disconnectedStressTasks.delete(task.taskId);
			if (event.type === 'stress.finished') {
				state.finishedStressTasks.add(task.taskId);
			}
		}
		this.render();
	}

	setDisconnected(problemRef: string): void {
		if (!this.state || this.state.problem.ref !== problemRef) {
			return;
		}
		this.state.connected = false;
		this.actions.recover(this.state.problem);
		this.state.statusMessage = '正在重新连接…';
		for (const submissionId of this.state.submissions.keys()) {
			if (!this.state.finishedSubmissions.has(submissionId)) {
				this.state.disconnectedSubmissions.add(submissionId);
			}
		}
		for (const [taskId, task] of this.state.stressTasks) {
			if (task.status === 'queued' || task.status === 'running') {
				this.state.disconnectedStressTasks.add(taskId);
			}
		}
		this.refreshEditorial();
		this.render();
	}

	setRecoveryState(problemRef: string, recoveryState: RecoveryState): void {
		if (!this.state || this.state.problem.ref !== problemRef) { return; }
		this.state.recoveryState = recoveryState;
		this.state.connected = recoveryState === 'connected';
		const messages: Record<RecoveryState, string> = { connecting: '正在重新连接…', connected: '', verification_required: '请去网页完成验证', login_required: '登录后继续', account_mismatch: '请登录原账号后继续', error: '暂时无法连接' };
		this.state.statusMessage = messages[recoveryState];
		this.render();
	}

	async restoreObservations(problemRef?: string): Promise<void> {
		const state = this.state;
		if (problemRef && state?.problem.ref !== problemRef) { return; }
		if (!state?.connected) { return; }
		await Promise.allSettled([
			state.rating?.refresh(),
			...(state.problem.target ? [this.actions.refreshHistory(state.problem)] : []),
			...[...state.disconnectedSubmissions].map(id => this.actions.watchSubmission(state.problem, id)),
		]);
		if (state !== this.state || !state.connected) { return; }
		if (state.problem.target || state.stressTasks.size) {
			try {
				const result = await this.actions.loadStress(state.problem);
				if (state !== this.state || !state.connected) { return; }
				state.stressContext = result;
				for (const task of result.tasks) { state.stressTasks.set(task.taskId, task); state.disconnectedStressTasks.delete(task.taskId); }
				this.render();
			} catch (error) { console.warn('Failed to restore ShortestPath observations.', error); }
		}
	}

	getTimerForJudger(url: string, sourcePath: string): ProblemState['timer'] | undefined {
		if (this.state?.problem.url !== url || this.state.sourcePath !== sourcePath) { return undefined; }
		return { ...this.state.problem.state.timer };
	}

	reveal(): void {
		if (!this.state) {
			return;
		}
		const panelCreated = this.ensureProblemPanel();
		this.render();
		const panel = this.panel;
		if (!panelCreated && panel) {
			panel.reveal(panel.viewColumn, false);
		}
	}

	async hideProblemWhenSourceCloses(): Promise<boolean> {
		if (this.panel?.options.sourceEditor) { return false; }
		if (!this.state || !shouldHideProblemPanelWhenSourceCloses(this.state.sourcePath, getOpenFileTabGroups().flatMap(group => group.filePaths))) {
			return false;
		}
		this.actions.stopRecovery();
		this.state?.rating?.dispose();
		this.state = undefined;
		this.panel?.dispose();
		return true;
	}

	async hideProblemForCph(problemRef: string, sourcePath?: string): Promise<void> {
		if (this.state?.problem.ref !== problemRef) {
			return;
		}
		if (sourcePath && isActiveEditor(sourcePath)) {
			return;
		}
		this.actions.stopRecovery();
		this.state?.rating?.dispose();
		this.state = undefined;
		this.panel?.dispose();
	}

	registerSubmission(problemRef: string, submission: SubmissionSnapshot, message: string): void {
		if (!this.state || this.state.problem.ref !== problemRef) {
			return;
		}
		this.state.rating?.trackSubmission(submission.submissionId);
		const existing = this.state.submissions.get(submission.submissionId);
		if (!this.state.finishedSubmissions.has(submission.submissionId)) {
			this.state.submissions.set(submission.submissionId, submission);
		} else if (existing?.status.toUpperCase() === 'AC' && !existing.resultHidden) {
			this.state.rating?.observeAccepted(submission.submissionId);
		}
		this.state.statusMessage = message;
		this.render();
	}

	focusTab(tabId: 'statement' | 'hints' | 'submissions' | 'editorial'): void {
		void this.panel?.webview.postMessage({ type: 'focusTab', tabId });
	}

	updateLocalTests(snapshot: LocalTestsSnapshot): void {
		if (!this.state || this.state.sourcePath !== snapshot.sourcePath) { return; }
		this.state.localTests = snapshot;
		this.state.localTestsError = undefined;
		this.render();
	}

	private async localTestRequest(request: Omit<LocalTestRequest, 'sourcePath'>): Promise<void> {
		const state = this.state;
		if (!state?.sourcePath || state.problem.localTest?.enabled === false) { return; }
		const official = (id: number | undefined) => isOfficialLocalTest(state.localTests?.tests.find(test => test.id === id));
		if ((request.action === 'update' || request.action === 'delete') && official(request.id)) { return; }
		if (request.edits) { request = { ...request, edits: request.edits.filter(edit => !official(edit.id)) }; }
		if (request.action === 'load') { request = { ...request, samples: state.problem.samples.map(({ input, output }) => ({ input, output })) }; }
		const sourcePath = state.sourcePath;
		if (state.localTestsPending && request.action !== 'stop' && request.action !== 'load') { return; }
		const mutating = request.action === 'add' || request.action === 'update' || request.action === 'delete';
		if (mutating) { state.localTestsPending = true; this.render(); }
		try {
			await vscode.extensions.getExtension('shortestpath.judger')?.activate();
			if (this.state !== state || state.sourcePath !== sourcePath) { return; }
			const value = await vscode.commands.executeCommand('judger.integratedTests', { ...request, sourcePath });
			const snapshot = readLocalTestsSnapshot(value);
			if (this.state !== state || !snapshot || snapshot.sourcePath !== state.sourcePath) { return; }
			this.updateLocalTests(snapshot);
			if (request.action === 'add' || request.action === 'update') {
				void this.panel?.webview.postMessage({ type: 'localTestSaved', action: request.action, id: request.id });
			}
		} catch (error) {
			if (this.state === state && state.sourcePath === sourcePath) {
				state.localTestsError = localTestErrorMessage(error instanceof Error ? error.message : '');
				this.render();
			}
		} finally {
			if (mutating) { state.localTestsPending = false; if (this.state === state) { this.render(); } }
		}
	}

	refreshEditorial(): void {
		this.render();
		if (!this.editorialPanel || !this.state?.editorial) {
			return;
		}
		this.editorialPanel.webview.html = localizeWebviewHtml(getEditorialPanelHtml(this.state.editorial, this.state.problem, this.editorialPanel.webview, this.extensionUri, this.state.connected));
	}

	reloadStyles(version: number): void {
		void this.panel?.webview.postMessage({ type: 'reloadStyles', version });
		void this.editorialPanel?.webview.postMessage({ type: 'reloadStyles', version });
	}

	private refreshEditorialLike(hintId: string, target: 'question' | 'answer'): void {
		const editorial = this.state?.editorial;
		if (!this.editorialPanel || !editorial || editorial.state !== 'available') {
			return;
		}
		const hint = editorial.hints.find(item => item.hintId === hintId);
		if (!hint) {
			return;
		}
		void this.editorialPanel.webview.postMessage({
			type: 'editorialLike',
			hintId,
			target,
			questionLiked: hint.questionLiked,
			answerLiked: hint.answerLiked,
			questionLikeCount: hint.questionLikeCount,
			answerLikeCount: hint.answerLikeCount,
		});
	}

	private pendingConfirms = new Map<string, { resolve: (result: boolean) => void }>();

	confirm(message: string, confirmLabel: string, cancelLabel: string): Promise<boolean> {
		const id = Math.random().toString(36).slice(2);
		return new Promise<boolean>(resolve => {
			this.pendingConfirms.set(id, { resolve });
			void this.panel?.webview.postMessage({ type: 'confirm', id, message, confirmLabel, cancelLabel });
		});
	}

	private beginOperation(state: ProblemPanelState, key: string): boolean {
		if (state.operationsInFlight.has(key)) {
			return false;
		}
		state.operationsInFlight.add(key);
		this.render();
		return true;
	}

	private endOperation(state: ProblemPanelState, key: string): void {
		state.operationsInFlight.delete(key);
		if (this.state === state) {
			this.render();
		}
	}

	private getCurrentEditorialRemainingMs(state: ProblemPanelState): number {
		return getCurrentEditorialRemainingMs(
			state.problem.state.editorial.remainingMs,
			state.editorialRemainingReceivedAtMs,
		);
	}

	private getProblemViewColumn(): vscode.ViewColumn {
		return this.findBoundSourceEditorColumn() ?? vscode.window.tabGroups.activeTabGroup.viewColumn;
	}

	private findBoundSourceEditorColumn(): vscode.ViewColumn | undefined {
		const sourcePath = this.state?.sourcePath;
		if (!sourcePath) {
			return undefined;
		}
		return findOpenFileViewColumn(sourcePath, getOpenFileTabGroups());
	}

	private findCodeEditorColumn(): vscode.ViewColumn {
		const problemColumn = this.panel?.viewColumn;
		const codeEditor = vscode.window.visibleTextEditors.find(
			e => e.viewColumn !== undefined && e.viewColumn !== problemColumn,
		);
		if (codeEditor?.viewColumn !== undefined) {
			return codeEditor.viewColumn;
		}
		return problemColumn === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.One;
	}

	private async showEditorialPanel(editorial: EditorialResult, problem: ImportedProblem, canLike = this.state?.connected ?? false): Promise<void> {
		if (editorial.state !== 'available') {
			return;
		}
		const title = `${localize('解题报告')}: ${problem.title}`;
		if (this.editorialPanel) {
			this.editorialPanel.title = title;
			this.editorialPanel.webview.html = localizeWebviewHtml(getEditorialPanelHtml(editorial, problem, this.editorialPanel.webview, this.extensionUri, canLike));
			this.editorialPanel.reveal(this.editorialPanel.viewColumn, false);
			return;
		}
		// The optional split report uses a modal; the problem panel stays in place.
		const viewColumn = this.findBoundSourceEditorColumn() ?? this.findCodeEditorColumn();
		const panel = vscode.window.createWebviewPanel(
			'shortestpath.ojEditorial',
			title,
			{ viewColumn, preserveFocus: false },
			{
				enableScripts: true,
				modal: true,
				modalCloseOnly: true,
				localResourceRoots: [this.extensionUri],
				retainContextWhenHidden: true,
			},
		);
		this.editorialPanel = panel;
		panel.webview.onDidReceiveMessage(async (message) => {
			if (!this.state) {
				return;
			}
			if (typeof message !== 'object' || message === null) {
				return;
			}
			const value = message as { command?: unknown; hintId?: unknown; target?: unknown; liked?: unknown };
			if (value.command === 'like') {
				await this.handleMessage({ ...value, command: 'editorialLike' });
			}
		});
		panel.webview.html = localizeWebviewHtml(getEditorialPanelHtml(editorial, problem, panel.webview, this.extensionUri, canLike));
		panel.onDidDispose(() => {
			if (this.editorialPanel === panel) {
				this.editorialPanel = undefined;
			}
		});
	}

	private ensurePanel(viewColumn: vscode.ViewColumn): boolean {
		if (this.panel) {
			return false;
		}
		const panel = vscode.window.createWebviewPanel(
			'shortestpath.ojProblem',
			this.getProblemPanelTitle(),
			{ viewColumn, preserveFocus: true },
			{
				enableScripts: true,
				localResourceRoots: [this.extensionUri],
				retainContextWhenHidden: true,
				sourceEditor: this.state?.sourcePath ? vscode.Uri.file(this.state.sourcePath) : undefined,
				sourceEditorRatio: vscode.workspace.getConfiguration('shortestpath.oj').get<number>('problemSplitRatio', defaultProblemSourceRatio),
			},
		);
		this.restorePanel(panel);
		return true;
	}

	restorePanel(panel: vscode.WebviewPanel): void {
		panel.onDidDispose(() => {
			if (this.panel === panel) {
				this.panel = undefined;
				this.sentSections = undefined;
				this.pendingSections = undefined;
				this.pendingTimer = undefined;
				this.sentTimerJson = '';
				this.webviewReady = false;
			}
		});
		panel.onDidChangeViewState(() => {
			const state = this.state;
			const sourcePath = panel.options.sourceEditor?.fsPath;
			if (state && sourcePath && sourcePath !== state.sourcePath) {
				const previous = state.sourcePath;
				state.sourcePath = sourcePath;
				state.localTests = undefined;
				void Promise.resolve(this.actions.sourceChanged?.(state.problem, previous, sourcePath))
					.then(() => this.localTestRequest({ action: 'load' }))
					.catch(error => { if (this.state === state) { state.localTestsError = localTestErrorMessage(error instanceof Error ? error.message : ''); this.render(); } });
				void panel.webview.postMessage({ type: 'sourceChanged', problemRef: state.problem.ref, sourcePath });
			}
			if (panel.active) { this.actions.activatePanel?.(); }
		});
		panel.webview.onDidReceiveMessage(message => {
			if ((message as { command?: unknown })?.command !== 'ready') { this.actions.activatePanel?.(); }
			void this.handleMessage(message);
		});
		this.panel = panel;
	}

	private getProblemPanelTitle(): string {
		return this.state ? localizeFormat('{0}题面', this.state.problem.title) : 'ShortestPath OJ';
	}

	dispose(): void {
		this.state?.rating?.dispose();
		this.clearOperationToast();
		this.panel?.dispose();
		this.editorialPanel?.dispose();
	}

	private updateProblemPanelTitle(): void {
		if (this.panel) {
			this.panel.title = this.getProblemPanelTitle();
		}
	}

	private ensureProblemPanel(): boolean {
		return this.ensurePanel(this.getProblemViewColumn());
	}

	private async closeEmptyCompanionGroup(): Promise<void> {
		const column = this.panel?.viewColumn;
		if (column === undefined || !this.state?.sourcePath) { return; }
		const group = vscode.window.tabGroups.all.find(group => group.viewColumn === column + 1);
		if (group && group.tabs.every(tab => !tab.isDirty && tab.input === undefined && (tab.label === '新建标签页' || tab.label === 'New Tab'))) {
			await vscode.window.tabGroups.close(group, true);
		}
	}

	private async handleMessage(message: unknown): Promise<void> {
		const state = this.state;
		if (!state || typeof message !== 'object' || message === null) {
			return;
		}
		const connected = state.connected && !this.longRunningOperationNoticeVisible;
		const problemRef = state.problem.ref;
		const value = message as {
			command?: unknown;
			hintId?: unknown;
			target?: unknown;
			liked?: unknown;
			submissionId?: unknown;
			rounds?: unknown;
			taskId?: unknown;
			confirmId?: unknown;
			result?: unknown;
			rating?: unknown;
			versionIndex?: unknown;
			id?: unknown;
			input?: unknown;
			output?: unknown;
			edits?: unknown;
		};
		const externalSubmission = value.command === 'submit' && state.problem.target?.kind === 'contest';
		if (!connected && !externalSubmission && typeof value.command === 'string' && ['submit', 'answer', 'like', 'editorialLike', 'correct', 'watchSubmission', 'loadStress', 'startStress'].includes(value.command)) {
			return;
		}
		try {
			switch (value.command) {
				case 'localTestLoad': await this.localTestRequest({ action: 'load' }); return;
				case 'localTestRunAll': await this.localTestRequest({ action: 'runAll', edits: readLocalTestEdits(value.edits) }); return;
				case 'localTestStop': await this.localTestRequest({ action: 'stop' }); return;
				case 'localTestRun':
				case 'localTestDelete':
					if (typeof value.id === 'number' && Number.isSafeInteger(value.id)) {
						await this.localTestRequest({ action: value.command === 'localTestRun' ? 'run' : 'delete', id: value.id, edits: value.command === 'localTestRun' ? readLocalTestEdits(value.edits) : undefined });
					}
					return;
				case 'localTestAdd':
				case 'localTestSave':
					if (typeof value.input === 'string' && typeof value.output === 'string' && (value.command === 'localTestAdd' || typeof value.id === 'number' && Number.isSafeInteger(value.id))) {
						await this.localTestRequest({ action: value.command === 'localTestAdd' ? 'add' : 'update', input: value.input, output: value.output, id: typeof value.id === 'number' ? value.id : undefined });
					}
					return;
				case 'openWebsite': await openUrl(state.problem.url); return;
				case 'retryConnection': this.actions.retryConnection(); return;
				case 'loginConnection': await this.actions.login(); return;
				case 'ratingRefresh':
					if (connected) { await state.rating?.refresh(); }
					return;
				case 'rateProblem':
					if (connected && isRating(value.rating)) { await state.rating?.rate(value.rating); }
					return;
				case 'dismissRating':
					state.rating?.dismiss();
					return;
				case 'ready':
					void this.closeEmptyCompanionGroup();
					this.webviewReady = true;
					this.flushPendingUpdate();
					void this.localTestRequest({ action: 'load' });
					return;
				case 'dismissCompatibilityWarning':
					state.compatibilityWarningDismissed = true;
					this.render();
					return;
				case 'selectStatementVersion':
					if (typeof value.versionIndex !== 'number' || !Number.isInteger(value.versionIndex) || value.versionIndex < 0 || value.versionIndex > state.previousStatements.length) {
						return;
					}
					state.statementVersionIndex = value.versionIndex;
					this.renderedProblemRef = undefined;
					this.render();
					return;
				case 'deletePreviousStatement':
					{
						if (typeof value.versionIndex !== 'number' || !Number.isInteger(value.versionIndex) || value.versionIndex < 1 || value.versionIndex > state.previousStatements.length) {
							return;
						}
						const confirmed = await this.confirm(localize('确认删除当前旧版题面吗？'), localize('删除'), localize('取消'));
						if (!confirmed) {
							return;
						}
						state.previousStatements = await this.actions.deletePreviousStatement(state.problem, value.versionIndex - 1);
						if (state.statementVersionIndex === value.versionIndex) {
							state.statementVersionIndex = 0;
						} else if (state.statementVersionIndex > value.versionIndex) {
							state.statementVersionIndex--;
						}
						this.renderedProblemRef = undefined;
						this.render();
						return;
					}
				case 'answer':
					{
						if (typeof value.hintId !== 'string') {
							return;
						}
						const operationKey = `answer:${value.hintId}`;
						if (!this.beginOperation(state, operationKey)) {
							return;
						}
						try {
							const result = await this.actions.answer(state.problem, value.hintId);
							if (result.state === 'revealed') {
								state.answers.set(result.hintId, result.answer);
								state.hintMessages.delete(result.hintId);
								hintAnswerCache.set(hintAnswerCacheKey(state.problem.ref, result.hintId), result.answer);
								state.problem = applyAnswerLikes(state.problem, result);
							} else {
								const message = result.remainingMs > 0
									? `提示尚未解锁，剩余 ${formatDuration(result.remainingMs)}。`
									: '请先打开当前提示后再查看答案。';
								state.problem = applyHintLockRemaining(state.problem, result.hintId, result.remainingMs);
								(state.hintRemainingReceivedAtMs ??= new Map()).set(result.hintId, Date.now());
								state.hintMessages.set(result.hintId, message);
							}
						} finally {
							this.endOperation(state, operationKey);
						}
						break;
					}
				case 'openHint':
					if (typeof value.hintId !== 'string') {
						return;
					}
					{
						let hint = state.problem.state.hints.find(h => h.id === value.hintId);
						if (!hint) {
							return;
						}
						if (!hint.unlocked && !state.problem.state.timer.accepted) {
							const receivedAt = state.hintRemainingReceivedAtMs?.get(hint.id) ?? state.problem.state.timer.capturedAtUnixMs;
							if (!connected || hint.remainingMs > Math.max(0, Date.now() - receivedAt)) {
								return;
							}
							if (!this.beginOperation(state, 'refreshHints')) { return; }
							try {
								await this.actions.refreshHints(state.problem);
								if (this.state !== state) { return; }
								hint = state.problem.state.hints.find(h => h.id === value.hintId);
								if (!hint?.unlocked) { return; }
								this.render();
								void this.panel?.webview.postMessage({ type: 'expandHint', hintId: hint.id });
							} finally {
								this.endOperation(state, 'refreshHints');
							}
						}
						if (connected && state.problem.state.timer.accepted && !state.answers.has(hint.id)) {
							const operationKey = `answer:${hint.id}`;
							if (!this.beginOperation(state, operationKey)) {
								return;
							}
							try {
								const result = await this.actions.answer(state.problem, hint.id);
								if (result.state === 'revealed') {
									state.answers.set(result.hintId, result.answer);
									state.hintMessages.delete(result.hintId);
									hintAnswerCache.set(hintAnswerCacheKey(state.problem.ref, result.hintId), result.answer);
									state.problem = applyAnswerLikes(state.problem, result);
								} else {
									state.problem = applyHintLockRemaining(state.problem, result.hintId, result.remainingMs);
									(state.hintRemainingReceivedAtMs ??= new Map()).set(result.hintId, Date.now());
									state.hintMessages.set(result.hintId, result.remainingMs > 0
										? `提示尚未解锁，剩余 ${formatDuration(result.remainingMs)}。`
										: '网站尚未确认提示答案可查看。');
								}
							} finally {
								this.endOperation(state, operationKey);
							}
						}
					}
					break;
				case 'editorialLike':
				case 'like':
					if (typeof value.hintId !== 'string' || (value.target !== 'question' && value.target !== 'answer') || typeof value.liked !== 'boolean') {
						return;
					}
					{
						const operationKey = `like:${value.hintId}:${value.target}`;
						if (!this.beginOperation(state, operationKey)) {
							return;
						}
						try {
							const result = await this.actions.like(state.problem, value.hintId, value.target, value.liked);
							if (this.state !== state) {
								return;
							}
							state.problem = applyLikeResult(state.problem, result);
							if (state.editorial?.state === 'available') {
								state.editorial = applyEditorialLikeResult(state.editorial, result);
								state.cachedEditorial = state.editorial;
								void this.actions.saveEditorial(state.problem, state.editorial).catch(error => console.error('Failed to save ShortestPath OJ editorial likes.', error));
							}
							this.refreshEditorialLike(value.hintId, value.target);
                            void this.panel?.webview.postMessage({ type: 'hintLike', hintId: value.hintId, target: value.target, liked: result.liked, count: value.target === 'question' ? result.questionLikeCount : result.answerLikeCount });
						} finally {
							this.endOperation(state, operationKey);
						}
					}
					break;
				case 'editorialModal':
					if (state.editorial?.state === 'available') {
						await this.showEditorialPanel(state.editorial, state.problem, connected);
					}
					return;
				case 'editorial':
					{
						if (state.cachedEditorial?.state === 'available') {
							state.editorial = state.cachedEditorial;
							this.render();
							return;
						}
						if (!canRequestEditorial(connected)) {
							return;
						}
						if (this.editorialRequestInFlight) {
							return;
						}
						const remainingMs = this.getCurrentEditorialRemainingMs(state);
						if (!state.problem.state.timer.accepted && remainingMs > 0) {
							this.render();
							return;
						}
						this.editorialRequestInFlight = true;
						const editorialRequestToken = ++this.editorialRequestToken;
						this.render();
						try {
							const result = await this.actions.editorial(state.problem);
							if (!result || this.state !== state || this.editorialRequestToken !== editorialRequestToken) {
								return;
							}
							state.editorial = result;
							if (result.state === 'available') {
								state.cachedEditorial = result;
								void this.actions.saveEditorial(state.problem, result).catch(error => {
									console.error('Failed to save ShortestPath OJ editorial.', error);
									void vscode.window.showWarningMessage(localize('解题报告已打开，但未能保存到本地缓存；请稍后重新打开。'));
								});
							} else if (this.state === state && state.problem.ref === problemRef) {
								state.problem = applyEditorialLockRemaining(state.problem, result.remainingMs);
								state.editorialRemainingReceivedAtMs = Date.now();
							}
						} finally {
							if (this.editorialRequestToken === editorialRequestToken) {
								this.editorialRequestInFlight = false;
								this.render();
							}
						}
					}
					break;
				case 'submit':
					if (externalSubmission) {
						await this.actions.submit(state.problem);
						return;
					}
					if (!this.beginOperation(state, 'submit')) {
						return;
					}
					state.statusMessage = '正在通过网页提交；如浏览器出现安全验证，请在浏览器中完成。';
					this.render();
					try {
						await this.actions.submit(state.problem);
					} finally {
						this.endOperation(state, 'submit');
					}
					return;
				case 'correct':
					if (typeof value.submissionId === 'string') { await this.actions.correct(state.problem, value.submissionId); }
					return;
				case 'watchSubmission':
					if (typeof value.submissionId !== 'string' || !/^\d+$/.test(value.submissionId)) {
						throw new Error(localize('提交 ID 必须是十进制字符串。'));
					}
					{
						const operationKey = `watch:${value.submissionId}`;
						if (!this.beginOperation(state, operationKey)) {
							return;
						}
						try {
							await this.actions.watchSubmission(state.problem, value.submissionId);
							state.disconnectedSubmissions.delete(value.submissionId);
						} finally {
							this.endOperation(state, operationKey);
						}
					}
					break;
				case 'loadStress':
					if (!state.problem.capabilities.stress.supported) {
						return;
					}
					if (!this.beginOperation(state, 'loadStress')) {
						return;
					}
					try {
						state.stressContext = await this.actions.loadStress(state.problem);
						for (const task of state.stressContext.tasks) {
							state.stressTasks.set(task.taskId, task);
							state.disconnectedStressTasks.delete(task.taskId);
							if (isStressFinished(task.status)) {
								state.finishedStressTasks.add(task.taskId);
							}
						}
					} finally {
						this.endOperation(state, 'loadStress');
					}
					break;
				case 'startStress':
					if (!state.problem.capabilities.stress.supported) {
						return;
					}
					if (typeof value.submissionId !== 'string' || typeof value.rounds !== 'number' || !Number.isInteger(value.rounds) || value.rounds <= 0) {
						throw new Error(localize('请选择可用提交并填写正整数轮数。'));
					}
					if (!this.beginOperation(state, 'startStress')) {
						return;
					}
					try {
						if (!state.stressContext) {
							state.stressContext = await this.actions.loadStress(state.problem);
							for (const task of state.stressContext.tasks) {
								state.stressTasks.set(task.taskId, task);
								state.disconnectedStressTasks.delete(task.taskId);
								if (isStressFinished(task.status)) {
									state.finishedStressTasks.add(task.taskId);
								}
							}
						}
						if (!state.problem.target && this.unknownStressStarts.has(state.problem.ref)) {
							const choice = await this.confirm('上一次对拍启动结果未知。再次发起可能创建另一个任务，是否继续？', '继续', '取消');
							if (!choice) {
								return;
							}
							this.unknownStressStarts.delete(state.problem.ref);
						}
						{
							if (state.problem.target && !await this.confirm(state.stressContext.billingDescription, localize('确认发起'), localize('取消'))) { return; }
							const task = await this.actions.startStress(state.problem, value.submissionId, value.rounds);
							state.stressTasks.set(task.taskId, task);
							this.unknownStressStarts.delete(state.problem.ref);
						}
					} finally {
						this.endOperation(state, 'startStress');
					}
					break;
				case 'addStressCounterExample':
					if (typeof value.taskId !== 'string') {
						return;
					}
					{
						const task = state.stressTasks.get(value.taskId);
						if (!task?.counterExample || task.counterExampleTruncated || task.interactionTrace || !isStressFinished(task.status)) {
							throw new Error(localize('当前对拍任务还没有可添加的反例。'));
						}
						if (state.addingStressCounterExamples.has(task.taskId) || state.addedStressCounterExamples.has(task.taskId)) {
							return;
						}
						state.addingStressCounterExamples.add(task.taskId);
						try {
							await this.actions.addStressCounterExample(state.problem, task, state.sourcePath);
							await this.localTestRequest({ action: 'load' });
							state.addedStressCounterExamples.add(task.taskId);
						} finally {
							state.addingStressCounterExamples.delete(task.taskId);
						}
					}
					break;
				case 'confirmResult':
					if (typeof value.confirmId !== 'string') {
						return;
					}
					{
						const pending = this.pendingConfirms.get(value.confirmId);
						if (pending) {
							this.pendingConfirms.delete(value.confirmId);
							pending.resolve(value.result === true);
						}
					}
					return;
			}
			this.render();
		} catch (error) {
			if (this.state !== state) {
				return;
			}
			if ((value.command === 'like' || value.command === 'editorialLike') && typeof value.hintId === 'string') { void this.panel?.webview.postMessage({ type: 'hintLikeError', hintId: value.hintId, target: value.target }); }
			if (value.command === 'editorialLike' && typeof value.hintId === 'string') {
				void this.editorialPanel?.webview.postMessage({ type: 'editorialLikeError', hintId: value.hintId, target: value.target });
			}
			if (value.command === 'startStress' && error instanceof OutcomeUnknownError) {
				this.unknownStressStarts.add(state.problem.ref);
			}
			const message = error instanceof Error ? localize(error.message) : String(error);
			this.showOperationToast(message);
			if (value.command === 'submit') {
				state.statusMessage = state.connected ? '已连接题目网页。' : '正在重新连接…';
			}
			if ((value.command === 'answer' || value.command === 'openHint') && typeof value.hintId === 'string') {
				state.hintMessages.set(value.hintId, message);
			}
			this.render();
		}
	}

	setLongRunningOperationNotice(problemRef: string, active: boolean): void {
		if (!this.state || this.state.problem.ref !== problemRef) {
			return;
		}
		this.longRunningOperationNoticeCount = active
			? this.longRunningOperationNoticeCount + 1
			: Math.max(0, this.longRunningOperationNoticeCount - 1);
		const visible = this.longRunningOperationNoticeCount > 0;
		if (this.longRunningOperationNoticeVisible !== visible) {
			this.longRunningOperationNoticeVisible = visible;
			this.render();
		}
	}

	private showOperationToast(message: string): void {
		if (!message) {
			return;
		}
		this.operationToastMessage = message;
		if (this.operationToastTimer) {
			clearTimeout(this.operationToastTimer);
		}
		this.operationToastTimer = setTimeout(() => {
			this.operationToastMessage = undefined;
			this.operationToastTimer = undefined;
			this.render();
		}, 5_000);
		this.render();
	}

	private clearOperationToast(): void {
		if (this.operationToastTimer) {
			clearTimeout(this.operationToastTimer);
			this.operationToastTimer = undefined;
		}
		this.operationToastMessage = undefined;
	}

	private render(): void {
		if (!this.panel || !this.state) {
			return;
		}
		this.panel.title = `ShortestPath OJ: ${this.state.problem.title}`;
		const sections = renderProblemViewSections(
			this.state,
			this.longRunningOperationNoticeVisible,
			this.operationToastMessage,
			this.editorialRequestInFlight,
		);
		const timer = getProblemViewTimer(this.state);
		if (!this.sentSections || this.renderedProblemRef !== this.state.problem.ref) {
			// Full re-render: the webview reloads and must signal readiness before
			// incremental updates can be delivered.
			this.panel.webview.html = localizeWebviewHtml(getProblemWebviewHtml(this.state, sections, this.template, this.panel.webview, this.extensionUri));
			this.sentSections = sections;
			this.sentTimerJson = JSON.stringify(timer);
			this.pendingSections = undefined;
			this.pendingTimer = undefined;
			this.webviewReady = false;
			this.renderedProblemRef = this.state.problem.ref;
			return;
		}
		this.pendingSections = sections;
		this.pendingTimer = timer;
		this.flushPendingUpdate();
	}

	private flushPendingUpdate(): void {
		if (!this.panel || !this.webviewReady || !this.sentSections || !this.pendingSections || !this.pendingTimer) {
			return;
		}

		const changed: Record<string, string> = {};
		for (const key of Object.keys(problemViewSectionIds) as Array<keyof typeof problemViewSectionIds>) {
			if (this.pendingSections[key] !== this.sentSections[key]) {

				const html = this.pendingSections[key];
				changed[problemViewSectionIds[key]] = wrapTabSection(key, html);
			}
		}
		if (changed['oj-statement-content'] !== undefined) {
			changed['oj-local-tests-toolbar'] = this.pendingSections.localTestsToolbar;
			changed['oj-local-tests'] = this.pendingSections.localTests;
		}
		const timerJson = JSON.stringify(this.pendingTimer);
		if (Object.keys(changed).length === 0 && timerJson === this.sentTimerJson && this.pendingSections.connected === this.sentSections.connected) {
			return;
		}
		const sections = this.pendingSections;
		const timer = this.pendingTimer;
		this.sentSections = sections;
		this.sentTimerJson = timerJson;
		void this.panel.webview.postMessage({ type: 'update', sections: changed, connected: sections.connected, timer });
	}
}

class ShortestPathOjProblemPanels {
	private readonly panels = new Map<string, ShortestPathOjProblemPanel>();
	private active: ShortestPathOjProblemPanel | undefined;

	constructor(private readonly extensionUri: vscode.Uri, private readonly template: string, private readonly actions: ProblemPanelActions, private readonly unknownStressStarts: Set<string>) { }

	showProblem(problem: ImportedProblem, connected: boolean, sourcePath?: string, fromWebsite = false, restoredPanel?: vscode.WebviewPanel): void {
		const key = sourcePath ?? problem.ref;
		let child = this.panels.get(key);
		if (restoredPanel && child) { child.dispose(); this.panels.delete(key); child = undefined; }
		if (!child) {
			child = new ShortestPathOjProblemPanel(this.extensionUri, this.template, {
				...this.actions,
				activatePanel: () => {
					if (this.active !== child) {
						this.active = child;
						child?.reveal();
						this.actions.recover(child?.currentProblem ?? problem);
					}
				},
				sourceChanged: async (problem, previous, sourcePath) => {
					if (previous && this.panels.get(previous) === child) { this.panels.delete(previous); }
					this.panels.set(sourcePath, child!);
					await this.actions.sourceChanged?.(problem, previous, sourcePath);
				},
				recover: problem => { if (this.active === child) { this.actions.recover(problem); } },
				login: async () => { this.active = child; this.actions.recover(child?.currentProblem ?? problem); await this.actions.login(); },
				retryConnection: () => { this.active = child; this.actions.recover(child?.currentProblem ?? problem); this.actions.retryConnection(); },
				stopRecovery: () => { if (this.active === child) { this.actions.stopRecovery(); } },
			}, this.unknownStressStarts);
			this.panels.set(key, child);
		}
		this.active = child;
		if (restoredPanel) { child.restorePanel(restoredPanel); }
		child.showProblem(problem, connected, sourcePath, fromWebsite);
	}

	async hideProblemWhenSourceCloses(): Promise<void> {
		for (const [key, child] of this.panels) {
			if (await child.hideProblemWhenSourceCloses()) {
				child.dispose();
				this.panels.delete(key);
				if (this.active === child) { this.active = undefined; }
			}
		}
	}

	// Switching files hides the whole composite tab through the workbench, without closing it.
	async hideProblemForCph(_problemRef: string, _sourcePath?: string): Promise<void> { }
	updateProblemState(...args: Parameters<ShortestPathOjProblemPanel['updateProblemState']>): void { for (const child of this.panels.values()) { child.updateProblemState(...args); } }
	handleEvent(...args: Parameters<ShortestPathOjProblemPanel['handleEvent']>): void { for (const child of this.panels.values()) { child.handleEvent(...args); } }
	setDisconnected(ref: string): void { for (const child of this.panels.values()) { child.setDisconnected(ref); } }
	setRecoveryState(ref: string, state: RecoveryState): void { for (const child of this.panels.values()) { child.setRecoveryState(ref, state); } }
	setLongRunningOperationNotice(ref: string, active: boolean): void { for (const child of this.panels.values()) { child.setLongRunningOperationNotice(ref, active); } }
	registerSubmission(...args: Parameters<ShortestPathOjProblemPanel['registerSubmission']>): void { for (const child of this.panels.values()) { child.registerSubmission(...args); } }
	getTimerForJudger(url: string, sourcePath: string): ProblemState['timer'] | undefined { return this.panels.get(sourcePath)?.getTimerForJudger(url, sourcePath); }
	refreshEditorial(): void { for (const child of this.panels.values()) { child.refreshEditorial(); } }
	updateLocalTests(snapshot: LocalTestsSnapshot): void { for (const child of this.panels.values()) { child.updateLocalTests(snapshot); } }
	reloadStyles(version: number): void { for (const child of this.panels.values()) { child.reloadStyles(version); } }
	async restoreObservations(ref: string): Promise<void> { await Promise.all([...this.panels.values()].map(child => child.restoreObservations(ref))); }
	reveal(): void { this.active?.reveal(); }
	focusTab(...args: Parameters<ShortestPathOjProblemPanel['focusTab']>): void { this.active?.focusTab(...args); }
	forProblem(ref: string): ShortestPathOjProblemPanel | undefined { return [...this.panels.values()].find(child => child.problemRef === ref); }
	confirmForProblem(ref: string, ...args: Parameters<ShortestPathOjProblemPanel['confirm']>): Promise<boolean> { return this.forProblem(ref)?.confirm(...args) ?? Promise.resolve(false); }
	confirm(...args: Parameters<ShortestPathOjProblemPanel['confirm']>): Promise<boolean> { return this.active?.confirm(...args) ?? Promise.resolve(false); }
	dispose(): void { for (const child of this.panels.values()) { child.dispose(); } this.panels.clear(); }
}

export async function activate(context: vscode.ExtensionContext): Promise<{ bridge: ShortestPathOjLocalBridge; auxiliaryOperations: AuxiliaryOperationRecovery }> {
	workspaceCacheStorageRoot = context.storageUri ?? context.globalStorageUri;
	const activationStartedAt = Date.now();
	const output = vscode.window.createOutputChannel('ShortestPath OJ');
	const log = (message: string) => output.appendLine(`[+${Date.now() - activationStartedAt}ms] ${message}`);
	context.subscriptions.push(output);
	log('Activating extension.');
	const template = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'resources', 'problemView.html')));
	log('Problem view template loaded.');
	// The action closures are created before their bridge and panel dependencies are assigned.
	// eslint-disable-next-line prefer-const
	let bridge: ShortestPathOjLocalBridge;
	const correctionView = new CorrectionView();
	const auxiliaryOperations = new AuxiliaryOperationRecovery(context.workspaceState);
	context.subscriptions.push(correctionView);
	const unknownSubmissions = new Map<string, SubmissionAttempt>(Object.entries(context.workspaceState.get<Record<string, SubmissionAttempt>>('shortestpath.oj.pendingSubmissions.v2', {})));
	persistPendingSubmissionAttempts = async () => { await context.workspaceState.update('shortestpath.oj.pendingSubmissions.v2', Object.fromEntries([...unknownSubmissions].filter(([, attempt]) => attempt.accountId))); };
	const unknownStressStarts = new Set<string>();
	const restoringPanels = new Map<string, vscode.WebviewPanel>();
	const panel = new ShortestPathOjProblemPanels(context.extensionUri, template, {
		answer: (problem, hintId) => bridge.requestHintAnswer(problem.ref, hintId),
		refreshHints: async problem => {
			await bridgeHandlers.updateProblemState(problem.ref, await bridge.requestHintState(problem.ref));
		},
		recover: problem => {
			recovery.select(problem);
			void mutateWorkspaceProblemCache(cache => {
				cache.problems[problem.ref] ??= problem;
				touchWorkspaceProblemCache(cache, problem.ref);
			}, true).catch(error => console.error('Failed to record ShortestPath OJ cache use.', error));
		},
		stopRecovery: () => recovery.stop(),
		retryConnection: () => recovery.retry(),
		sourceChanged: async (problem, previous, sourcePath) => {
			await mutateWorkspaceProblemCache(cache => { cache.sourcePaths[problem.ref] = sourcePath; }, true);
			if (previous) { await vscode.commands.executeCommand('judger.rebindProblemSource', previous, sourcePath); }
		},
		login: () => recovery.login(),
		like: (problem, hintId, target, liked) => bridge.requestLike(problem.ref, hintId, target, liked),
		editorial: async problem => {
			let confirmed = false;
			if (shouldConfirmEditorial(problem)) {
				const result = await panel.confirmForProblem(problem.ref, getEditorialConfirmationMessage(problem), '确认查看', '取消');
				if (!result) {
					return undefined;
				}
				confirmed = true;
			}
			return bridge.requestEditorial(problem.ref, confirmed);
		},
		submit: async problem => {
			await submitProblem(problem, bridge, panel.forProblem(problem.ref) ?? panel, unknownSubmissions);
		},
		correct: async (problem, submissionId) => {
			const response = await bridge.requestAuxiliary(problem.ref, 'correction.context.request', { submissionId }) as { availability?: SubmissionCorrectionAvailability; latest?: { task?: SubmissionCorrectionTaskResponse['task'] } };
			if (response.latest?.task) {
				correctionView.show(response.latest.task);
				await bridge.requestAuxiliary(problem.ref, 'correction.watch.request', { taskId: String(response.latest.task.task_id) });
				if (!['exhausted', 'approach_wrong', 'unrelated_submission', 'stale', 'timeout', 'system_error'].includes(response.latest.task.status) || !await panel.confirmForProblem(problem.ref, localize('已有订正任务已结束，是否重新订正？'), localize('重新订正'), localize('取消'))) { return; }
			}
			const availability = response.availability;
			if (!availability || availability.state !== 'available' || availability.remaining_seconds > 0) { throw new Error(availability?.message ?? localize('AI 订正暂不可用。')); }
			const notice = `${availability.assistance_effect_description}\n${availability.cost_description}\n${localize('源码与题目内容将由外部 AI 服务处理，请确认继续。')}`;
			if (!await panel.confirmForProblem(problem.ref, notice, localize('确认订正'), localize('取消'))) { return; }
			const result = await auxiliaryOperations.start(bridge, problem, 'correction', submissionId, { policyVersion: 'ai-correction-v2', acknowledgedCost: true, acknowledgedRankingEffect: true }) as SubmissionCorrectionTaskResponse;
			correctionView.show(result.task);
		},
		loadRating: problem => bridge.requestAuxiliary(problem.ref, 'problem.rating.get.request', {}),
		saveRating: (problem, rating) => bridge.requestAuxiliary(problem.ref, 'problem.rating.set.request', { rating }, true),
		refreshHistory: async problem => {
			const result = await bridge.requestAuxiliary(problem.ref, 'submission.list.request', { page: 1 }) as SubmissionListResponse;
			for (const item of result.items) { await bridge.requestSubmissionWatch(problem.ref, String(item.id)); }
		},
		watchSubmission: async (problem, submissionId) => {
			await bridge.requestSubmissionWatch(problem.ref, submissionId);
		},
		loadStress: async problem => {
			const result = await bridge.requestStressContext(problem.ref);
			return problem.target ? auxiliaryOperations.restoreDiagnostics(bridge, problem, result) : result;
		},
		startStress: async (problem, submissionId, rounds) => {
			const result = problem.target
				? parseStressStartResult(await auxiliaryOperations.start(bridge, problem, 'diagnostic', submissionId, { acknowledgedCost: true }))
				: await bridge.requestStressStart(problem.ref, submissionId, rounds);
			return result.task;
		},
		addStressCounterExample: (problem, task, sourcePath) => addStressCounterExampleToLocalTests(problem, task, sourcePath),
		loadSubmissionHistory: problem => mutateWorkspaceProblemCache(cache => cache.submissions[problem.ref] ?? [], false),
		saveSubmissionHistory: (problem, submission) => mutateWorkspaceProblemCache(cache => {
			cache.submissions[problem.ref] = mergeSubmissionHistory(cache.submissions[problem.ref] ?? [], submission);
		}, true),
		loadEditorial: problem => mutateWorkspaceProblemCache(cache => cache.editorials[problem.ref], false),
		saveEditorial: (problem, editorial) => mutateWorkspaceProblemCache(cache => {
			if (editorial.state === 'available') {
				cache.editorials[problem.ref] = editorial;
			}
		}, true),
		loadPreviousStatements: problem => mutateWorkspaceProblemCache(cache => cache.previousStatements[problem.ref] ?? [], false),
		deletePreviousStatement: (problem, versionIndex) => mutateWorkspaceProblemCache(cache => {
			const versions = cache.previousStatements[problem.ref] ?? [];
			cache.previousStatements[problem.ref] = versions.filter((_, index) => index !== versionIndex);
			return cache.previousStatements[problem.ref];
		}, true),
	}, unknownStressStarts);
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.localTestsChanged', (value: unknown) => {
		const snapshot = readLocalTestsSnapshot(value);
		if (snapshot) { panel.updateLocalTests(snapshot); }
	}));
	context.subscriptions.push(panel, vscode.window.registerWebviewPanelSerializer('shortestpath.ojProblem', {
		async deserializeWebviewPanel(webviewPanel, state: unknown) {
			const identity = state as { problemRef?: unknown; sourcePath?: unknown } | undefined;
			const cache = await readWorkspaceProblemCache(typeof identity?.problemRef === 'string' ? identity.problemRef : undefined);
			const problem = typeof identity?.problemRef === 'string' ? cache.problems[identity.problemRef] : undefined;
			const ref = typeof identity?.problemRef === 'string' ? identity.problemRef : undefined;
			if (!ref || cache.sourcePaths[ref] !== identity?.sourcePath) { webviewPanel.dispose(); return; }
			if (!problem) {
				const recoveryContext = cache.recoveryContexts[ref];
				if (!recoveryContext) { webviewPanel.dispose(); return; }
				webviewPanel.webview.html = localizeWebviewHtml('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\';"></head><body><p role="status">正在重新连接…</p></body></html>');
				restoringPanels.set(ref, webviewPanel);
				context.subscriptions.push(webviewPanel.onDidDispose(() => { if (restoringPanels.get(ref) === webviewPanel) { restoringPanels.delete(ref); recovery.stop(ref); } }));
				context.subscriptions.push(webviewPanel.onDidChangeViewState(() => { if (webviewPanel.active && restoringPanels.get(ref) === webviewPanel) { recovery.select(recoveryContext); } }));
				recovery.select(recoveryContext);
				return;
			}
			panel.showProblem(problem, bridge.isBound(problem.ref), cache.sourcePaths[problem.ref], false, webviewPanel);
		},
	}));
	if (context.extensionMode === vscode.ExtensionMode.Development) {
		let styleVersion = Date.now();
		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(context.extensionUri, 'resources/problemView.css'));
		context.subscriptions.push(watcher);
		const reloadStyles = () => panel.reloadStyles(++styleVersion);
		context.subscriptions.push(watcher.onDidChange(reloadStyles), watcher.onDidCreate(reloadStyles));
		log('Development CSS hot reload enabled.');
	}
	// Loading Shiki can take long enough for the page's first WebSocket connection after a
	// wake URI to fail. Start the local bridge first and upgrade the renderer when ready.
	const codeTheme = new EditorCodeTheme(
		() => vscode.commands.executeCommand('_shortestpath.codeHighlightTheme'),
		getShikiTheme,
		() => {
			markdownContentCache = new WeakMap();
			panel.refreshEditorial();
		},
	);
	context.subscriptions.push(codeTheme);
	context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(() => { void codeTheme.refresh(); }));
	void codeTheme.refresh();
	void createProblemMarkdownRenderer(() => codeTheme.value).then(renderer => {
		renderProblemMarkdown = renderer;
		markdownContentCache = new WeakMap();
		panel.refreshEditorial();
		log('Problem Markdown renderer initialized.');
	}).catch(error => log(`Failed to initialize problem Markdown renderer: ${error instanceof Error ? error.message : String(error)}`));
	const bridgeHandlers: LocalBridgeHandlers = {
		async importProblem(problem, signal) {
			signal.throwIfAborted();
			await vscode.commands.executeCommand('shortestpath.mode.solve');
			await vscode.commands.executeCommand('workbench.action.focusWindow');
			if (!vscode.workspace.workspaceFolders?.length) {
				const folders = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, title: localize('选择代码保存文件夹'), openLabel: localize('使用此文件夹') });
				signal.throwIfAborted();
				if (!folders?.[0]) { throw new Error(workspaceFolderRequiredMessage); }
				await context.globalState.update('shortestpath.oj.pendingImport', { problem, folder: folders[0].toString(), createdAt: Date.now() });
				await vscode.commands.executeCommand('vscode.openFolder', folders[0], false);
				throw new Error(localize('正在打开代码保存文件夹，题目将自动恢复。'));
			}
			const { action, cph } = await mutateWorkspaceProblemCache(async cache => {
				signal.throwIfAborted();
				const action: ImportAction = cache.problems[problem.ref] ? 'updated' : 'created';
				const previous = cache.problems[problem.ref];
				const statementChanged = previous !== undefined && hasProblemStatementChanged(previous, problem);
				const previousSourcePath = cache.sourcePaths[problem.ref];
				if (previous && (statementChanged || previous.accountId !== problem.accountId || recoveryContext(previous) !== recoveryContext(problem))) {
					cache.previousStatements[problem.ref] = appendPreviousStatementVersion(cache.previousStatements[problem.ref] ?? [], previous);
					delete cache.submissions[problem.ref];
					delete cache.editorials[problem.ref];
					for (const hintId of hintAnswerCache.keys()) {
						if (hintId.startsWith(`${problem.ref}/`)) {
							hintAnswerCache.delete(hintId);
						}
					}
					unknownStressStarts.delete(problem.ref);
				}
				cache.problems[problem.ref] = problem;
				touchWorkspaceProblemCache(cache, problem.ref);
				let reusableSourcePath: string | undefined;
				if (previousSourcePath && canReuseProblemSource(previous, problem)) {
					try { reusableSourcePath = await validateWorkspaceSourcePath(previousSourcePath); } catch { /* A removed source needs a fresh import. */ }
				}
				const cph: CphImportResult = reusableSourcePath ? { succeeded: true, sourcePath: reusableSourcePath } : await forwardSamplesToCph(problem, previousSourcePath, signal);
				signal.throwIfAborted();
				if (cph.sourcePath) {
					cache.sourcePaths[problem.ref] = cph.sourcePath;
				}
				return { action, cph };
			}, true);
			if (!cph.succeeded) {
				output.appendLine(`ShortestPath Judger did not accept samples for ${problem.ref}.`);
			}
			return action;
		},
		async resumeProblem(problem) {
			await mutateWorkspaceProblemCache(cache => {
				const previous = cache.problems[problem.ref];
				if (previous && hasProblemStatementChanged(previous, problem)) { cache.previousStatements[problem.ref] = appendPreviousStatementVersion(cache.previousStatements[problem.ref] ?? [], previous); }
				cache.problems[problem.ref] = problem;
				touchWorkspaceProblemCache(cache, problem.ref);
			}, true);
		},
		async activateProblem(problem, resumed, isCurrent) {
			const sourcePath = (await readWorkspaceProblemCache(problem.ref)).sourcePaths[problem.ref];
			if (isCurrent && !isCurrent()) { return; }
			if (!resumed) {
				await vscode.commands.executeCommand('shortestpath.mode.solve');
				if (sourcePath) { await vscode.window.showTextDocument(vscode.Uri.file(sourcePath), { viewColumn: vscode.ViewColumn.One, preview: false }); }
				await vscode.commands.executeCommand('workbench.action.focusWindow');
			}
			const restoredPanel = restoringPanels.get(problem.ref);
			restoringPanels.delete(problem.ref);
			panel.showProblem(problem, true, sourcePath, true, restoredPanel);
		},
		async activateBoundProblem(problemRef) {
			const cache = await readWorkspaceProblemCache(problemRef);
			const problem = cache.problems[problemRef];
			if (!problem) { throw new Error(localize('当前连接尚未导入题目。')); }
			await bridgeHandlers.activateProblem?.(problem, false);
		},
		async updateProblemState(problemRef, state, capabilities) {
			const applied = await mutateWorkspaceProblemCache(cache => {
				const problem = cache.problems[problemRef];
				if (!problem) {
					throw new Error(localize('当前连接尚未导入题目。'));
				}
				if (hasIncompatibleProblemState(problem)) {
					return false;
				}
				cache.problems[problemRef] = applyProblemState(problem, state);
				if (capabilities) { cache.problems[problemRef].capabilities = capabilities; }
				return true;
			}, applied => applied);
			if (applied) {
				panel.updateProblemState(problemRef, state, capabilities);
			}
		},
		handleEvent(problemRef, event) {
			if (event.type === 'correction.snapshot') { correctionView.show(event.data.task); return; }
			panel.handleEvent(problemRef, event);
		},
		handleRecoveryStatus(problemRef, status) { recovery.websiteStatus(problemRef, status); },
		didBindProblem(problem, resumed) { recovery.connected(problem, resumed); void panel.restoreObservations(problem.ref); },
		handleDisconnect(problemRef) {
			correctionView.dispose();
			panel.setDisconnected(problemRef);
		},
	};
	bridge = new ShortestPathOjLocalBridge(bridgeHandlers, bridgePort, '127.0.0.1', 125_000, 1000, getAllowedBridgeOrigins());
	const recovery = new ConnectionRecovery({
		open: url => vscode.window.openBrowserTab(url, { hidden: true, preserveFocus: true }),
		prepare: problem => bridge.prepareRecovery(problem),
		cancel: () => bridge.cancelRecovery(),
		isBound: ref => bridge.isBound(ref),
		status: (ref, status) => panel.setRecoveryState(ref, status),
		returnToSolve: () => vscode.commands.executeCommand('shortestpath.mode.solve'),
	});
	context.subscriptions.push(recovery, vscode.window.onDidCloseBrowserTab(tab => recovery.pageClosed(tab.id)));
	context.subscriptions.push(
		bridge.onLongRunningRequest((problemRef, active) => panel.setLongRunningOperationNotice(problemRef, active)),
		bridge.onTrace(log),
	);
	bridge.onListening(() => log(`WebSocket bridge listening at ws://127.0.0.1:${bridgePort}/shortestpath-oj with shortestpath-oj-v2/v1.`));
	bridge.onError(error => {
		log(`WebSocket bridge error: ${error.message}`);
		if (isAddressInUseError(error)) {
			void vscode.window.showErrorMessage(localizeFormat('ShortestPath OJ 集成无法启动：端口 {0} 已被占用。请关闭占用该端口的程序后重启 ShortestPath IDE。', String(bridgePort)));
		}
	});
	context.subscriptions.push(new vscode.Disposable(() => { void bridge.close(); }));

	context.subscriptions.push(vscode.window.registerUriHandler({
		async handleUri(uri) {
			if (uri.authority === 'shortestpath.shortestpath-oj' && uri.path === '/wake') {
				log('Received ShortestPath OJ wake URI.');
				await vscode.commands.executeCommand('workbench.action.focusWindow');
			}
		},
	}));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.showProblem', () => panel.reveal()));
	const pendingImport = context.globalState.get<{ problem: ImportedProblem; folder: string; createdAt: number }>('shortestpath.oj.pendingImport');
	if (pendingImport && vscode.workspace.workspaceFolders?.[0]?.uri.toString() === pendingImport.folder) {
		void (async () => {
			await context.globalState.update('shortestpath.oj.pendingImport', undefined);
			if (Date.now() - pendingImport.createdAt > 5 * 60_000) { return; }
			await bridgeHandlers.importProblem(pendingImport.problem, new AbortController().signal);
			const sourcePath = (await readWorkspaceProblemCache()).sourcePaths[pendingImport.problem.ref];
			panel.showProblem(pendingImport.problem, false, sourcePath, true);
		})().catch(error => { void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)); });
	}
	const syncProblemPanelWithActiveTab = async (): Promise<void> => {
		await panel.hideProblemWhenSourceCloses();
	};
	const scheduleProblemPanelSync = () => {
		setTimeout(() => {
			void syncProblemPanelWithActiveTab();
		}, 0);
	};
	context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(scheduleProblemPanelSync));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.openIntegratedBrowser', async () => {
		await openUrl('https://shortestpath.cn/topics');
	}));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.openIntegratedBrowserDirect', async () => {
		await openUrl('https://shortestpath.cn/login');
	}));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.getTimerForJudger', async (url: string, sourcePath: string) => {
		const activeTimer = panel.getTimerForJudger(url, sourcePath);
		if (activeTimer) { return activeTimer; }
		const cache = await readWorkspaceProblemCache();
		const problem = Object.values(cache.problems).find(item => item.url === url && cache.sourcePaths[item.ref] === sourcePath);
		return problem ? { ...problem.state.timer } : undefined;
	}));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.showProblemForCph', async (url: string) => {
		const cache = await readWorkspaceProblemCache(cache => Object.values(cache.problems).find(item => item.url === url)?.ref);
		const problem = Object.values(cache.problems).find(item => item.url === url);
		if (problem) {
			panel.showProblem(problem, bridge.isBound(problem.ref), cache.sourcePaths[problem.ref]);
		} else {
			const recoveryContext = Object.values(cache.recoveryContexts).find(item => item.url === url);
			if (recoveryContext) { recovery.select(recoveryContext); }
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.hideProblemForCphSourcePath', async (sourcePath: string) => {
		const ref = findProblemRefForSourcePath((await readWorkspaceProblemCache()).sourcePaths, sourcePath);
		if (ref) {
			panel.hideProblemForCph(ref, sourcePath);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.submitProblem', async (problem: CphProblemForSubmission) => {
		await submitCphProblem(problem, bridge, panel, unknownSubmissions, identity => recovery.select(identity));
	}));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.submitProblemForUrl', async (url: string) => {
		const cache = await readWorkspaceProblemCache(cache => Object.values(cache.problems).find(item => item.url === url)?.ref);
		const problem = Object.values(cache.problems).find(item => item.url === url);
		if (!problem) {
			const identity = Object.values(cache.recoveryContexts).find(item => item.url === url);
			if (identity) { recovery.select(identity); throw new Error(localize('正在重新连接…')); }
			throw new Error(localize('请先将题目导入 ShortestPath Judger 再从题目面板提交。'));
		}
		await submitProblem(problem, bridge, panel.forProblem(problem.ref) ?? panel, unknownSubmissions);
	}));
	return { bridge, auxiliaryOperations };
}

function getWorkspaceCacheDirectoryUri(): vscode.Uri {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder || !workspaceCacheStorageRoot) {
		throw new Error(workspaceFolderRequiredMessage);
	}
	const key = createHash('sha256').update(workspaceFolder.uri.toString()).digest('hex');
	return vscode.Uri.joinPath(workspaceCacheStorageRoot, 'problem-cache', key);
}

function getLegacyWorkspaceCacheUri(directory = getWorkspaceCacheDirectoryUri()): vscode.Uri {
	return vscode.Uri.joinPath(directory, legacyWorkspaceCacheFileName);
}

function getWorkspaceProblemRecordUri(problemRef: string, directory = getWorkspaceCacheDirectoryUri()): vscode.Uri {
	return vscode.Uri.joinPath(directory, getWorkspaceProblemRecordFileName(problemRef));
}

function getWorkspaceSourceIndexUri(directory = getWorkspaceCacheDirectoryUri()): vscode.Uri {
	return vscode.Uri.joinPath(directory, '.source-paths.json');
}

/** Prefer private records while retaining identities and source bindings from older caches. */
function mergeWorkspaceProblemCaches(current: WorkspaceProblemCache, incoming: WorkspaceProblemCache): void {
	for (const [ref, sourcePath] of Object.entries(incoming.sourcePaths)) { current.sourcePaths[ref] ??= sourcePath; }
	for (const [ref, identity] of Object.entries(incoming.recoveryContexts)) { current.recoveryContexts[ref] ??= identity; }
	for (const [ref, problem] of Object.entries(incoming.problems)) {
		if (current.problems[ref]) { continue; }
		current.problems[ref] = problem;
		current.submissions[ref] = incoming.submissions[ref] ?? [];
		current.editorials[ref] = incoming.editorials[ref];
		current.previousStatements[ref] = incoming.previousStatements[ref] ?? [];
		current.lastUsedAt[ref] = incoming.lastUsedAt[ref] ?? 0;
	}
}

/** Move verified extension-owned records out of the project without deleting unrelated files. */
async function ensureWorkspaceCacheLocationMigration(destination: vscode.Uri, source: vscode.Uri): Promise<void> {
	if (workspaceCacheLocationsMigrated.has(destination.toString())) { return; }
	try {
		if ((await vscode.workspace.fs.stat(source)).type !== vscode.FileType.Directory) { workspaceCacheLocationsMigrated.add(destination.toString()); return; }
	} catch (error) {
		if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') { workspaceCacheLocationsMigrated.add(destination.toString()); return; }
		throw error;
	}
	const incoming = await readWorkspaceProblemCacheFiles(source);
	let legacy: WorkspaceProblemCache | undefined;
	try { legacy = await readLegacyWorkspaceProblemCache(source); }
	catch (error) { console.warn(`Unable to relocate ${legacyWorkspaceCacheFileName}; leaving it unchanged.`, error); }
	const files = new Map<string, string>();
	for (const [ref, content] of workspaceCacheRecordContents.get(incoming) ?? []) { files.set(workspaceCacheRecordLocations.get(incoming)?.get(ref) ?? path.join(problemRecordRoot(source), getWorkspaceProblemRecordFileName(ref)), content); }
	const sourceContent = workspaceCacheSourceContents.get(incoming);
	if (sourceContent !== undefined) { files.set(path.join(problemRecordRoot(source), '.source-paths.json'), sourceContent); }
	if (legacy) {
		mergeWorkspaceProblemCaches(incoming, legacy);
		files.set(path.join(problemRecordRoot(source), legacyWorkspaceCacheFileName), workspaceCacheLegacyContents.get(legacy)!);
	}
    // Remove the published index only when every indexed record is recognized and copied.
    try {
        const indexPath = path.join(problemRecordRoot(source), 'oj-index.json');
        const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(problemRecordUri(source, indexPath)));
        const index = JSON.parse(content) as Array<{ problemRef: string; path: string }>;
        if (Array.isArray(index) && index.every(entry => typeof entry.problemRef === 'string' && typeof entry.path === 'string'
            && workspaceCacheRecordLocations.get(incoming)?.get(entry.problemRef) === path.resolve(problemRecordRoot(source), entry.path))) {
            files.set(indexPath, content);
        }
    } catch (error) {
        if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) { console.warn('Leaving unreadable OJ index unchanged.', error); }
    }
	if (files.size > 0) {
		const current = await readWorkspaceProblemCacheFiles(destination);
		mergeWorkspaceProblemCaches(current, incoming);
		// Keep every migrated snapshot until the initiating operation records its selected problem.
		await writeWorkspaceProblemCache(current, false, destination);
		const expected = new Map<string, string>([['.source-paths.json', workspaceCacheSourceContents.get(current)!]]);
		for (const [ref, content] of workspaceCacheRecordContents.get(current) ?? []) { expected.set(getWorkspaceProblemRecordFileName(ref), content); }
		for (const [name, content] of expected) {
			const saved = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(destination, name)));
			if (saved !== content) { throw new Error('cache_relocation_verification_failed'); }
		}
		// A second IDE may still be writing the project cache. Never remove changed source data.
		for (const [name, content] of files) {
			const original = new TextDecoder().decode(await vscode.workspace.fs.readFile(problemRecordUri(source, name)));
			if (original !== content) { throw new Error('cache_relocation_source_changed'); }
		}
		for (const name of files.keys()) { await vscode.workspace.fs.delete(problemRecordUri(source, name), { recursive: false, useTrash: false }); }
	}
	try {
		if ((await vscode.workspace.fs.readDirectory(source)).length === 0) { await vscode.workspace.fs.delete(source, { recursive: false, useTrash: false }); }
	} catch (error) { if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) { throw error; } }
	workspaceCacheLocationsMigrated.add(destination.toString());
}

function createEmptyWorkspaceProblemCache(): WorkspaceProblemCache {
	return {
		version: 4,
		problems: Object.create(null) as Record<string, ImportedProblem>,
		sourcePaths: Object.create(null) as Record<string, string>,
		submissions: Object.create(null) as Record<string, SubmissionHistoryEntry[]>,
		editorials: Object.create(null) as Record<string, EditorialResult>,
		previousStatements: Object.create(null) as Record<string, ProblemStatementSnapshot[]>,
		lastUsedAt: Object.create(null) as Record<string, number>,
		recoveryContexts: Object.create(null) as Record<string, WorkspaceProblemRecoveryContext>,
	};
}

function readWorkspaceProblemCache(access?: string | ((cache: WorkspaceProblemCache) => string | undefined)): Promise<WorkspaceProblemCache> {
	return mutateWorkspaceProblemCache(cache => {
		const ref = typeof access === 'function' ? access(cache) : access;
		if (ref && touchWorkspaceProblemCache(cache, ref)) { workspaceCachesNeedingRewrite.add(cache); }
		return cache;
	}, false);
}

async function ensureWorkspaceCacheMigration(directory: vscode.Uri, source: vscode.Uri): Promise<void> {
	if (workspaceCacheMigration) {
		await workspaceCacheMigration;
		return;
	}
	const migration = (async () => {
		await ensureWorkspaceCacheLocationMigration(directory, source);
		await migrateLegacyWorkspaceCache({
			readCurrent: () => readWorkspaceProblemCacheFiles(directory),
			readLegacy: async () => {
				try {
					return await readLegacyWorkspaceProblemCache(directory);
				} catch (error) {
					console.warn(`Unable to migrate ${legacyWorkspaceCacheFileName}; leaving it unchanged.`, error);
					return undefined;
				}
			},
			merge: (cache, legacyCache) => {
				mergeWorkspaceProblemCaches(cache, legacyCache);
				return cache;
			},
			// Apply the limit after the initiating read has marked its selected problem.
			writeCurrent: cache => writeWorkspaceProblemCache(cache, false, directory),
			deleteLegacy: async () => {
				try {
					await vscode.workspace.fs.delete(getLegacyWorkspaceCacheUri(directory), { recursive: false, useTrash: false });
				} catch (error) {
					if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') {
						throw error;
					}
				}
			},
		});
	})();
	workspaceCacheMigration = migration;
	try {
		await migration;
	} finally {
		if (workspaceCacheMigration === migration) {
			workspaceCacheMigration = undefined;
		}
	}
}

function problemRecordRoot(directory: vscode.Uri): string {
    return directory.scheme === 'file' ? directory.fsPath : directory.path;
}

function problemRecordUri(directory: vscode.Uri, file: string): vscode.Uri {
    return directory.scheme === 'file' ? vscode.Uri.file(file) : directory.with({ path: file.replace(/\\/g, '/') });
}

function problemRecordFileSystem(directory: vscode.Uri): ProblemRecordFileSystem {
    const uri = (file: string) => problemRecordUri(directory, file);
    return {
        readDirectory: async file => vscode.workspace.fs.readDirectory(uri(file)),
        readFile: async file => vscode.workspace.fs.readFile(uri(file)),
        writeFile: async (file, contents) => vscode.workspace.fs.writeFile(uri(file), contents),
        rename: async (from, to) => vscode.workspace.fs.rename(uri(from), uri(to), { overwrite: true }),
        delete: async file => vscode.workspace.fs.delete(uri(file), { recursive: false, useTrash: false }),
        isMissing: error => error instanceof vscode.FileSystemError && error.code === 'FileNotFound',
    };
}

async function readWorkspaceProblemCacheFiles(directory = getWorkspaceCacheDirectoryUri()): Promise<WorkspaceProblemCache> {
	try {
		const cache = createEmptyWorkspaceProblemCache();
		const recordContents = new Map<string, string>();
		workspaceCacheRecordContents.set(cache, recordContents);
		try {
			const sourceContent = new TextDecoder().decode(await vscode.workspace.fs.readFile(getWorkspaceSourceIndexUri(directory)));
			const sourceIndex = JSON.parse(sourceContent) as { sourcePaths?: Record<string, unknown>; recoveryContexts?: Record<string, unknown> };
			const sourcePaths = sourceIndex.sourcePaths ?? sourceIndex as Record<string, unknown>;
			for (const [ref, sourcePath] of Object.entries(sourcePaths)) {
				if (typeof sourcePath === 'string' && isValidSourcePath(sourcePath)) { cache.sourcePaths[ref] = sourcePath; }
			}
			for (const [ref, value] of Object.entries(sourceIndex.recoveryContexts ?? {})) {
				const recoveryContext = readWorkspaceProblemRecoveryContext(value);
				if (recoveryContext?.ref === ref) { cache.recoveryContexts[ref] = recoveryContext; }
			}
			workspaceCacheSourceContents.set(cache, sourceContent);
		} catch (error) {
			if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) { console.warn('Unable to read ShortestPath OJ source index; recovering associations from snapshots.', error); }
		}
		let needsRewrite = false;
		const locations = new Map<string, string>();
        workspaceCacheRecordLocations.set(cache, locations);
        const entries = await listProblemRecords(problemRecordRoot(directory), problemRecordFileSystem(directory));
        for (const entry of entries) {
            const name = entry.name;
            const type = vscode.FileType.File;
			if (type !== vscode.FileType.File || name === legacyWorkspaceCacheFileName || name === '.source-paths.json' || !name.endsWith('.json')) {
				continue;
			}
			try {
				const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(problemRecordUri(directory, entry.file)));
				if (!content.trim()) {
					continue;
				}
				const record = JSON.parse(content) as Partial<WorkspaceProblemRecord>;
				if ((record.version !== 1 && record.version !== workspaceProblemRecordVersion) || !record.problem || typeof record.problem !== 'object') {
					continue;
				}
				const problem = restoreCachedProblemCompatibilityWarnings(record.problem as ImportedProblem);
				if (name !== `${entry.legacy ? '' : 'oj-'}${getWorkspaceProblemRecordFileName(problem.ref)}`) {
					console.warn(`Ignoring ShortestPath OJ cache record with mismatched file name: ${name}`);
					continue;
				}
				cache.problems[problem.ref] = problem;
				recordContents.set(problem.ref, content);
                locations.set(problem.ref, entry.file);
				if (typeof record.lastUsedAt === 'number' && Number.isFinite(record.lastUsedAt) && record.lastUsedAt >= 0) {
					cache.lastUsedAt[problem.ref] = record.lastUsedAt;
				} else {
					cache.lastUsedAt[problem.ref] = (await vscode.workspace.fs.stat(problemRecordUri(directory, entry.file))).mtime;
					needsRewrite = true;
				}
				if (typeof record.sourcePath === 'string' && isValidSourcePath(record.sourcePath)) {
					cache.sourcePaths[problem.ref] = record.sourcePath;
				} else if (record.sourcePath !== undefined) {
					needsRewrite = true;
				}
				const submissions = sanitizeSubmissionHistory(record.submissions);
				cache.submissions[problem.ref] = submissions.entries;
				const previousStatements = sanitizeProblemStatementVersions(record.previousStatements);
				cache.previousStatements[problem.ref] = previousStatements.versions;
				if (record.editorial !== undefined) {
					try {
						const editorial = parseEditorialResult(record.editorial);
						if (editorial.state === 'available') {
							cache.editorials[problem.ref] = editorial;
						}
					} catch (error) {
						console.warn(`Ignoring invalid cached ShortestPath OJ editorial: ${name}`, error);
						needsRewrite = true;
					}
				}
				needsRewrite ||= record.version !== workspaceProblemRecordVersion || problem !== record.problem || submissions.changed || previousStatements.changed;
			} catch (error) {
				console.warn(`Ignoring unreadable ShortestPath OJ cache record: ${name}`, error);
			}
		}
		if (needsRewrite) {
			workspaceCachesNeedingRewrite.add(cache);
		}
		return cache;
	} catch (error) {
		if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
			return createEmptyWorkspaceProblemCache();
		}
		throw error;
	}
}

async function readLegacyWorkspaceProblemCache(directory = getWorkspaceCacheDirectoryUri()): Promise<WorkspaceProblemCache | undefined> {
	try {
		const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(getLegacyWorkspaceCacheUri(directory)));
		if (!content.trim()) {
			return undefined;
		}
		const value = JSON.parse(content) as CachedWorkspaceProblemCache;
		if (value.version !== 3 && value.version !== 4) {
			console.warn(`ShortestPath OJ cache ${legacyWorkspaceCacheFileName} has unsupported version and was left unchanged.`);
			return undefined;
		}
		const problems = Object.create(null) as Record<string, ImportedProblem>;
		const sourcePaths = Object.create(null) as Record<string, string>;
		const submissions = Object.create(null) as Record<string, SubmissionHistoryEntry[]>;
		const editorials = Object.create(null) as Record<string, EditorialResult>;
		const previousStatements = Object.create(null) as Record<string, ProblemStatementSnapshot[]>;
		let historyWasSanitized = false;
		if (value.problems && typeof value.problems === 'object') {
			for (const [problemRef, cachedProblem] of Object.entries(value.problems)) {
				const problem = restoreCachedProblemCompatibilityWarnings(cachedProblem as ImportedProblem);
				if (problem.ref !== problemRef) {
					throw new Error(localizeFormat('旧题目缓存的键 {0} 与题目路径 {1} 不一致。', problemRef, problem.ref));
				}
				problems[problemRef] = problem;
				if (problem !== cachedProblem) {
					historyWasSanitized = true;
				}
			}
		}
		if (value.sourcePaths && typeof value.sourcePaths === 'object') {
			for (const [problemRef, sourcePath] of Object.entries(value.sourcePaths)) {
				if (typeof sourcePath === 'string' && isValidSourcePath(sourcePath)) {
					sourcePaths[problemRef] = sourcePath;
				} else {
					historyWasSanitized = true;
				}
			}
		}
		if (value.version === 4 && value.submissions && typeof value.submissions === 'object') {
			for (const [problemRef, entries] of Object.entries(value.submissions)) {
				if (Array.isArray(entries)) {
					const sanitizedEntries = entries.map(sanitizeSubmissionHistoryEntry).filter((entry): entry is SubmissionHistoryEntry => entry !== undefined);
					if (sanitizedEntries.length !== entries.length || entries.some((entry, index) => JSON.stringify(entry) !== JSON.stringify(sanitizedEntries[index]))) {
						historyWasSanitized = true;
					}
					submissions[problemRef] = sanitizedEntries;
				} else {
					historyWasSanitized = true;
				}
			}
		}
		if (value.editorials && typeof value.editorials === 'object') {
			for (const [ref, result] of Object.entries(value.editorials)) {
				try { const editorial = parseEditorialResult(result); if (editorial.state === 'available') { editorials[ref] = editorial; } }
				catch { historyWasSanitized = true; }
			}
		}
		if (value.previousStatements && typeof value.previousStatements === 'object') {
			for (const [ref, snapshots] of Object.entries(value.previousStatements)) { previousStatements[ref] = sanitizeProblemStatementVersions(snapshots).versions; }
		}
		const cache: WorkspaceProblemCache = {
			version: 4,
			problems,
			sourcePaths,
			submissions,
			editorials,
			previousStatements,
			lastUsedAt: Object.create(null) as Record<string, number>,
			recoveryContexts: Object.create(null) as Record<string, WorkspaceProblemRecoveryContext>,
		};
		for (const [ref, time] of Object.entries(value.lastUsedAt ?? {})) { if (typeof time === 'number' && Number.isFinite(time) && time >= 0) { cache.lastUsedAt[ref] = time; } }
		for (const [ref, identity] of Object.entries(value.recoveryContexts ?? {})) { const parsed = readWorkspaceProblemRecoveryContext(identity); if (parsed?.ref === ref) { cache.recoveryContexts[ref] = parsed; } }
		if (historyWasSanitized) {
			workspaceCachesNeedingRewrite.add(cache);
		}
		workspaceCacheLegacyContents.set(cache, content);
		return cache;
	} catch (error) {
		if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
			return undefined;
		}
		throw error;
	}
}

function sanitizeSubmissionHistory(value: unknown): { entries: SubmissionHistoryEntry[]; changed: boolean } {
	if (!Array.isArray(value)) {
		return { entries: [], changed: true };
	}
	const entries = value.map(sanitizeSubmissionHistoryEntry).filter((entry): entry is SubmissionHistoryEntry => entry !== undefined);
	return {
		entries,
		changed: entries.length !== value.length || value.some((entry, index) => JSON.stringify(entry) !== JSON.stringify(entries[index])),
	};
}

async function writeWorkspaceProblemCache(cache: WorkspaceProblemCache, enforceLimit = true, directory = getWorkspaceCacheDirectoryUri()): Promise<void> {
	await vscode.workspace.fs.createDirectory(directory);
	assertUniqueWorkspaceProblemRecordFileNames(Object.keys(cache.problems));
	const evictions = new Set(enforceLimit ? getWorkspaceProblemCacheEvictions(cache) : []);
	for (const [ref, problem] of Object.entries(cache.problems)) { cache.recoveryContexts[ref] = getWorkspaceProblemRecoveryContext(problem); }
	const sourceContent = `${JSON.stringify({ sourcePaths: cache.sourcePaths, recoveryContexts: cache.recoveryContexts }, undefined, '\t')}\n`;
	if (workspaceCacheSourceContents.get(cache) !== sourceContent) {
		await vscode.workspace.fs.writeFile(getWorkspaceSourceIndexUri(directory), new TextEncoder().encode(sourceContent));
		workspaceCacheSourceContents.set(cache, sourceContent);
	}
	const recordContents = workspaceCacheRecordContents.get(cache) ?? new Map<string, string>();
	const writes = await Promise.allSettled(Object.entries(cache.problems).filter(([ref]) => !evictions.has(ref)).map(async ([problemRef, problem]) => {
		const record: WorkspaceProblemRecord = {
			version: workspaceProblemRecordVersion,
			problem,
			sourcePath: cache.sourcePaths[problemRef],
			submissions: cache.submissions[problemRef] ?? [],
			editorial: cache.editorials[problemRef],
			previousStatements: cache.previousStatements[problemRef] ?? [],
			lastUsedAt: cache.lastUsedAt[problemRef] ?? 0,
		};
		const content = `${JSON.stringify(record, undefined, '\t')}\n`;
		if (recordContents.get(problemRef) !== content) {
			await vscode.workspace.fs.writeFile(getWorkspaceProblemRecordUri(problemRef, directory), new TextEncoder().encode(content));
			recordContents.set(problemRef, content);
		}
	}));
	for (const result of writes) { if (result.status === 'rejected') { throw result.reason; } }
	for (const ref of evictions) {
		try { await vscode.workspace.fs.delete(getWorkspaceProblemRecordUri(ref, directory)); }
		catch (error) { if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) { throw error; } }
		delete cache.problems[ref];
		delete cache.submissions[ref];
		delete cache.editorials[ref];
		delete cache.previousStatements[ref];
		delete cache.lastUsedAt[ref];
		recordContents.delete(ref);
		for (const key of hintAnswerCache.keys()) { if (key.startsWith(`${ref}/`)) { hintAnswerCache.delete(key); } }
	}
	workspaceCacheRecordContents.set(cache, recordContents);
	workspaceCachesNeedingRewrite.delete(cache);
}

function mutateWorkspaceProblemCache<T>(mutation: (cache: WorkspaceProblemCache) => T | Promise<T>, alwaysWrite: boolean | ((result: T) => boolean)): Promise<T> {
	const operation = workspaceCacheMutationTail.then(async () => {
		const directory = getWorkspaceCacheDirectoryUri();
		const source = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, workspaceCacheDirectoryName);
		await ensureWorkspaceCacheMigration(directory, source);
		const cache = await readWorkspaceProblemCacheFiles(directory);
		const result = await mutation(cache);
		if ((typeof alwaysWrite === 'function' ? alwaysWrite(result) : alwaysWrite) || workspaceCachesNeedingRewrite.has(cache) || getWorkspaceProblemCacheEvictions(cache).length > 0) {
			await writeWorkspaceProblemCache(cache, true, directory);
		}
		return result;
	});
	workspaceCacheMutationTail = operation.then(() => undefined, () => undefined);
	return operation;
}

async function submitCphProblem(
	value: CphProblemForSubmission,
	bridge: ShortestPathOjLocalBridge,
	panel: ShortestPathOjProblemPanels,
	unknownSubmissions: Map<string, SubmissionAttempt>,
	recover?: (identity: WorkspaceProblemRecoveryContext) => void,
): Promise<void> {
	if (typeof value.url !== 'string' || typeof value.srcPath !== 'string') {
		throw new Error(localize('当前 CPH 活动题目不是 ShortestPath OJ 题目。'));
	}
	const cache = await readWorkspaceProblemCache(cache => Object.values(cache.problems).find(item => item.url === value.url)?.ref);
	const problem = Object.values(cache.problems).find(item => item.url === value.url);
	if (!problem) {
		const identity = Object.values(cache.recoveryContexts).find(item => item.url === value.url);
		if (identity && recover) { recover(identity); throw new Error(localize('正在重新连接…')); }
		throw new Error(localize('当前 CPH 活动题目不是 ShortestPath OJ 题目。'));
	}
	await submitProblem(problem, bridge, panel.forProblem(problem.ref) ?? panel, unknownSubmissions, value.srcPath);
}

function recoveryContext(problem: ImportedProblem): string {
	return JSON.stringify([new URL(problem.url).origin, problem.accountId, problem.target ?? problem.ref]);
}

async function submitProblem(
	problem: ImportedProblem,
	bridge: ShortestPathOjLocalBridge,
	panel: Pick<ShortestPathOjProblemPanel, 'confirm' | 'registerSubmission' | 'focusTab'>,
	unknownSubmissions: Map<string, SubmissionAttempt>,
	explicitSourcePath?: string,
): Promise<void> {
	if (problem.target?.kind === 'contest') {
		const content = problem.publicContent;
		const sourceUrl = content && 'source_url' in content ? content.source_url : undefined;
		if (typeof sourceUrl === 'string' && /^https?:\/\//.test(sourceUrl)) {
			await vscode.env.openExternal(vscode.Uri.parse(sourceUrl));
		}
		return;
	}
	if (!problem.capabilities.submission.enabled || problem.capabilities.submission.languages.length === 0) {
		throw new Error(localize('网页未提供可用的提交语言，无法发起提交。'));
	}
	if (!bridge.isBound(problem.ref)) {
		throw new Error(localize('正在恢复题目连接，请稍后重试。'));
	}
	let retry = unknownSubmissions.get(recoveryContext(problem));
	if (retry && (retry.accountId !== problem.accountId || retry.contextKey !== recoveryContext(problem))) {
		unknownSubmissions.delete(recoveryContext(problem));
		await persistPendingSubmissionAttempts();
		retry = undefined;
	}
	if (retry) {
		if (problem.target) {
			const receipt = await bridge.requestAuxiliary(problem.ref, 'operation.status.request', { kind: 'submission', operationId: retry.operationId }) as { state: string; submission_id?: number };
			if (receipt.state === 'applied' && receipt.submission_id) {
				await bridge.requestSubmissionWatch(problem.ref, String(receipt.submission_id));
				unknownSubmissions.delete(recoveryContext(problem));
				await persistPendingSubmissionAttempts();
				panel.focusTab('submissions');
				return;
			}
		}
		const choice = await panel.confirm(`上一次提交结果未知。重试将原样提交 ${retry.sourcePath}，并复用同一个操作 ID。`, '重试', '新建提交');
		if (choice) {
			await sendSubmissionAttempt(problem, bridge, panel, unknownSubmissions, retry);
			return;
		}
		unknownSubmissions.delete(recoveryContext(problem));
	}
	const sourcePath = explicitSourcePath ?? (await readWorkspaceProblemCache()).sourcePaths[problem.ref];
	if (!sourcePath) {
		throw new Error(localize('请先将题目导入 ShortestPath Judger 再从题目面板提交。'));
	}
	const safeSourcePath = await validateWorkspaceSourcePath(sourcePath);
	let document: vscode.TextDocument | undefined;
	for (const open of vscode.workspace.textDocuments) {
		if (open.uri.scheme !== 'file') { continue; }
		try { if (await fs.realpath(open.uri.fsPath) === safeSourcePath) { document = open; break; } } catch { /* Closed or removed files cannot be submitted. */ }
	}
	document ??= await vscode.workspace.openTextDocument(vscode.Uri.file(path.resolve(sourcePath)));
	if (!(await document.save())) {
		throw new Error(localize('提交前请先保存源文件。'));
	}
	const sourceCode = document.getText();
	if (!sourceCode.trim()) {
		throw new Error(localize('源文件为空。'));
	}
	const language = await selectSubmissionLanguage(problem.capabilities.submission.languages, safeSourcePath);
	if (!language) {
		return;
	}
	const attempt: SubmissionAttempt = {
		accountId: problem.accountId,
		contextKey: recoveryContext(problem),
		operationId: randomUUID(),
		language: language.id,
		sourceCode,
		sourcePath: safeSourcePath,
	};
	await sendSubmissionAttempt(problem, bridge, panel, unknownSubmissions, attempt);
}

async function sendSubmissionAttempt(
	problem: ImportedProblem,
	bridge: ShortestPathOjLocalBridge,
	panel: Pick<ShortestPathOjProblemPanel, 'confirm' | 'registerSubmission' | 'focusTab'>,
	unknownSubmissions: Map<string, SubmissionAttempt>,
	attempt: SubmissionAttempt,
): Promise<void> {
	unknownSubmissions.set(recoveryContext(problem), attempt);
	await persistPendingSubmissionAttempts();
	let result;
	try {
		result = await bridge.requestSubmission(problem.ref, attempt.operationId, attempt.language, attempt.sourceCode);
		unknownSubmissions.delete(recoveryContext(problem));
		await persistPendingSubmissionAttempts();
	} catch (error) {
		if (!(error instanceof OutcomeUnknownError)) {
			unknownSubmissions.delete(recoveryContext(problem));
			await persistPendingSubmissionAttempts();
		}
		throw error;
	}
	panel.registerSubmission(problem.ref, {
		submissionId: result.submissionId,
		language: result.language,
		status: result.status,
		score: 0,
		maxTimeMs: 0,
		maxMemoryKB: 0,
		judgedAt: null,
		details: [],
	}, result.message);
	panel.focusTab('submissions');
}

async function validateWorkspaceSourcePath(sourcePath: string): Promise<string> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders?.length) {
		throw new Error(localize('提交源码必须位于当前工作区。'));
	}
	const realSourcePath = await fs.realpath(path.resolve(sourcePath));
	for (const folder of workspaceFolders) {
		if (folder.uri.scheme !== 'file') {
			continue;
		}
		const realWorkspacePath = await fs.realpath(folder.uri.fsPath);
		const relative = path.relative(realWorkspacePath, realSourcePath);
		if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
			return realSourcePath;
		}
	}
	throw new Error(localizeFormat('拒绝提交工作区之外的文件：{0}', realSourcePath));
}

async function selectSubmissionLanguage(languages: SubmissionLanguage[], sourcePath: string): Promise<SubmissionLanguage | undefined> {
	const extension = sourcePath.toLowerCase().split('.').pop();
	const configured = vscode.workspace.getConfiguration('shortestpath.oj').get<string>('cppSubmissionLanguage', 'cpp20');
	if (extension === 'cpp' && configured !== 'ask') {
		const configuredLanguage = languages.find(language => language.id === configured);
		if (configuredLanguage) {
			return configuredLanguage;
		}
	}
	if (languages.length === 1) {
		return languages[0];
	}
	const selected = await vscode.window.showQuickPick(
		languages.map(language => ({ label: language.name, description: language.compileArgs, language })),
		{ title: localize('选择 ShortestPath OJ 提交语言'), placeHolder: localize('使用网站当前提供的语言') },
	);
	return selected?.language;
}

function forwardSamplesToCph(problem: ImportedProblem, sourcePath: string | undefined, signal: AbortSignal): Promise<CphImportResult> {
	signal.throwIfAborted();
	const parts = problem.ref.split('/');
	const payload = JSON.stringify({
		name: problem.title,
		url: problem.url,
		interactive: Boolean(problem.publicContent?.interaction),
		memoryLimit: problem.limits.memoryMB,
		timeLimit: problem.limits.timeMs,
		group: parts.slice(0, -1).join('/'),
		tests: problem.localTest?.enabled === false ? [] : problem.samples.map(sample => ({ input: sample.input, output: sample.output })),
	});
	return new Promise(resolve => {
		let settled = false;
		// The callbacks close over these handles before they are initialized.
		// eslint-disable-next-line prefer-const
		let timeout: ReturnType<typeof setTimeout> | undefined;
		// eslint-disable-next-line prefer-const
		let request: http.ClientRequest;
		const abort = () => {
			request.destroy();
			finish({ succeeded: false });
		};
		const finish = (value: CphImportResult) => {
			if (settled) {
				return;
			}
			settled = true;
			if (timeout) {
				clearTimeout(timeout);
			}
			signal.removeEventListener('abort', abort);
			resolve(value);
		};
		const headers: Record<string, string | number> = {
			'Content-Type': 'application/json',
			'Content-Length': Buffer.byteLength(payload),
			'X-ShortestPath-OJ': 'true',
			...(problem.target ? { 'X-ShortestPath-Context': createHash('sha256').update(JSON.stringify([new URL(problem.url).origin, problem.target])).digest('hex') } : {}),
		};
		if (sourcePath && isValidSourcePath(sourcePath)) {
			headers['X-ShortestPath-Source-Path-Encoded'] = encodeSourcePath(sourcePath);
		}
		request = http.request({ hostname: '127.0.0.1', port: 27121, method: 'POST', path: '/', headers }, response => {
			const chunks: Buffer[] = [];
			response.on('data', (chunk: Buffer) => chunks.push(chunk));
			response.on('end', () => {
				if (response.statusCode === undefined || response.statusCode < 200 || response.statusCode >= 300) {
					finish({ succeeded: false });
					return;
				}
				try {
					const result = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { sourcePath?: unknown };
					finish(typeof result.sourcePath === 'string' && isValidSourcePath(result.sourcePath) ? { succeeded: true, sourcePath: result.sourcePath } : { succeeded: false });
				} catch {
					finish({ succeeded: false });
				}
			});
		});
		signal.addEventListener('abort', abort, { once: true });
		// First import may wait for the user to choose a language.
		timeout = setTimeout(() => request.destroy(), 120_000);
		request.once('error', () => finish({ succeeded: false }));
		request.end(payload);
	});
}

function readLocalTestEdits(value: unknown): LocalTestRequest['edits'] {
	if (value === undefined) { return undefined; }
	if (!Array.isArray(value) || !value.every(edit => edit && typeof edit === 'object' && Number.isSafeInteger(edit.id) && typeof edit.input === 'string' && typeof edit.output === 'string')) {
		throw new Error(localize('测试输入或期望输出无效。'));
	}
	return value;
}

async function addStressCounterExampleToLocalTests(problem: ImportedProblem, task: StressTask, ownerSourcePath?: string): Promise<void> {
	const sourcePath = ownerSourcePath ?? (await readWorkspaceProblemCache()).sourcePaths[problem.ref];
	if (!sourcePath) { throw new Error(localize('未找到该题目的本地代码文件。')); }
	if (!task.counterExample || task.counterExampleTruncated || task.interactionTrace || problem.localTest?.enabled === false) {
		throw new Error(localize('当前对拍任务还没有可添加的反例。'));
	}
	await vscode.commands.executeCommand('judger.integratedTests', { sourcePath, action: 'add', input: task.counterExample.input, output: task.counterExample.expected, deduplicate: true } satisfies LocalTestRequest);
}

type ProblemViewSections = {
	connected: boolean;
	connectionGate: string;
	rating: string;
	ratingPrompt: string;
	operationNotice: string;
	status: string;
	submissionButton: string;
	information: string;
	statement: string;
	localTestsToolbar: string;
	localTests: string;
	hints: string;
	editorial: string;
	submissions: string;
	compatibilityWarning: string;
};

const problemViewSectionIds: Record<Exclude<keyof ProblemViewSections, 'connected'>, string> = {
	connectionGate: 'oj-connection-gate',
	rating: 'oj-rating',
	ratingPrompt: 'oj-rating-prompt',
	operationNotice: 'oj-operation-notice',
	status: 'oj-status',
	submissionButton: 'oj-submission-button',
	information: 'oj-information',
	statement: 'oj-statement-content',
	localTestsToolbar: 'oj-local-tests-toolbar',
	localTests: 'oj-local-tests',
	hints: 'oj-hints',
	editorial: 'oj-editorial',
	submissions: 'oj-submissions',
	compatibilityWarning: 'oj-compatibility-warning',
};

const problemViewTabIds: Record<'statement' | 'hints' | 'submissions' | 'editorial', string> = {
	statement: 'oj-statement',
	hints: 'oj-hints',
	submissions: 'oj-submissions',
	editorial: 'oj-editorial',
};

function wrapTabSection(key: keyof ProblemViewSections, html: string): string {
	if (problemViewTabIds[key as keyof typeof problemViewTabIds]) {
		return html || '<p class="empty-tab">暂无内容。</p>';
	}
	return html;
}

type ProblemViewTimer = {
	elapsedMs: number;
	running: boolean;
	accepted: boolean;
	capturedAt: number;
};

function getProblemViewTimer(state: ProblemPanelState): ProblemViewTimer {
	const timer = state.problem.state.timer;
	return {
		elapsedMs: timer.elapsedMs,
		running: timer.mode === 'timed' && timer.running,
		accepted: timer.accepted,
		capturedAt: timer.capturedAtUnixMs,
	};
}

function renderProblemViewSections(
	state: ProblemPanelState,
	showLongRunningOperationNotice: boolean,
	operationToastMessage: string | undefined,
	editorialRequestInFlight: boolean,
): ProblemViewSections {
	// Verification notices block online controls without hiding cached content.
	state = { ...state, connected: state.connected && !showLongRunningOperationNotice };
	const { problem } = state;
	const sourceUrl = problem.publicContent && 'source_url' in problem.publicContent ? problem.publicContent.source_url : undefined;
	const canSubmit = problem.target?.kind === 'contest'
		? typeof sourceUrl === 'string' && /^https?:\/\//.test(sourceUrl)
		: state.connected && problem.capabilities.submission.enabled;
	const statementProblem = getSelectedStatementProblem(problem, state.previousStatements, state.statementVersionIndex);
	const needsConnectionAction = showLongRunningOperationNotice || !state.connected && (state.recoveryState === 'login_required' || state.recoveryState === 'account_mismatch' || state.recoveryState === 'verification_required');
	return {
		connected: state.connected,
		connectionGate: needsConnectionAction ? `<div class="connection-gate-content"><button type="button" class="connection-gate-button" data-command="loginConnection">${localize(state.recoveryState === 'login_required' ? '请去网页登录' : state.recoveryState === 'account_mismatch' ? '请去网页登录原账号' : '请去网页完成验证')}</button><p role="status">${escapeHtml(localize(state.statusMessage ?? '正在重新连接…'))}</p></div>` : '',
		operationNotice: operationToastMessage
			? `<div class="operation-notice error" role="alert">${escapeHtml(operationToastMessage)}</div>`
			: showLongRunningOperationNotice
				? `<div class="operation-notice" role="status">${localize('操作长时间没有响应，可能是因为触发了安全验证，请到浏览器处理。')}</div>`
				: '',
		status: state.statusMessage ? `<div class="connection ${state.connected ? 'connected' : 'disconnected'}">${escapeHtml(localize(state.statusMessage))}${state.recoveryState === 'login_required' || state.recoveryState === 'account_mismatch' ? `<button type="button" data-command="loginConnection">${localize('登录')}</button>` : state.recoveryState === 'error' ? `<button type="button" data-command="retryConnection">${localize('重试')}</button>` : ''}</div>` : '',
		submissionButton: `<button type="button" data-command="submit"${canSubmit && !state.operationsInFlight.has('submit') ? '' : ' disabled'}>${state.operationsInFlight.has('submit') ? localize('正在提交…') : localize('提交代码')}</button>`,
		rating: renderProblemRating(state),
		ratingPrompt: state.rating?.promptOpen ? renderRatingPrompt(state) : '',
		information: renderInformation(statementProblem),
		statement: renderStatement(problem, state.previousStatements, state.statementVersionIndex, !!state.sourcePath),
		localTestsToolbar: state.sourcePath && state.statementVersionIndex === 0 && problem.localTest?.enabled !== false ? renderLocalTestsToolbar(state.localTests, state.localTestsPending === true, localize) : '',
		localTests: state.sourcePath && state.statementVersionIndex === 0 ? renderLocalTests(state.localTests, problem, state.localTestsError, state.localTestsPending === true, { escape: escapeHtml, text: localize, markdown: renderProblemMarkdown }) : '',
		hints: renderHints(state),
		editorial: renderEditorialTab(state, editorialRequestInFlight),
		submissions: renderSubmissions(state),
		compatibilityWarning: state.compatibilityWarningDismissed || problem.compatibilityWarnings.length === 0
			? ''
			: `<div class="compatibility-warning" role="status"><span>${escapeHtml(problem.compatibilityWarnings.join(' '))}</span><button type="button" data-command="dismissCompatibilityWarning" aria-label="${localize('关闭兼容性提示')}">${localize('关闭')}</button></div>`,
	};
}

function getProblemWebviewHtml(state: ProblemPanelState, sections: ProblemViewSections, template: string, webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const problem = getSelectedStatementProblem(state.problem, state.previousStatements, state.statementVersionIndex);
	const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'problemView.js'));
	const styles = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'problemView.css'));
	const katexStyles = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'katex', 'katex.min.css'));
	const timer = getProblemViewTimer(state);
	const judgeType = describeJudgeType(problem.judge.checkerType, problem.judge.floatEpsilon);
	const judgeTypeTooltip = judgeType === 'Float Judge' && problem.judge.floatEpsilon !== null
		? localizeFormat('允许的精度误差：{0}', String(problem.judge.floatEpsilon))
		: undefined;
	const metadataJudge = judgeType ? `<strong class="judge-type${judgeTypeTooltip ? ' judge-type-with-tolerance' : ''}"${judgeTypeTooltip ? ' tabindex="0"' : ''}>${escapeHtml(judgeType)}${judgeTypeTooltip ? `<span class="judge-type-tolerance" role="tooltip">${escapeHtml(judgeTypeTooltip)}</span>` : ''}</strong>` : '';
	const metadataParts = [
		`<span class="meta-item meta-collapsible">${escapeHtml(problem.topic.title)}</span>`,
		metadataJudge ? `<span class="meta-item">${metadataJudge}</span>` : '',
	].filter(Boolean);
	return fillTemplate(template, {
		CSP_SOURCE: webview.cspSource,
		CONNECTION_GATE: sections.connectionGate,
		CONNECTED: String(sections.connected),
		PROBLEM_REF: escapeAttribute(state.problem.ref),
		SOURCE_PATH: escapeAttribute(state.sourcePath ?? ''),
		KATEX_STYLES_URI: katexStyles.toString(),
		STYLES_URI: styles.toString(),
		SCRIPT_URI: script.toString(),
		STYLE_RELOAD_SCRIPT_URI: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'styleHotReload.js')).toString(),
		ELAPSED_MS: String(timer.elapsedMs),
		TIMER_RUNNING: String(timer.running),
		TIMER_ACCEPTED: String(timer.accepted),
		TIMER_VALUE: formatElapsedTimer(timer.elapsedMs),
		CAPTURED_AT: String(timer.capturedAt),
		TITLE: escapeHtml(problem.title),
		METADATA: metadataParts.join(''),
		PROBLEM_URL: escapeAttribute(problem.url),
		OPERATION_NOTICE: sections.operationNotice,
		STATUS: sections.status,
		SUBMISSION_BUTTON: sections.submissionButton,
		INFORMATION: sections.information,
		RATING: sections.rating,
		RATING_PROMPT: sections.ratingPrompt,
		STATEMENT_VERSION: renderStatementVersionControl(state.previousStatements, state.statementVersionIndex),
		STATEMENT: sections.statement
			.replace('<div id="oj-local-tests-toolbar"></div>', `<div id="oj-local-tests-toolbar">${sections.localTestsToolbar}</div>`)
			.replace('<div id="oj-local-tests"></div>', `<div id="oj-local-tests">${sections.localTests}</div>`),
		HINTS: sections.hints,
		EDITORIAL: sections.editorial,
		SUBMISSIONS: sections.submissions,
		COMPATIBILITY_WARNING: sections.compatibilityWarning,
	});
}

type DifficultyTag = {
	label: string;
	backgroundClass: string;
	borderClass?: string;
	textClass?: string;
	backgroundRgb: string;
	backgroundHex: string;
	textColor: string;
};

const difficultyTagMap: Readonly<Record<number, DifficultyTag>> = {
	0: { label: '入门', backgroundClass: 'bg-rose-700', backgroundRgb: 'rgb(190, 18, 60)', backgroundHex: '#be123c', textColor: 'white' },
	1: { label: '普及-', backgroundClass: 'bg-orange-600', backgroundRgb: 'rgb(234, 88, 12)', backgroundHex: '#ea580c', textColor: 'white' },
	2: { label: '普及', backgroundClass: 'bg-amber-500', backgroundRgb: 'rgb(245, 158, 11)', backgroundHex: '#f59e0b', textColor: 'black' },
	3: { label: '普及+', backgroundClass: 'bg-yellow-400', backgroundRgb: 'rgb(250, 204, 21)', backgroundHex: '#facc15', textColor: 'black' },
	4: { label: '提高-', backgroundClass: 'bg-lime-500', backgroundRgb: 'rgb(132, 204, 22)', backgroundHex: '#84cc16', textColor: 'black' },
	5: { label: '提高', backgroundClass: 'bg-emerald-600', backgroundRgb: 'rgb(5, 150, 105)', backgroundHex: '#059669', textColor: 'white' },
	6: { label: '提高+', backgroundClass: 'bg-sky-600', backgroundRgb: 'rgb(2, 132, 199)', backgroundHex: '#0284c7', textColor: 'white' },
	7: { label: 'NOI-', backgroundClass: 'bg-indigo-600', backgroundRgb: 'rgb(79, 70, 229)', backgroundHex: '#4f46e5', textColor: 'white' },
	8: { label: 'NOI', backgroundClass: 'bg-violet-700', backgroundRgb: 'rgb(109, 40, 217)', backgroundHex: '#6d28d9', textColor: 'white' },
	9: { label: 'NOI+', backgroundClass: 'bg-purple-900', backgroundRgb: 'rgb(88, 28, 135)', backgroundHex: '#581c87', textColor: 'white' },
	10: { label: 'IOI', backgroundClass: 'bg-zinc-950', backgroundRgb: 'rgb(9, 9, 11)', backgroundHex: '#09090b', textColor: 'white' },
};

const defaultDifficultyTag: DifficultyTag = {
	label: '—',
	backgroundClass: 'muted',
	borderClass: 'border',
	textClass: 'muted-foreground',
	backgroundRgb: 'var(--vscode-badge-background)',
	backgroundHex: 'var(--vscode-badge-background)',
	textColor: 'var(--vscode-descriptionForeground)',
};

function renderInformation(problem: ImportedProblem): string {
	const coreTags = problem.metadata.coreAlgorithm ? [`<span class="tag core" data-i18n-ignore>${escapeHtml(problem.metadata.coreAlgorithm)}</span>`] : [];
	const auxiliaryTags = problem.metadata.auxiliaryAlgorithms.map(tag => `<span class="tag auxiliary" data-i18n-ignore>${escapeHtml(tag)}</span>`);
	const renderTagGroup = (label: string, tags: string[]): string => tags.length > 0
		? `<div class="tag-group"><div class="tag-group-label">${label}</div><div class="tag-group-items">${tags.join('')}</div></div>`
		: '';
	const allTags = [renderTagGroup(localize('核心算法'), coreTags), renderTagGroup(localize('辅助算法'), auxiliaryTags)].filter(Boolean).join('') || `<span class="empty-tags">${localize('暂无标签')}</span>`;
	const summaryCount = (problem.metadata.coreAlgorithm ? 1 : 0) + problem.metadata.auxiliaryAlgorithms.length;
	const difficulty = difficultyTagMap[problem.metadata.difficulty] ?? defaultDifficultyTag;
	const difficultyTagClasses = [difficulty.backgroundClass, difficulty.borderClass, difficulty.textClass]
		.filter((value): value is string => value !== undefined)
		.map(escapeAttribute)
		.join(' ');
	const difficultyTag = `<span class="tag difficulty-tag ${difficultyTagClasses}" data-i18n-ignore style="--difficulty-background: ${escapeAttribute(difficulty.backgroundHex)}; --difficulty-foreground: ${escapeAttribute(difficulty.textColor)};">${escapeHtml(difficulty.label)}</span>`;
	return `
				<div class="info-cell"><span class="info-label">${localize('时间限制')}</span><span class="info-value">${problem.limits.timeMs} ms</span></div>
				<div class="info-cell"><span class="info-label">${localize('内存限制')}</span><span class="info-value">${problem.limits.memoryMB} MB</span></div>
				<div class="info-cell"><span class="info-label">${localize('题目难度')}</span><span class="info-value">${difficultyTag}</span></div>
				<div class="info-cell info-action tag-popover-anchor">
					<span class="info-label">${localize('题目标签')}</span>
					<span class="info-value tag-summary" tabindex="0" aria-label="${summaryCount} 个标签">${summaryCount > 0 ? `${summaryCount}` : '0'} <span class="tag-arrow" aria-hidden="true"></span></span>
					<div class="tag-popover">
						<div class="tag-popover-arrow"></div>
						<div class="tag-popover-content">${allTags}</div>
					</div>
				</div>`;
}

function renderStatement(problem: ImportedProblem, previousStatements: ProblemStatementSnapshot[], statementVersionIndex: number, integrated = false): string {
	const selected = getSelectedStatementProblem(problem, previousStatements, statementVersionIndex);
	const sections: Array<[string, string, MarkdownContent | undefined]> = [
		['description', localize('题目描述'), selected.statement.description],
		['input', localize('输入格式'), selected.statement.inputFormat],
		['output', localize('输出格式'), selected.statement.outputFormat],
		['constraints', localize('数据范围'), selected.statement.constraints],
	];
	const statement = sections
		.filter((entry): entry is [string, string, MarkdownContent] => entry[2] !== undefined)
		.map(([key, title, content]) => `<details class="section-collapsible" data-persist-key="statement:${key}" open><summary><h2>${title}</h2></summary><div data-i18n-ignore>${renderMarkdownContent(content, selected.url)}</div></details>`)
		.join('');
	const samples = selected.samples
		.map((sample, index) => {
			const io = `<article class="sample">
				<h3>样例 ${index + 1}</h3>
				<div class="sample-io-grid">
					<div class="io-block">
						<div class="io-header"><h4>样例输入</h4><button type="button" class="copy-btn" aria-label="复制样例输入">复制</button></div>
						<pre data-i18n-ignore><code>${escapeHtml(sample.input)}</code></pre>
					</div>
					<div class="io-block">
						<div class="io-header"><h4>样例输出</h4><button type="button" class="copy-btn" aria-label="复制样例输出">复制</button></div>
						<pre data-i18n-ignore><code>${escapeHtml(sample.output)}</code></pre>
					</div>
				</div>
			</article>`;
			const explanation = sample.explanation.trim()
				? `<div class="sample-explanation" data-render-math data-i18n-ignore>${renderProblemMarkdown(sample.explanation, selected.url)}</div>`
				: '';
			return `${io}${explanation}`;
		})
		.join('');
	if (integrated && statementVersionIndex === 0) {
		return `${statement}${renderPublicContent(selected)}<details class="samples section-collapsible" data-persist-key="statement:samples" open><summary class="samples-heading"><h2>${localize('样例')}</h2><div id="oj-local-tests-toolbar"></div></summary><div id="oj-local-tests"></div></details>`;
	}
	return `${statement}${renderPublicContent(selected)}${!selected.publicContent?.interaction && samples ? `<details class="samples section-collapsible" data-persist-key="statement:samples" open><summary><h2>${localize('样例')}</h2></summary>${samples}</details>` : ''}`;
}

function renderStatementVersionControl(previousStatements: ProblemStatementSnapshot[], statementVersionIndex: number): string {
	const versionOptions = [
		`<option value="0">${localize('当前')}</option>`,
		...previousStatements.map((_, index) => `<option value="${index + 1}"${statementVersionIndex === index + 1 ? ' selected' : ''}>${localizeFormat('旧版 {0}', String(index + 1))}</option>`),
	].join('');
	return previousStatements.length === 0
		? ''
		: `<span class="statement-version-control"><select data-command="selectStatementVersion" aria-label="${localize('题面版本')}">${versionOptions}</select>${statementVersionIndex > 0 ? `<button type="button" data-command="deletePreviousStatement" data-version-index="${statementVersionIndex}" aria-label="${localize('删除旧版题面')}">${localize('删除')}</button>` : ''}</span>`;
}

function getSelectedStatementProblem(problem: ImportedProblem, previousStatements: ProblemStatementSnapshot[], statementVersionIndex: number): ImportedProblem {
	return statementVersionIndex === 0 ? problem : previousStatements[statementVersionIndex - 1] ?? problem;
}

const ratingOptions: { value: Rating; label: string; icon: string }[] = [
	{ value: 'good', label: '好', icon: '🤩' },
	{ value: 'neutral', label: '一般', icon: '🙂' },
	{ value: 'bad', label: '差', icon: '💩' },
];

function renderRatingControls(state: ProblemPanelState): string {
	const rating = state.rating;
	const data = rating?.data;
	const buttons = ratingOptions.map(option => {
		const count = data?.counts[option.value];
		const label = localizeFormat('{0}，{1} 人', localize(option.label), String(count ?? 0));
		return `<button type="button" class="rating-option rating-${option.value}" data-command="rateProblem" data-rating="${option.value}" title="${escapeAttribute(localize(option.label))}" aria-label="${escapeAttribute(label)}" aria-pressed="${data?.rating === option.value}"${state.connected && rating?.canRate() ? '' : ' disabled'}${rating?.saving ? ' aria-disabled="true"' : ''}><span aria-hidden="true">${option.icon}</span><span>${count ?? '—'}</span></button>`;
	}).join('');
	const selected = ratingOptions.find(option => option.value === data?.rating);
	const message = !state.connected ? localize('连接恢复后可评价')
		: rating?.saving ? localize('保存中…')
			: !data ? localize(rating?.error ? '评价暂时不可用' : '正在加载评价…')
				: !rating?.canRate() ? localize('AC 或计时满 5 小时后可评价')
					: selected ? localizeFormat('已评价：{0}，可点击修改', localize(selected.label)) : localize('这道题怎么样？');
	return `<div class="rating-options" role="group" aria-label="${localize('题目评价')}" aria-busy="${Boolean(rating?.saving)}">${buttons}</div><p class="rating-status" aria-live="polite">${escapeHtml(message)}</p>${rating?.error ? `<p class="error" role="alert">${escapeHtml(localize(rating.error))} <button type="button" data-command="ratingRefresh"${state.connected && !rating.loading && !rating.saving ? '' : ' disabled'}>${localize('重试')}</button></p>` : ''}`;
}

function renderProblemRating(state: ProblemPanelState): string {
	return `<div class="info-cell info-action tag-popover-anchor problem-rating"><button type="button" class="tag-summary rating-summary" aria-label="${localize('题目评价')}">${localize('题目评价')} <span class="tag-arrow" aria-hidden="true"></span></button><div class="tag-popover rating-popover"><div class="tag-popover-arrow"></div><div class="tag-popover-content">${renderRatingControls(state)}</div></div></div>`;
}

function renderRatingPrompt(state: ProblemPanelState): string {
	return `<div class="modal rating-modal" role="dialog" aria-modal="true" aria-labelledby="rating-dialog-title" aria-describedby="rating-dialog-description"><div class="modal-header"><h3 id="rating-dialog-title">${localize('首次 AC，恭喜！')}</h3><button type="button" class="modal-close" data-command="dismissRating" aria-label="${localize('关闭')}">×</button></div><div class="modal-body"><p id="rating-dialog-description">${localize('这道题体验如何？留下你的评价吧。')}</p>${renderRatingControls(state)}<button type="button" class="rating-later" data-command="dismissRating">${localize('稍后再说')}</button></div></div>`;
}

function renderHints(state: ProblemPanelState): string {
	if (state.problem.state.hints.length === 0) {
		return '';
	}
	const items = state.problem.state.hints.map(hint => {
		// While online, only the website state determines whether an answer was
		// viewed. The locally cached body is a fallback for an offline panel. Once
		// accepted, every hint is available, so viewed hints no longer need a
		// distinct visual marker (including hints viewed before acceptance).
		const viewed = !state.problem.state.timer.accepted
			&& (hint.viewed || (!state.connected && state.answers.has(hint.id)));
		const unlocked = hint.unlocked || state.problem.state.timer.accepted;
		const locked = !viewed && !unlocked;
		const receivedAt = state.hintRemainingReceivedAtMs?.get(hint.id) ?? state.problem.state.timer.capturedAtUnixMs;
		const remainingMs = Math.max(0, hint.remainingMs - Math.max(0, Date.now() - receivedAt));
		const statusText = state.problem.state.timer.accepted ? '' : viewed ? '已查看答案' : unlocked ? '已解锁' : remainingMs === 0 ? '查看提示' : '提示尚未解锁';
		const remainingAttr = !unlocked && remainingMs > 0 ? ` data-remaining-ms="${remainingMs}"` : '';
		const viewedClass = viewed ? ' viewed' : '';
		const countdown = locked && remainingMs > 0 ? `<span class="hint-countdown">剩余 ${formatDuration(remainingMs)}</span>` : '';
		const status = statusText || countdown ? `<span class="hint-list-status"><span class="hint-lock-label">${escapeHtml(statusText)}</span>${countdown}</span>` : '';
		const label = ` aria-label="提示 ${hint.seq}${statusText ? `，${escapeAttribute(statusText)}` : ''}"`;
		const heading = `<span class="hint-list-num">提示 ${hint.seq}</span>${status}`;
		return unlocked
			? `<details class="hint-item" data-persist-key="hint:${escapeAttribute(hint.id)}" data-hint-id="${escapeAttribute(hint.id)}"><summary class="hint-list-item${viewedClass}"${label}>${heading}</summary>${renderHintContent(state, hint)}</details>`
			: `<button type="button" class="hint-list-item${remainingMs > 0 ? ' locked' : ''}${viewedClass}" data-command="openHint" data-hint-id="${escapeAttribute(hint.id)}"${state.connected && remainingMs === 0 && !state.operationsInFlight.has('refreshHints') ? '' : ' disabled'}${label}${remainingAttr}>${heading}</button>`;
	}).join('');
	return `<section class="hints"><h2>提示</h2><div class="hint-list">${items}</div></section>`;
}

const likeSvgOutlined = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-thumbs-up size-3.5" aria-hidden="true"><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"></path><path d="M7 10v12"></path></svg>';
const likeSvgFilled = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-thumbs-up size-3.5 fill-current" aria-hidden="true"><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"></path><path d="M7 10v12"></path></svg>';

function renderLikeButton(hintId: string, target: 'question' | 'answer', likes: { liked: boolean; count: number }, enabled: boolean, loading = false): string {
	const label = `${likes.liked ? '取消点赞' : '点赞'}提示${target === 'question' ? '问题' : '答案'}，当前 ${likes.count} 赞`;
	return `<button type="button" class="like-btn${likes.liked ? ' liked' : ''}" data-command="like" data-hint-id="${escapeAttribute(hintId)}" data-target="${target}" data-liked="${likes.liked}" data-like-enabled="${enabled}" aria-label="${escapeAttribute(label)}"${loading ? ' aria-busy="true"' : ''}${enabled && !loading ? '' : ' disabled'}><span class="like-icon like-icon-outline" aria-hidden="true">${likeSvgOutlined}</span><span class="like-icon like-icon-filled" aria-hidden="true">${likeSvgFilled}</span><span class="like-count" aria-hidden="true">${likes.count}</span></button>`;
}

function renderHintContent(state: ProblemPanelState, hint: ProblemHint): string {
	const questionContent = hint.question
		? `<div data-render-math data-i18n-ignore>${renderMarkdownContent(hint.question, state.problem.url)}</div>`
		: '<p>提示问题尚未解锁。</p>';
	const questionLike = renderLikeButton(hint.id, 'question', hint.likes.question, state.connected && Boolean(hint.question), state.operationsInFlight.has(`like:${hint.id}:question`));
	const answer = state.answers.get(hint.id);
	const answerLike = renderLikeButton(hint.id, 'answer', hint.likes.answer, state.connected && Boolean(answer), state.operationsInFlight.has(`like:${hint.id}:answer`));
	const unlocked = hint.unlocked || state.problem.state.timer.accepted;
	const canRequestAnswer = state.connected;
	const canShowAnswer = unlocked && canRequestAnswer;
	const answerContent = answer
		? `<div data-render-math data-i18n-ignore>${renderMarkdownContent(answer, state.problem.url)}</div>`
		: `<button type="button" data-command="answer" data-hint-id="${escapeAttribute(hint.id)}" data-can-request="${canRequestAnswer}"${canShowAnswer && !state.operationsInFlight.has(`answer:${hint.id}`) ? '' : ' disabled'}${!unlocked && hint.remainingMs > 0 ? ` data-remaining-ms="${hint.remainingMs}"` : ''}>${state.operationsInFlight.has(`answer:${hint.id}`) ? localize('加载中…') : unlocked ? '显示答案' : `<span class="hint-countdown">剩余 ${formatDuration(hint.remainingMs)}</span>`}</button>`;
	const feedback = state.hintMessages.get(hint.id);
	return `<div class="hint-body">${feedback ? `<p class="hint-feedback" role="status">${escapeHtml(feedback)}</p>` : ''}<div class="hint-columns"><div><div class="hint-section-heading"><h4>问题</h4>${questionLike}</div>${questionContent}</div><div><div class="hint-section-heading"><h4>答案</h4>${answerLike}</div>${answerContent}</div></div></div>`;
}

function renderEditorialTab(state: ProblemPanelState, requestInFlight: boolean): string {
	const editorial = state.editorial;
	if (editorial?.state === 'available') {
		const label = escapeAttribute(localize('弹框查看'));
		return `<div class="editorial-toolbar"><button type="button" class="editorial-popup-button" data-command="editorialModal" title="${label}" aria-label="${label}"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10 2h4v4M14 2 8 8M7 3H3v10h10V9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>${renderEditorialContents(editorial, state.problem, state.connected, state.operationsInFlight)}`;
	}
	if (requestInFlight) {
		return `<p role="status">${localize('正在加载解题报告…')}</p>`;
	}
	const remainingMs = getCurrentEditorialRemainingMs(state.problem.state.editorial.remainingMs, state.editorialRemainingReceivedAtMs);
	const locked = !state.problem.state.timer.accepted && (remainingMs > 0 || editorial?.state === 'locked');
	const notice = locked
		? `<p class="hint-feedback"${remainingMs > 0 ? ` data-remaining-ms="${remainingMs}"` : ''}>${escapeHtml(describeEditorialLockReason(editorial?.state === 'locked' ? editorial.unlockReason || '' : ''))}${remainingMs > 0 ? `<span class="editorial-countdown">剩余 ${formatDuration(remainingMs)}</span>` : ''}</p>`
		: '';
	return notice;
}

function renderEditorialContents(editorial: Extract<EditorialResult, { state: 'available' }>, problem: ImportedProblem, canLike: boolean, operationsInFlight: ReadonlySet<string> = new Set()): string {
	const baseUrl = problem.url;
	const hintsHtml = editorial.hints.map(hint => {
		const qLike = renderLikeButton(hint.hintId, 'question', { liked: hint.questionLiked, count: hint.questionLikeCount }, canLike, operationsInFlight.has(`like:${hint.hintId}:question`));
		const aLike = renderLikeButton(hint.hintId, 'answer', { liked: hint.answerLiked, count: hint.answerLikeCount }, canLike, operationsInFlight.has(`like:${hint.hintId}:answer`));
		return `<article class="editorial-hint">
<div class="editorial-hint-header"><span class="editorial-hint-title">提示 ${hint.seq}</span></div>
<div class="editorial-hint-body">
<div class="editorial-hint-row"><div class="editorial-hint-row-heading"><span class="editorial-hint-label">问题</span><div class="like-row">${qLike}</div></div><div class="editorial-hint-content" data-render-math data-i18n-ignore>${renderMarkdownContent(hint.question, baseUrl)}</div></div>
<div class="editorial-hint-row"><div class="editorial-hint-row-heading"><span class="editorial-hint-label">答案</span><div class="like-row">${aLike}</div></div><div class="editorial-hint-content" data-render-math data-i18n-ignore>${renderMarkdownContent(hint.answer, baseUrl)}</div></div>
</div>
</article>`;
	}).join('');
	const codeBlock = { format: 'markdown' as const, content: '```cpp\n' + editorial.solutionCode + '\n```' };
	const codeHtml = renderMarkdownContent(codeBlock, baseUrl);
	return `<div class="editorial-container">
<div class="editorial-text">
<details class="editorial-section editorial-collapsible" data-persist-key="editorial-hints" open><summary><h2>提示回顾</h2></summary>${hintsHtml}</details>
<details class="editorial-section editorial-collapsible" data-persist-key="editorial-simple" open><summary><h2>简化题解</h2></summary><div data-render-math data-i18n-ignore>${renderMarkdownContent(editorial.simpleContent, baseUrl)}</div></details>
<details class="editorial-section editorial-collapsible" data-persist-key="editorial-detailed" open><summary><h2>详细题解</h2></summary><div data-render-math data-i18n-ignore>${renderMarkdownContent(editorial.content, baseUrl)}</div></details>
${(editorial.subtaskSolutions ?? []).map((solution, index) => `<details class="editorial-section editorial-collapsible" data-persist-key="editorial-subtask:${index}" data-i18n-ignore open><summary><h2>${escapeHtml(solution.title || solution.kind)}</h2></summary><p>${escapeHtml(solution.appliesToSubtasks.join(', '))}</p>${renderProblemMarkdown(solution.solution, baseUrl)}${solution.acCode ? renderProblemMarkdown('```cpp\n' + solution.acCode + '\n```', baseUrl) : ''}</details>`).join('')}
</div>
<div class="editorial-resizer" role="separator" aria-label="调整题解和参考代码宽度" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="80" tabindex="0"></div>
<div class="editorial-code"><details class="editorial-collapsible" data-persist-key="editorial-code" open><summary><h2>参考代码</h2></summary>${codeHtml}</details></div>
</div>`;
}

function getEditorialPanelHtml(editorial: EditorialResult, problem: ImportedProblem, webview: vscode.Webview, extensionUri: vscode.Uri, canLike: boolean): string {
	if (editorial.state !== 'available') {
		return '';
	}
	const styles = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'problemView.css'));
	const katexStyles = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'katex', 'katex.min.css'));
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src https:;">
<link rel="stylesheet" href="${katexStyles}">
<link id="oj-main-styles" rel="stylesheet" href="${styles}">
</head>
<body class="editorial-body">
<h1 class="editorial-title">解题报告</h1>
${renderEditorialContents(editorial, problem, canLike)}
<script>
const vscode = acquireVsCodeApi();
const editorialContainer = document.querySelector('.editorial-container');
const editorialResizer = document.querySelector('.editorial-resizer');
const savedLayout = vscode.getState() || {};
let editorialCodeWidth = typeof savedLayout.editorialCodeWidth === 'number' ? Math.min(80, Math.max(0, savedLayout.editorialCodeWidth)) : 45;
const editorialSections = Array.from(document.querySelectorAll('.editorial-collapsible[data-persist-key]'));
for (const section of editorialSections) {
	const open = savedLayout.editorialSections?.[section.dataset.persistKey];
	if (typeof open === 'boolean') { section.open = open; }
}
const saveEditorialLayout = () => vscode.setState({
	editorialCodeWidth,
	editorialSections: Object.fromEntries(editorialSections.map(section => [section.dataset.persistKey, section.open])),
});
document.addEventListener('toggle', event => {
	if (editorialSections.includes(event.target)) { saveEditorialLayout(); }
}, true);
const updateEditorialLayout = () => {
	editorialContainer.classList.toggle('editorial-code-hidden', editorialCodeWidth <= 4);
	editorialContainer.style.setProperty('--editorial-code-width', editorialCodeWidth + '%');
	editorialResizer.setAttribute('aria-valuenow', String(editorialCodeWidth));
};
const setEditorialCodeWidth = (width) => {
	editorialCodeWidth = Math.min(80, Math.max(0, Math.round(width)));
	updateEditorialLayout();
	saveEditorialLayout();
};
editorialResizer.addEventListener('pointerdown', (event) => {
	event.preventDefault();
	editorialResizer.setPointerCapture(event.pointerId);
	const resize = (pointerEvent) => {
		const bounds = editorialContainer.getBoundingClientRect();
		setEditorialCodeWidth((bounds.right - pointerEvent.clientX) / bounds.width * 100);
	};
	const stopResize = () => {
		editorialResizer.removeEventListener('pointermove', resize);
		editorialResizer.removeEventListener('pointerup', stopResize);
		editorialResizer.removeEventListener('pointercancel', stopResize);
	};
	editorialResizer.addEventListener('pointermove', resize);
	editorialResizer.addEventListener('pointerup', stopResize);
	editorialResizer.addEventListener('pointercancel', stopResize);
});
editorialResizer.addEventListener('keydown', (event) => {
	if (event.key === 'ArrowLeft') {
		event.preventDefault();
		setEditorialCodeWidth(editorialCodeWidth + 2);
	} else if (event.key === 'ArrowRight') {
		event.preventDefault();
		setEditorialCodeWidth(editorialCodeWidth - 2);
	} else if (event.key === 'Home') {
		event.preventDefault();
		setEditorialCodeWidth(80);
	} else if (event.key === 'End') {
		event.preventDefault();
		setEditorialCodeWidth(0);
	}
});
updateEditorialLayout();
const pendingEditorialLikes = new Map();
const updateEditorialLikeButton = (button, liked, count) => {
	button.dataset.liked = String(liked);
	button.classList.toggle('liked', liked);
	button.setAttribute('aria-label', (liked ? '取消点赞' : '点赞') + '提示' + (button.dataset.target === 'question' ? '问题' : '答案') + '，当前 ' + count + ' 赞');
	const countElement = button.querySelector('.like-count');
	if (countElement) {
		countElement.textContent = String(count);
	}
};
window.addEventListener('message', (event) => {
	const message = event.data;
	if (!message || (message.type !== 'editorialLike' && message.type !== 'editorialLikeError') || typeof message.hintId !== 'string') {
		return;
	}
	document.querySelectorAll('[data-command="like"]').forEach((button) => {
		if (!(button instanceof HTMLButtonElement) || button.dataset.hintId !== message.hintId) {
			return;
		}
		const pending = pendingEditorialLikes.get(button);
		const completesRequest = button.dataset.target === message.target;
		if (pending && !completesRequest) {
			return;
		}
		if (message.type === 'editorialLikeError') {
			if (!pending || !completesRequest) {
				return;
			}
			updateEditorialLikeButton(button, pending.liked, pending.count);
		} else {
			const isQuestion = button.dataset.target === 'question';
			const liked = isQuestion ? message.questionLiked : message.answerLiked;
			const count = isQuestion ? message.questionLikeCount : message.answerLikeCount;
			if (typeof liked !== 'boolean' || typeof count !== 'number') {
				return;
			}
			updateEditorialLikeButton(button, liked, count);
		}
		if (pending && completesRequest) {
			pendingEditorialLikes.delete(button);
			button.disabled = false;
		}
	});
});
document.addEventListener('click', (event) => {
	const button = event.target.closest('[data-command="like"]');
	if (!(button instanceof HTMLButtonElement) || button.disabled || pendingEditorialLikes.has(button)) {
		return;
	}
	const hintId = button.dataset.hintId;
	const target = button.dataset.target;
	const liked = button.dataset.liked === 'true';
	const count = Number(button.querySelector('.like-count').textContent);
	pendingEditorialLikes.set(button, { liked, count });
	updateEditorialLikeButton(button, !liked, Math.max(0, count + (liked ? -1 : 1)));
	button.disabled = true;
	vscode.postMessage({ command: 'like', hintId, target, liked: !liked });
});
</script>
<script src="${webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'styleHotReload.js'))}"></script>
</body>
</html>`;
}

function renderSubmissions(state: ProblemPanelState): string {
	const items = [...state.submissions.values()]
		.sort((left, right) => compareSubmissionIdDescending(left.submissionId, right.submissionId))
		.map((item, index) => {
			const liveSubmission = isLiveSubmission(item);
			const stage = liveSubmission ? describeSubmissionStage(item.stage, item.detailState) : undefined;
			const statusClass = describeSubmissionStatus(item.status);
			const status = item.resultHidden ? localize('比赛结果暂未公开') : renderSubmissionStatus(item.status, statusClass);
			const detailNotice = liveSubmission && item.detailState === 'unavailable' ? `<p class="warning">结果已结束，详情暂不可用：${escapeHtml(item.detailError?.message ?? '')}</p>` : '';
			const compileError = liveSubmission && item.compileErrorMessage ? `<pre class="error"><code>${escapeHtml(item.compileErrorMessage)}</code></pre>` : '';
			const details = liveSubmission && item.details.length ? `<table><thead><tr><th>#</th><th>测试点</th><th>状态</th><th>时间</th><th>内存</th><th>测试组</th><th>分值</th><th>得分比例</th></tr></thead><tbody>${item.details.map(detail => {
				const detailStatus = describeSubmissionDetailStatus(detail.status);
				const detailStatusHtml = detailStatus.statusClass ? renderSubmissionStatus(detailStatus.label, detailStatus.statusClass) : escapeHtml(detailStatus.label);
				return `<tr><td>${detail.seq}</td><td>${escapeHtml(detail.caseName)}</td><td>${detailStatusHtml}</td><td>${detail.timeMs} ms</td><td>${detail.memoryKB} KB</td><td>${escapeHtml(detail.testPoint ?? '')}</td><td>${detail.testPointScore ?? '—'}</td><td>${detail.outcome === undefined ? '—' : `${detail.outcome * 100}%`}</td></tr>`;
			}).join('')}</tbody></table>` : '';
			const disconnected = liveSubmission && state.disconnectedSubmissions.has(item.submissionId) ? `<p class="warning">${localize('连接恢复后将继续更新评测结果。')}</p>` : '';
			const showStressHint = liveSubmission && shouldShowStressHint(state, item);
			const stressSection = showStressHint ? renderSubmissionStress(state, item) : '';
			const completedStress = [...state.stressTasks.values()].filter(task => task.submissionId === item.submissionId && isStressFinished(task.status)).map(task => task.taskId).sort().join(',');
			const shouldOpen = index === 0 || completedStress !== '';
			const stagePrefix = stage ? `${escapeHtml(stage)} · ` : '';
			const summary = `<span class="submission-summary-title">提交 ${escapeHtml(item.submissionId)} · ${status}</span><span class="submission-summary-meta">${item.resultHidden ? localize('等待比赛结果公开') : `${stagePrefix}${item.score} 分 · ${item.maxTimeMs} ms · ${item.maxMemoryKB} KB`}</span>`;
			const correctionAction = state.problem.target && !item.resultHidden ? `<button type="button" data-command="correct" data-submission-id="${escapeAttribute(item.submissionId)}"${state.connected ? '' : ' disabled'}>${localize('AI 订正')}</button>` : '';
			const body = `${correctionAction}${disconnected}${detailNotice}${compileError}${details}${stressSection}`;
			return body ? `<details class="submission" data-persist-key="submission:${escapeAttribute(item.submissionId)}" data-auto-expand-key="${escapeAttribute(completedStress)}"${shouldOpen ? ' open' : ''}><summary>${summary}</summary><div class="submission-body">${body}</div></details>` : `<article class="submission submission-record">${summary}</article>`;
		}).join('');
	return `<section class="submissions"><h2>评测</h2><form id="watch-submission" hidden><input name="submissionId" inputmode="numeric" placeholder="已有提交 ID"><button type="submit"${state.connected ? '' : ' disabled'}>恢复观察</button></form>${items || '<p>暂无评测记录。</p>'}</section>`;
}

function renderSubmissionStatus(status: string, statusClass: ReturnType<typeof describeSubmissionStatus>): string {
	const evaluating = statusClass === 'in-progress';
	return `<span class="submission-status ${statusClass}"${evaluating ? ' title="测评中" aria-label="测评中"' : ''}>${escapeHtml(status)}</span>`;
}

function isLiveSubmission(submission: SubmissionSnapshot | SubmissionHistoryEntry): submission is SubmissionSnapshot {
	return 'details' in submission;
}

function renderSubmissionStress(state: ProblemPanelState, submission: SubmissionSnapshot): string {
	const submissionId = submission.submissionId;
	const tasks = [...state.stressTasks.values()].filter(task => task.submissionId === submissionId);
	if (tasks.length > 0) {
		return tasks.map(task => {
			const active = task.status === 'queued' || task.status === 'running';
			const progress = active && task.roundsExecuted === 0
				? '<progress></progress><span>对拍中…</span>'
				: `<progress max="${task.roundsPlanned}" value="${Math.min(task.roundsExecuted, task.roundsPlanned)}"></progress><span>${task.roundsExecuted} / ${task.roundsPlanned}</span>`;
			const canAddCounterExample = Boolean(task.counterExample) && state.problem.localTest?.enabled !== false && !task.counterExampleTruncated && !task.interactionTrace && isStressFinished(task.status);
			const counterExampleAction = canAddCounterExample ? `<button class="stress-counterexample-action" type="button" data-command="addStressCounterExample" data-task-id="${escapeAttribute(task.taskId)}"${state.addingStressCounterExamples.has(task.taskId) || state.addedStressCounterExamples.has(task.taskId) ? ' disabled' : ''}>${state.addedStressCounterExamples.has(task.taskId) ? '已添加到样例' : state.addingStressCounterExamples.has(task.taskId) ? '正在添加到样例…' : '添加到样例'}</button>` : '';
			const counterExample = task.counterExample ? `${counterExampleAction}<details data-persist-key="stress-counterexample:${escapeAttribute(task.taskId)}"${isStressFinished(task.status) ? ` open data-auto-expand-key="${escapeAttribute(task.taskId)}"` : ''}><summary>反例</summary><div class="stress-io-grid"><div class="stress-io-block"><h4>输入</h4><pre data-i18n-ignore><code>${escapeHtml(task.counterExample.input)}</code></pre></div><div class="stress-io-block"><h4>期望输出</h4><pre data-i18n-ignore><code>${escapeHtml(task.counterExample.expected)}</code></pre></div><div class="stress-io-block"><h4>实际输出</h4><pre data-i18n-ignore><code>${escapeHtml(task.counterExample.actual)}</code></pre></div></div></details>` : '';
			const disconnected = state.disconnectedStressTasks.has(task.taskId) ? `<p class="warning">${localize('连接恢复后将继续更新对拍结果。')}</p>` : '';
			const resultLabel = task.counterExample ? '发现反例' : task.status === 'not_found' ? '未发现反例' : task.status === 'timeout' ? '对拍超时' : task.status === 'error' ? '对拍失败' : '';
			return `<div class="stress-task">${resultLabel ? `<h4>${localize(resultLabel)}</h4>` : ''}<div class="progress">${progress}</div>${disconnected}${task.errorMessage ? `<p class="error">${escapeHtml(task.errorMessage)}</p>` : ''}${task.counterExampleTruncated ? `<p class="warning">${localize('反例已截断，只能查看，不能加入本地测试。')}</p>` : ''}${task.interactionTrace ? `<details><summary>${localize('交互轨迹')}</summary><pre data-i18n-ignore>${escapeHtml(task.interactionTrace)}</pre></details>` : ''}${counterExample}</div>`;
		}).join('');
	}
	const defaultRounds = state.stressContext?.defaultRounds ?? state.problem.capabilities.stress.defaultRounds ?? 120;
	const hint = '<p class="submission-stress-hint">提交出现 WA，可以使用对拍找到错误数据。</p>';
	const starting = state.operationsInFlight.has('startStress');
	const button = `<button type="button" data-command="startStress" data-submission-id="${escapeAttribute(submissionId)}" data-rounds="${defaultRounds}"${state.connected && !starting ? '' : ' disabled'}>${starting ? localize('加载中…') : '发起对拍'}</button>`;
	return `${hint}${button}`;
}

function compareSubmissionIdDescending(left: string, right: string): number {
	const leftId = BigInt(left);
	const rightId = BigInt(right);
	if (leftId === rightId) {
		return 0;
	}
	return leftId > rightId ? -1 : 1;
}

function shouldShowStressHint(state: ProblemPanelState, submission: SubmissionSnapshot): boolean {
	if (!state.problem.capabilities.stress.supported) {
		return false;
	}
	if ([...state.stressTasks.values()].some(task => task.submissionId === submission.submissionId)) {
		return true;
	}
	if (!isWrongAnswerStatus(submission.status) && submission.status !== 'RE' && submission.status !== 'Runtime Error') {
		return false;
	}
	return true;
}

function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
	return template.replace(/\{\{([A-Z_]+)\}\}/g, (placeholder, name: string) => values[name] ?? placeholder);
}

function applyAnswerLikes(problem: ImportedProblem, result: Extract<HintAnswerResult, { state: 'revealed' }>): ImportedProblem {
	return {
		...problem,
		state: {
			...problem.state,
			hints: problem.state.hints.map(hint => hint.id === result.hintId ? { ...hint, viewed: true, likes: result.likes } : hint),
		},
	};
}

function isStressFinished(status: string): boolean {
	return status === 'found' || status === 'not_found' || status === 'error' || status === 'timeout';
}

function formatDuration(milliseconds: number): string {
	const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor(totalSeconds % 3600 / 60);
	const seconds = totalSeconds % 60;
	return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
}

function getOpenFileTabGroups(): OpenFileTabGroup[] {
	const groups: OpenFileTabGroup[] = [];
	for (const group of vscode.window.tabGroups.all) {
		const filePaths: string[] = [];
		for (const tab of group.tabs) {
			const input = tab.input as { uri?: vscode.Uri } | undefined;
			if (input?.uri?.scheme === 'file') {
				filePaths.push(input.uri.fsPath);
			}
		}
		groups.push({ viewColumn: group.viewColumn, filePaths });
	}
	return groups;
}

function getActiveEditorPath(): string | undefined {
	const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
	if (!(activeTab?.input instanceof vscode.TabInputText) || activeTab.input.uri.scheme !== 'file') {
		return undefined;
	}
	return activeTab.input.uri.fsPath;
}

function isAddressInUseError(error: Error): boolean {
	return (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
}

function isActiveEditor(filePath: string): boolean {
	return getActiveEditorPath() === filePath;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]!);
}

function escapeAttribute(value: string): string {
	return escapeHtml(value).replace(/"/g, '&quot;');
}

function getAllowedBridgeOrigins(): ReadonlySet<string> {
	const origins = new Set(['https://shortestpath.cn']);
	const devOrigin = process.env.SHORTESTPATH_OJ_DEV_ORIGIN;
	if (devOrigin) {
		const url = new URL(devOrigin);
		if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol) && url.origin === devOrigin) { origins.add(devOrigin); }
	}
	return origins;
}

function renderPublicContent(problem: ImportedProblem): string {
	const content = problem.publicContent;
	if (!content) { return ''; }
	const section = (key: string, title: string, markdown: string) => `<details class="section-collapsible" data-persist-key="statement:${key}" open><summary><h2>${escapeHtml(title)}</h2></summary><div data-i18n-ignore>${renderProblemMarkdown(markdown, problem.url)}</div></details>`;
	const parts: string[] = [];
	if (content.scoring_rules) { parts.push(section('scoring-rules', localize('评分规则'), content.scoring_rules)); }
	const interaction = content.interaction;
	if (interaction) {
		const eventMarkdown = (events: typeof interaction.session_start) => events.map(event => `**${event.from === 'solver' ? localize('用户输出') : localize('交互器回复')}**\n\n\`\`\`text\n${event.format}\n\`\`\`\n\n${event.description ?? ''}`).join('\n\n');
		parts.push(section('interaction', localize('交互协议'), [eventMarkdown(interaction.session_start), eventMarkdown(interaction.case_start), ...interaction.phases.map(phase => `### ${phase.name}\n\n${phase.condition}\n\n${eventMarkdown(phase.events)}`), interaction.flush, interaction.termination, interaction.failure].filter(Boolean).join('\n\n')));
		parts.push(section('interaction-limits', localize('限制要求'), [...interaction.budgets.map(budget => `${budget.scope} ${budget.name}：${budget.limit}\n\n${budget.cost ?? ''}`), interaction.requirements].join('\n\n')));
		const samples = interaction.samples.map((sample, index) => {
			const hidden = (sample.hidden_states ?? []).map(state => `<div class="interaction-hidden" data-i18n-ignore><strong>${localize('固定隐藏内容')} ${state.case}</strong><pre><code>${escapeHtml(state.content)}</code></pre></div>`).join('');
			const trace = sample.events.map(event => `<div data-message-from="${event.from === 'solver' ? 'solver' : 'interactor'}" data-i18n-ignore><strong>${event.from === 'solver' ? localize('用户输出') : localize('交互器回复')}</strong><pre><code>${escapeHtml(event.text)}</code></pre>${event.note ? renderProblemMarkdown(event.note, problem.url) : ''}</div>`).join('');
			return `<article class="sample"><h3>${localizeFormat('样例 {0}', String(index + 1))}</h3>${hidden}${trace}<div data-i18n-ignore>${renderProblemMarkdown(sample.explanation, problem.url)}</div></article>`;
		}).join('');
		parts.push(`<details class="section-collapsible" data-persist-key="statement:interaction-samples" open><summary><h2>${localize('交互样例')}</h2></summary>${samples}</details>`);
	}
	const runtime = content.judge_runtime;
	if (runtime) {
		for (const [index, header] of runtime.public_headers.entries()) { parts.push(section(`public-header:${index}`, header.name, `\`\`\`cpp\n${header.content}\n\`\`\``)); }
	}
	if (content.local_judging) { parts.push(section('local-judging', localize('本地评测'), renderLocalJudgingMarkdown(content.local_judging))); }
	if (problem.localTest?.enabled === false) { parts.push(`<p class="warning">${escapeHtml(problem.localTest.reason)}</p>`); }
	return parts.join('');
}

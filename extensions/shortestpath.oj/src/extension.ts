/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as vscode from 'vscode';
import { localize, localizeFormat, localizeWebviewHtml } from './localization';
import { canViewEditorial, describeEditorialLockReason, getCurrentEditorialRemainingMs, shouldConfirmEditorial } from './editorialAccess';
import { describeFloatJudgeTolerance, describeJudgeType, describeSubmissionDetailStatus, describeSubmissionStage, describeSubmissionStatus } from './judgeDisplay';
import { createProblemMarkdownRenderer, ProblemMarkdownRenderer } from './markdownRenderer';
import { findOpenFileViewColumn, OpenFileTabGroup, shouldHideProblemPanelWhenSourceCloses, shouldHideProblemPanelWhenSourceInactive, shouldRestoreProblemPanel } from './problemPanelLifecycle';
import { ImportAction, OutcomeUnknownError, ShortestPathOjLocalBridge } from './shortestpathOjLocalBridge';
import { mergeSubmissionHistory, sanitizeSubmissionHistoryEntry, SubmissionHistoryEntry, toSubmissionHistoryEntry } from './submissionHistory';
import { isHeaderSafeSourcePath } from './sourcePath';
import { formatElapsedTimer } from './timerDisplay';
import { assertUniqueWorkspaceProblemRecordFileNames, getWorkspaceProblemRecordFileName } from './workspaceProblemCache';
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
	StressContext,
	StressTask,
	SubmissionLanguage,
	SubmissionSnapshot,
	parseEditorialResult,
	restoreCachedProblemCompatibilityWarnings,
	bridgePort,
} from './shortestpathOjProtocol';

const workspaceCacheDirectoryName = '.shortestpath';
const legacyWorkspaceCacheFileName = 'oj-problems.json';
const workspaceProblemRecordVersion = 1;
const workspaceFolderRequiredMessage = '请先在 ShortestPath IDE 中打开一个文件夹，再从网站导入题目。';
const workspaceCachesNeedingRewrite = new WeakSet<WorkspaceProblemCache>();
let workspaceCacheMutationTail = Promise.resolve();
let workspaceCacheMigration: Promise<void> | undefined;

type WorkspaceProblemCache = {
	version: 4;
	problems: Record<string, ImportedProblem>;
	sourcePaths: Record<string, string>;
	submissions: Record<string, SubmissionHistoryEntry[]>;
	editorials: Record<string, EditorialResult>;
};

type CphImportResult = { succeeded: boolean; sourcePath?: string };

type CachedWorkspaceProblemCache = Omit<Partial<WorkspaceProblemCache>, 'version'> & { version?: 3 | 4 };

type WorkspaceProblemRecord = {
	version: typeof workspaceProblemRecordVersion;
	problem: ImportedProblem;
	sourcePath?: string;
	submissions: SubmissionHistoryEntry[];
	editorial?: EditorialResult;
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
	operationId: string;
	language: string;
	sourceCode: string;
	sourcePath: string;
};

type ProblemPanelState = {
	problem: ImportedProblem;
	compatibilityWarningDismissed: boolean;
	connected: boolean;
	statusMessage: string;
	answers: Map<string, MarkdownContent>;
	hintMessages: Map<string, string>;
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
	editorialRemainingReceivedAtMs: number;
	sourcePath?: string;
};

type ProblemPanelActions = {
	answer(problem: ImportedProblem, hintId: string): Promise<HintAnswerResult>;
	like(problem: ImportedProblem, hintId: string, target: 'question' | 'answer', liked: boolean): Promise<LikeResult>;
	editorial(problem: ImportedProblem): Promise<EditorialResult | undefined>;
	submit(problem: ImportedProblem): Promise<void>;
	watchSubmission(problem: ImportedProblem, submissionId: string): Promise<void>;
	loadStress(problem: ImportedProblem): Promise<StressContext>;
	startStress(problem: ImportedProblem, submissionId: string, rounds: number): Promise<StressTask>;
	addStressCounterExample(problem: ImportedProblem, task: StressTask): Promise<void>;
	loadSubmissionHistory(problem: ImportedProblem): Promise<SubmissionHistoryEntry[]>;
	saveSubmissionHistory(problem: ImportedProblem, submission: SubmissionHistoryEntry): Promise<void>;
	loadEditorial(problem: ImportedProblem): Promise<EditorialResult | undefined>;
	saveEditorial(problem: ImportedProblem, editorial: EditorialResult): Promise<void>;
};

class ShortestPathOjProblemPanel {
	private panel: vscode.WebviewPanel | undefined;
	private sourceEditorLabel: { sourcePath: string; label: string } | undefined;
	private state: ProblemPanelState | undefined;
	private sentSections: ProblemViewSections | undefined;
	private sentTimerJson = '';
	private pendingSections: ProblemViewSections | undefined;
	private pendingTimer: ProblemViewTimer | undefined;
	private webviewReady = false;
	private renderedProblemRef: string | undefined;
	private editorialPanel: vscode.WebviewPanel | undefined;
	private editorialPanelOpening = false;
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
		if (fromWebsite) {
			this.showAntiFraudReminder();
		}
		if (!this.state || this.state.problem.ref !== problem.ref) {
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
				statusMessage: connected ? '已连接题目网页。' : '等待用户从网站重新发送题目。',
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
				editorialRemainingReceivedAtMs: Date.now(),
				sourcePath,
			};
			const state = this.state;
			void Promise.all([
				this.actions.loadSubmissionHistory(problem),
				this.actions.loadEditorial(problem),
			]).then(([submissions, editorial]) => {
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
				this.render();
			}).catch(error => console.error('Failed to load ShortestPath OJ cached content.', error));
		} else {
			this.state.problem = problem;
			this.state.connected = connected;
			this.state.statusMessage = connected ? '已连接题目网页。' : '等待用户从网站重新发送题目。';
			if (fromWebsite) {
				this.state.editorialRemainingReceivedAtMs = Date.now();
			}
			if (sourcePath) {
				this.state.sourcePath = sourcePath;
			}
			this.refreshEditorial();
		}
		this.updateProblemPanelTitle();
		if (this.editorialPanel) {
			return;
		}
		if (this.hideProblemWhenSourceInactive()) {
			return;
		}
		const panelCreated = this.ensureProblemPanel();
		this.render();
		const panel = this.panel;
		if (!panelCreated && !this.editorialPanel && panel) {
			panel.reveal(panel.viewColumn, true);
		}
	}

	private showAntiFraudReminder(): void {
		if (!vscode.workspace.getConfiguration('shortestpath.oj').get<boolean>('antiFraudReminder', false)) {
			return;
		}
		const rickrollUrl = vscode.env.language.toLowerCase().startsWith('zh')
			? 'https://player.bilibili.com/player.html?isOutside=true&aid=80433022&bvid=BV1GJ411x7h7&cid=137649199&p=1'
			: 'https://youtu.be/dQw4w9WgXcQ?si=SnNrGNt_WDv4861J';
		void vscode.window.openBrowserTab(rickrollUrl, { viewColumn: vscode.ViewColumn.Active, preserveFocus: false });
	}

	updateProblemState(problemRef: string, state: ProblemState): void {
		if (!this.state || this.state.problem.ref !== problemRef) {
			return;
		}
		if (hasIncompatibleProblemState(this.state.problem)) {
			return;
		}
		this.state.problem = applyProblemState(this.state.problem, state);
		this.state.editorialRemainingReceivedAtMs = Date.now();
		this.render();
	}

	handleEvent(problemRef: string, event: IncomingEvent): void {
		const state = this.state;
		if (!state || state.problem.ref !== problemRef) {
			return;
		}
		if (event.type === 'submission.progress' || event.type === 'submission.finished') {
			const snapshot = event.data;
			const wasFinished = state.finishedSubmissions.has(snapshot.submissionId);
			if (event.type === 'submission.progress' && wasFinished) {
				return;
			}
			state.submissions.set(snapshot.submissionId, snapshot);
			state.disconnectedSubmissions.delete(snapshot.submissionId);
			if (event.type === 'submission.finished') {
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
		this.state.statusMessage = '网页连接已断开，请从网站重新打开。';
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

	clearSourceEditorLabel(): void {
		if (!this.sourceEditorLabel) {
			return;
		}
		void vscode.commands.executeCommand('_shortestpath.oj.setTransientEditorLabel', vscode.Uri.file(this.sourceEditorLabel.sourcePath), undefined);
		this.sourceEditorLabel = undefined;
	}

	updateSourceEditorLabel(): void {
		const state = this.state;
		const sourcePath = state?.sourcePath;
		const label = state && !this.panel && sourcePath
			? `${path.basename(sourcePath)} & ShortestPath OJ 上的 ${state.problem.title}`
			: undefined;

		const currentLabel = this.sourceEditorLabel;
		if (currentLabel !== undefined && currentLabel.sourcePath === sourcePath && currentLabel.label === label) {
			return;
		}
		this.clearSourceEditorLabel();
		if (sourcePath && label) {
			void vscode.commands.executeCommand('_shortestpath.oj.setTransientEditorLabel', vscode.Uri.file(sourcePath), label);
			this.sourceEditorLabel = { sourcePath, label };
		}
	}

	hideProblemWhenSourceInactive(): boolean {
		if (this.panel?.active || !this.state || !shouldHideProblemPanelWhenSourceInactive(this.state.sourcePath, getActiveEditorPath())) {
			return false;
		}
		void this.closeProblemPanelAfterRemembering();
		return true;
	}

	restoreProblemWhenSourceActive(): boolean {
		if (this.editorialPanelOpening || !this.state || !shouldRestoreProblemPanel(
			this.state.sourcePath,
			getActiveEditorPath(),
			this.panel !== undefined,
			getOpenFileTabGroups().flatMap(group => group.filePaths),
		)) {
			return false;
		}
		this.ensureProblemPanel();
		this.render();
		return true;
	}

	async hideProblemWhenSourceCloses(): Promise<boolean> {
		if (!this.state || !shouldHideProblemPanelWhenSourceCloses(this.state.sourcePath, getOpenFileTabGroups().flatMap(group => group.filePaths))) {
			return false;
		}
		await this.rememberSplitRatioBeforeClosing();
		this.state = undefined;
		this.updateSourceEditorLabel();
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
		await this.rememberSplitRatioBeforeClosing();
		this.state = undefined;
		this.updateSourceEditorLabel();
		this.panel?.dispose();
	}

	/**
	 * Records the current code/problem split ratio before the problem panel is
	 * closed, so the next freshly created split uses the same ratio. The panel
	 * must still be open at this point for the workbench to measure the groups.
	 */
	private async rememberSplitRatioBeforeClosing(): Promise<void> {
		await vscode.commands.executeCommand('shortestpath.oj.rememberProblemSplitRatio');
	}

	private async closeProblemPanelAfterRemembering(): Promise<void> {
		await this.rememberSplitRatioBeforeClosing();
		this.panel?.dispose();
	}

	registerSubmission(problemRef: string, submission: SubmissionSnapshot, message: string): void {
		if (!this.state || this.state.problem.ref !== problemRef) {
			return;
		}
		this.state.submissions.set(submission.submissionId, submission);
		this.state.statusMessage = message;
		this.render();
	}

	focusTab(tabId: 'statement' | 'hints' | 'submissions'): void {
		void this.panel?.webview.postMessage({ type: 'focusTab', tabId });
	}

	refreshEditorial(): void {
		if (!this.editorialPanel || !this.state?.editorial) {
			return;
		}
			this.editorialPanel.webview.html = localizeWebviewHtml(getEditorialPanelHtml(this.state.editorial, this.state.problem, this.editorialPanel.webview, this.extensionUri, this.state.connected));
	}

	private refreshEditorialLike(hintId: string): void {
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

	private refreshHintModal(hintId: string): void {
		const state = this.state;
		if (!state) {
			return;
		}
		const hint = state.problem.state.hints.find(h => h.id === hintId);
		if (!hint) {
			return;
		}
		const modalHtml = renderHintModal(state, hint);
		void this.panel?.webview.postMessage({ type: 'showHintModal', html: modalHtml });
	}

	private showLockedEditorialNotice(remainingMs: number, reason = ''): void {
		const reasonText = describeEditorialLockReason(reason);
		const detail = remainingMs > 0
			? `${reasonText}剩余 ${formatDuration(remainingMs)}`
			: reasonText;
		void this.panel?.webview.postMessage({
			type: 'showHintModal',
			html: `<div class="modal-header"><h3>解题报告</h3><button type="button" class="modal-close" data-command="closeModal" aria-label="关闭">×</button></div><div class="modal-body"><p class="hint-feedback" data-remaining-ms="${remainingMs}">${escapeHtml(detail)}</p></div>`,
		});
	}

	private getCurrentEditorialRemainingMs(state: ProblemPanelState): number {
		return getCurrentEditorialRemainingMs(
			state.problem.state.editorial.remainingMs,
			state.editorialRemainingReceivedAtMs,
		);
	}

	private getProblemViewColumn(): vscode.ViewColumn {
		const sourceColumn = this.findBoundSourceEditorColumn();
		if (sourceColumn !== undefined) {
			const existingRightGroup = vscode.window.tabGroups.all.find(group => group.viewColumn === sourceColumn + 1);
			return existingRightGroup?.viewColumn ?? vscode.ViewColumn.Beside;
		}
		const activeViewColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
		const existingRightGroup = vscode.window.tabGroups.all.find(group => group.viewColumn === activeViewColumn + 1);
		return existingRightGroup?.viewColumn ?? vscode.ViewColumn.Beside;
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
		this.editorialPanelOpening = true;
		try {
			if (this.panel) {
				await this.closeProblemPanelAfterRemembering();
			}
			const title = `${localize('解题报告')}: ${problem.title}`;
			if (this.editorialPanel) {
				this.editorialPanel.title = title;
				this.editorialPanel.webview.html = localizeWebviewHtml(getEditorialPanelHtml(editorial, problem, this.editorialPanel.webview, this.extensionUri, canLike));
				this.editorialPanel.reveal(this.editorialPanel.viewColumn, false);
				return;
			}
			// Keep the problem and editorial as tabs in the source editor group. This
			// avoids a forced split while leaving users free to move either tab later.
			const viewColumn = this.findBoundSourceEditorColumn() ?? this.findCodeEditorColumn();
			const panel = vscode.window.createWebviewPanel(
				'shortestpath.ojEditorial',
				title,
				{ viewColumn, preserveFocus: false },
				{
					enableScripts: true,
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
				if (value.command === 'like' && typeof value.hintId === 'string' && (value.target === 'question' || value.target === 'answer') && typeof value.liked === 'boolean') {
					try {
						const result = await this.actions.like(this.state.problem, value.hintId, value.target, value.liked);
						this.state.problem = applyLikeResult(this.state.problem, result);
						if (this.state.editorial) {
							this.state.editorial = applyEditorialLikeResult(this.state.editorial, result);
							this.state.cachedEditorial = this.state.editorial;
							void this.actions.saveEditorial(this.state.problem, this.state.editorial).catch(error => console.error('Failed to save ShortestPath OJ editorial likes.', error));
						}
						this.refreshEditorialLike(value.hintId);
					} catch (error) {
						console.error('Failed to update ShortestPath OJ editorial like.', error);
					}
				}
			});
			panel.webview.html = localizeWebviewHtml(getEditorialPanelHtml(editorial, problem, panel.webview, this.extensionUri, canLike));
			panel.onDidDispose(() => {
				if (this.editorialPanel === panel) {
					this.editorialPanel = undefined;
				}
			});
		} finally {
			setTimeout(() => this.editorialPanelOpening = false, 0);
		}
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
			},
		);
		panel.onDidDispose(() => {
			if (this.panel === panel) {
				this.panel = undefined;
				this.sentSections = undefined;
				this.pendingSections = undefined;
				this.pendingTimer = undefined;
				this.sentTimerJson = '';
				this.webviewReady = false;
				this.updateSourceEditorLabel();
			}
		});
		panel.webview.onDidReceiveMessage(message => {
			void this.handleMessage(message);
		});
		this.panel = panel;
		this.updateSourceEditorLabel();
		return true;
	}

	private getProblemPanelTitle(): string {
		return this.state ? `${this.state.problem.title}题面` : 'ShortestPath OJ';
	}

	private updateProblemPanelTitle(): void {
		if (this.panel) {
			this.panel.title = this.getProblemPanelTitle();
		}
		this.updateSourceEditorLabel();
	}

	private ensureProblemPanel(): boolean {
		const panelCreated = this.ensurePanel(this.getProblemViewColumn());
		const problemViewColumn = this.panel?.viewColumn;
		if (panelCreated && problemViewColumn !== undefined) {
			setTimeout(() => this.closeShortestPathNewTabs(problemViewColumn), 0);
			// Always apply the remembered ratio when a fresh panel is created,
			// even when it lands in a still-existing column (e.g. after the last
			// problem panel was closed). The command locates the panel group
			// itself, so the column index is not needed.
			setTimeout(() => {
				void vscode.commands.executeCommand('shortestpath.oj.resizeEditorGroups');
			}, 0);
		}
		return panelCreated;
	}

	private closeShortestPathNewTabs(viewColumn: vscode.ViewColumn): void {
		const group = vscode.window.tabGroups.all.find(item => item.viewColumn === viewColumn);
		const newTabs = group?.tabs.filter(item =>
			!item.isDirty && (item.label === '新建标签页' || item.label === 'New Tab'),
		) ?? [];
		if (newTabs.length > 0) {
			void vscode.window.tabGroups.close(newTabs, true);
		}
	}

	private async handleMessage(message: unknown): Promise<void> {
		const state = this.state;
		if (!state || typeof message !== 'object' || message === null) {
			return;
		}
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
		};
		try {
			switch (value.command) {
				case 'ready':
					this.webviewReady = true;
					this.flushPendingUpdate();
					return;
				case 'dismissCompatibilityWarning':
					state.compatibilityWarningDismissed = true;
					this.render();
					return;
				case 'reportProblemPanelResized':
					// The user resized the split between the code editor and the
					// problem panel; remember the new ratio (globally) right away so
					// it survives closing and re-importing the problem.
					void vscode.commands.executeCommand('shortestpath.oj.rememberProblemSplitRatio');
					return;
				case 'answer':
					if (typeof value.hintId !== 'string') {
						return;
					}
					{
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
							state.hintMessages.set(result.hintId, message);
						}
					}
					this.refreshHintModal(value.hintId);
					break;
				case 'openHintModal':
					if (typeof value.hintId !== 'string') {
						return;
					}
					{
						const hint = state.problem.state.hints.find(h => h.id === value.hintId);
						if (!hint) {
							return;
						}
						if (!hint.unlocked && !state.problem.state.timer.accepted) {
							return;
						}
						if (state.problem.state.timer.accepted && !state.answers.has(hint.id)) {
							const result = await this.actions.answer(state.problem, hint.id);
							if (result.state === 'revealed') {
								state.answers.set(result.hintId, result.answer);
								state.hintMessages.delete(result.hintId);
								hintAnswerCache.set(hintAnswerCacheKey(state.problem.ref, result.hintId), result.answer);
								state.problem = applyAnswerLikes(state.problem, result);
							} else {
								state.problem = applyHintLockRemaining(state.problem, result.hintId, result.remainingMs);
								state.hintMessages.set(result.hintId, result.remainingMs > 0
									? `提示尚未解锁，剩余 ${formatDuration(result.remainingMs)}。`
									: '网站尚未确认提示答案可查看。');
							}
						}
						this.refreshHintModal(value.hintId);
					}
					break;
				case 'like':
					if (typeof value.hintId !== 'string' || (value.target !== 'question' && value.target !== 'answer') || typeof value.liked !== 'boolean') {
						return;
					}
					state.problem = applyLikeResult(state.problem, await this.actions.like(state.problem, value.hintId, value.target, value.liked));
					this.refreshHintModal(value.hintId);
					break;
				case 'editorial':
					{
						if (state.cachedEditorial?.state === 'available') {
							state.editorial = state.cachedEditorial;
							await this.showEditorialPanel(state.cachedEditorial, state.problem, state.connected);
							return;
						}
						if (!state.connected) {
							return;
						}
						if (this.editorialRequestInFlight) {
							return;
						}
						const remainingMs = this.getCurrentEditorialRemainingMs(state);
						if (!state.problem.state.timer.accepted && remainingMs > 0) {
							this.showLockedEditorialNotice(remainingMs);
							return;
						}
						this.editorialRequestInFlight = true;
						const editorialRequestToken = ++this.editorialRequestToken;
						this.render();
						try {
							const result = await this.actions.editorial(state.problem);
							if (!result) {
								return;
							}
							state.editorial = result;
							if (result.state === 'available') {
								state.cachedEditorial = result;
								if (this.state === state && state.problem.ref === problemRef) {
									await this.showEditorialPanel(result, state.problem, state.connected);
								}
								void this.actions.saveEditorial(state.problem, result).catch(error => {
									console.error('Failed to save ShortestPath OJ editorial.', error);
									void vscode.window.showWarningMessage(localize('解题报告已打开，但未能保存到本地缓存；请稍后重新打开。'));
								});
							} else if (this.state === state && state.problem.ref === problemRef) {
								state.problem = applyEditorialLockRemaining(state.problem, result.remainingMs);
								state.editorialRemainingReceivedAtMs = Date.now();
								this.showLockedEditorialNotice(result.remainingMs, result.unlockReason || '');
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
					state.statusMessage = '正在通过网页提交；如浏览器出现安全验证，请在浏览器中完成。';
					this.render();
					await this.actions.submit(state.problem);
					return;
				case 'watchSubmission':
					if (typeof value.submissionId !== 'string' || !/^\d+$/.test(value.submissionId)) {
						throw new Error('提交 ID 必须是十进制字符串。');
					}
					await this.actions.watchSubmission(state.problem, value.submissionId);
					state.disconnectedSubmissions.delete(value.submissionId);
					break;
				case 'loadStress':
					if (!state.problem.capabilities.stress.supported) {
						return;
					}
					state.stressContext = await this.actions.loadStress(state.problem);
					for (const task of state.stressContext.tasks) {
						state.stressTasks.set(task.taskId, task);
						state.disconnectedStressTasks.delete(task.taskId);
						if (isStressFinished(task.status)) {
							state.finishedStressTasks.add(task.taskId);
						}
					}
					break;
				case 'startStress':
					if (!state.problem.capabilities.stress.supported) {
						return;
					}
					if (typeof value.submissionId !== 'string' || typeof value.rounds !== 'number' || !Number.isInteger(value.rounds) || value.rounds <= 0) {
						throw new Error('请选择可用提交并填写正整数轮数。');
					}
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
					if (this.unknownStressStarts.has(state.problem.ref)) {
						const choice = await this.confirm('上一次对拍启动结果未知。再次发起可能创建另一个任务，是否继续？', '继续', '取消');
						if (!choice) {
							return;
						}
						this.unknownStressStarts.delete(state.problem.ref);
					}
					{
						const task = await this.actions.startStress(state.problem, value.submissionId, value.rounds);
						state.stressTasks.set(task.taskId, task);
						this.unknownStressStarts.delete(state.problem.ref);
					}
					break;
				case 'addStressCounterExample':
					if (typeof value.taskId !== 'string') {
						return;
					}
					{
						const task = state.stressTasks.get(value.taskId);
						if (!task?.counterExample || !isStressFinished(task.status)) {
							throw new Error('当前对拍任务还没有可添加的反例。');
						}
						if (state.addingStressCounterExamples.has(task.taskId) || state.addedStressCounterExamples.has(task.taskId)) {
							return;
						}
						state.addingStressCounterExamples.add(task.taskId);
						try {
							await this.actions.addStressCounterExample(state.problem, task);
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
			if (value.command === 'startStress' && error instanceof OutcomeUnknownError) {
				this.unknownStressStarts.add(state.problem.ref);
			}
			const message = error instanceof Error ? error.message : String(error);
			this.showOperationToast(message);
			if (value.command === 'submit') {
				state.statusMessage = state.connected ? '已连接题目网页。' : '等待用户从网站重新发送题目。';
			}
			if ((value.command === 'answer' || value.command === 'openHintModal') && typeof value.hintId === 'string') {
				state.hintMessages.set(value.hintId, message);
				this.refreshHintModal(value.hintId);
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
		for (const key of Object.keys(problemViewSectionIds) as Array<keyof ProblemViewSections>) {
			if (this.pendingSections[key] !== this.sentSections[key]) {

				const html = this.pendingSections[key];
				changed[problemViewSectionIds[key]] = wrapTabSection(key, html);
			}
		}
		const timerJson = JSON.stringify(this.pendingTimer);
		if (Object.keys(changed).length === 0 && timerJson === this.sentTimerJson) {
			return;
		}
		const sections = this.pendingSections;
		const timer = this.pendingTimer;
		this.sentSections = sections;
		this.sentTimerJson = timerJson;
		void this.panel.webview.postMessage({ type: 'update', sections: changed, timer });
	}
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
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
	const unknownSubmissions = new Map<string, SubmissionAttempt>();
	const unknownStressStarts = new Set<string>();
	const panel = new ShortestPathOjProblemPanel(context.extensionUri, template, {
		answer: (problem, hintId) => bridge.requestHintAnswer(problem.ref, hintId),
		like: (problem, hintId, target, liked) => bridge.requestLike(problem.ref, hintId, target, liked),
		editorial: async problem => {
			let confirmed = false;
			if (shouldConfirmEditorial(problem)) {
				const result = await panel.confirm(problem.state.editorial.confirmationMessage, '确认查看', '取消');
				if (!result) {
					return undefined;
				}
				confirmed = true;
			}
			return bridge.requestEditorial(problem.ref, confirmed);
		},
		submit: async problem => {
			await submitProblem(problem, bridge, panel, unknownSubmissions);
		},
		watchSubmission: async (problem, submissionId) => {
			await bridge.requestSubmissionWatch(problem.ref, submissionId);
		},
		loadStress: problem => bridge.requestStressContext(problem.ref),
		startStress: async (problem, submissionId, rounds) => {
			const result = await bridge.requestStressStart(problem.ref, submissionId, rounds);
			return result.task;
		},
		addStressCounterExample: (problem, task) => addStressCounterExampleToCph(problem, task),
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
	}, unknownStressStarts);
	// Loading Shiki can take long enough for the page's first WebSocket connection after a
	// wake URI to fail. Start the local bridge first and upgrade the renderer when ready.
	void createProblemMarkdownRenderer(getShikiTheme).then(renderer => {
		renderProblemMarkdown = renderer;
		markdownContentCache = new WeakMap();
		panel.refreshEditorial();
		panel.reveal();
		log('Problem Markdown renderer initialized.');
	}).catch(error => log(`Failed to initialize problem Markdown renderer: ${error instanceof Error ? error.message : String(error)}`));
	context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(() => {
		markdownContentCache = new WeakMap();
		panel.refreshEditorial();
		panel.reveal();
	}));
	bridge = new ShortestPathOjLocalBridge({
		async importProblem(problem, signal) {
			signal.throwIfAborted();
			if (!vscode.workspace.workspaceFolders?.length) {
				void vscode.window.showErrorMessage(workspaceFolderRequiredMessage);
				throw new Error(workspaceFolderRequiredMessage);
			}
			const { action, cph } = await mutateWorkspaceProblemCache(async cache => {
				signal.throwIfAborted();
				const action: ImportAction = cache.problems[problem.ref] ? 'updated' : 'created';
				const previousSourcePath = cache.sourcePaths[problem.ref];
				cache.problems[problem.ref] = problem;
				const cph = await forwardSamplesToCph(problem, previousSourcePath, signal);
				signal.throwIfAborted();
				if (cph.sourcePath) {
					cache.sourcePaths[problem.ref] = cph.sourcePath;
				}
				return { action, cph };
			}, true);
			if (!cph.succeeded) {
				output.appendLine(`CPH Plus did not accept samples for ${problem.ref}.`);
			}
			return action;
		},
		async activateProblem(problem) {
			const sourcePath = (await readWorkspaceProblemCache()).sourcePaths[problem.ref];
			panel.showProblem(problem, true, sourcePath, true);
		},
		async updateProblemState(problemRef, state) {
			const applied = await mutateWorkspaceProblemCache(cache => {
				const problem = cache.problems[problemRef];
				if (!problem) {
					throw new Error('当前连接尚未导入题目。');
				}
				if (hasIncompatibleProblemState(problem)) {
					return false;
				}
				cache.problems[problemRef] = applyProblemState(problem, state);
				return true;
			}, applied => applied);
			if (applied) {
				panel.updateProblemState(problemRef, state);
			}
		},
		handleEvent(problemRef, event) {
			panel.handleEvent(problemRef, event);
		},
		handleDisconnect(problemRef) {
			panel.setDisconnected(problemRef);
		},
	}, bridgePort);
	context.subscriptions.push(
		bridge.onLongRunningRequest((problemRef, active) => panel.setLongRunningOperationNotice(problemRef, active)),
		bridge.onTrace(log),
	);
	bridge.onListening(() => log(`WebSocket bridge listening at ws://127.0.0.1:${bridgePort}/shortestpath-oj with shortestpath-oj-v1.`));
	bridge.onError(error => {
		log(`WebSocket bridge error: ${error.message}`);
		if (isAddressInUseError(error)) {
			void vscode.window.showErrorMessage(localizeFormat('ShortestPath OJ 集成无法启动：端口 {0} 已被占用。请关闭占用该端口的程序后重启 ShortestPath IDE。', String(bridgePort)));
		}
	});
	context.subscriptions.push(new vscode.Disposable(() => { void bridge.close(); }));

	context.subscriptions.push(vscode.window.registerUriHandler({
		handleUri(uri) {
			if (uri.authority === 'shortestpath.shortestpath-oj' && uri.path === '/wake') {
				log('Received ShortestPath OJ wake URI.');
			}
		},
	}));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.showProblem', () => panel.reveal()));
	const syncProblemPanelWithActiveTab = async (): Promise<void> => {
		if (await panel.hideProblemWhenSourceCloses()) {
			return;
		}
		if (!panel.hideProblemWhenSourceInactive()) {
			panel.restoreProblemWhenSourceActive();
		}
		panel.updateSourceEditorLabel();
	};
	const scheduleProblemPanelSync = () => {
		setTimeout(() => {
			void syncProblemPanelWithActiveTab();
		}, 0);
	};
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(scheduleProblemPanelSync));
	context.subscriptions.push(new vscode.Disposable(() => panel.clearSourceEditorLabel()));
	context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(scheduleProblemPanelSync));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.openIntegratedBrowser', async () => {
		await vscode.window.openBrowserTab('https://shortestpath.cn/topics', { viewColumn: vscode.ViewColumn.Active, preserveFocus: false });
	}));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.openIntegratedBrowserDirect', async () => {
		await vscode.window.openBrowserTab('https://shortestpath.cn/login', { viewColumn: vscode.ViewColumn.Active, preserveFocus: false });
	}));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.showProblemForCph', async (url: string) => {
		const cache = await readWorkspaceProblemCache();
		const problem = Object.values(cache.problems).find(item => item.url === url);
		if (problem) {
			panel.showProblem(problem, bridge.isBound(problem.ref), cache.sourcePaths[problem.ref]);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.hideProblemForCphSourcePath', async (sourcePath: string) => {
		const ref = findProblemRefForSourcePath((await readWorkspaceProblemCache()).sourcePaths, sourcePath);
		if (ref) {
			panel.hideProblemForCph(ref, sourcePath);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.submitProblem', async (problem: CphProblemForSubmission) => {
		await submitCphProblem(problem, bridge, panel, unknownSubmissions);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.submitProblemForUrl', async (url: string) => {
		const problem = Object.values((await readWorkspaceProblemCache()).problems).find(item => item.url === url);
		if (!problem) {
			throw new Error('请先将题目导入 CPH Plus 再从题目面板提交。');
		}
		await submitProblem(problem, bridge, panel, unknownSubmissions);
	}));
}

function getWorkspaceCacheDirectoryUri(): vscode.Uri {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		throw new Error(workspaceFolderRequiredMessage);
	}
	return vscode.Uri.joinPath(workspaceFolder.uri, workspaceCacheDirectoryName);
}

function getLegacyWorkspaceCacheUri(): vscode.Uri {
	return vscode.Uri.joinPath(getWorkspaceCacheDirectoryUri(), legacyWorkspaceCacheFileName);
}

function getWorkspaceProblemRecordUri(problemRef: string): vscode.Uri {
	return vscode.Uri.joinPath(getWorkspaceCacheDirectoryUri(), getWorkspaceProblemRecordFileName(problemRef));
}

function createEmptyWorkspaceProblemCache(): WorkspaceProblemCache {
	return {
		version: 4,
		problems: Object.create(null) as Record<string, ImportedProblem>,
		sourcePaths: Object.create(null) as Record<string, string>,
		submissions: Object.create(null) as Record<string, SubmissionHistoryEntry[]>,
		editorials: Object.create(null) as Record<string, EditorialResult>,
	};
}

async function readWorkspaceProblemCache(): Promise<WorkspaceProblemCache> {
	await ensureWorkspaceCacheMigration();
	return readWorkspaceProblemCacheFiles();
}

async function ensureWorkspaceCacheMigration(): Promise<void> {
	if (workspaceCacheMigration) {
		await workspaceCacheMigration;
		return;
	}
	const migration = (async () => {
		await migrateLegacyWorkspaceCache({
			readCurrent: readWorkspaceProblemCacheFiles,
			readLegacy: async () => {
				try {
					return await readLegacyWorkspaceProblemCache();
				} catch (error) {
					console.warn(`Unable to migrate ${legacyWorkspaceCacheFileName}; leaving it unchanged.`, error);
					return undefined;
				}
			},
			merge: (cache, legacyCache) => {
				for (const [problemRef, problem] of Object.entries(legacyCache.problems)) {
					if (!cache.problems[problemRef]) {
						cache.problems[problemRef] = problem;
						if (legacyCache.sourcePaths[problemRef]) {
							cache.sourcePaths[problemRef] = legacyCache.sourcePaths[problemRef];
						}
						cache.submissions[problemRef] = legacyCache.submissions[problemRef] ?? [];
					}
				}
				return cache;
			},
			writeCurrent: writeWorkspaceProblemCache,
			deleteLegacy: async () => {
				try {
					await vscode.workspace.fs.delete(getLegacyWorkspaceCacheUri(), { recursive: false, useTrash: false });
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

async function readWorkspaceProblemCacheFiles(): Promise<WorkspaceProblemCache> {
	try {
		const cache = createEmptyWorkspaceProblemCache();
		let needsRewrite = false;
		const entries = await vscode.workspace.fs.readDirectory(getWorkspaceCacheDirectoryUri());
		for (const [name, type] of entries) {
			if (type !== vscode.FileType.File || name === legacyWorkspaceCacheFileName || !name.endsWith('.json')) {
				continue;
			}
			try {
				const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(getWorkspaceCacheDirectoryUri(), name)));
				if (!content.trim()) {
					continue;
				}
				const record = JSON.parse(content) as Partial<WorkspaceProblemRecord>;
				if (record.version !== workspaceProblemRecordVersion || !record.problem || typeof record.problem !== 'object') {
					continue;
				}
				const problem = restoreCachedProblemCompatibilityWarnings(record.problem as ImportedProblem);
				if (name !== getWorkspaceProblemRecordUri(problem.ref).path.split('/').at(-1)) {
					console.warn(`Ignoring ShortestPath OJ cache record with mismatched file name: ${name}`);
					continue;
				}
				cache.problems[problem.ref] = problem;
				if (typeof record.sourcePath === 'string' && isHeaderSafeSourcePath(record.sourcePath)) {
					cache.sourcePaths[problem.ref] = record.sourcePath;
				} else if (record.sourcePath !== undefined) {
					needsRewrite = true;
				}
				const submissions = sanitizeSubmissionHistory(record.submissions);
				cache.submissions[problem.ref] = submissions.entries;
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
				needsRewrite ||= problem !== record.problem || submissions.changed;
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

async function readLegacyWorkspaceProblemCache(): Promise<WorkspaceProblemCache | undefined> {
	try {
		const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(getLegacyWorkspaceCacheUri()));
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
		let historyWasSanitized = false;
		if (value.problems && typeof value.problems === 'object') {
			for (const [problemRef, cachedProblem] of Object.entries(value.problems)) {
				const problem = restoreCachedProblemCompatibilityWarnings(cachedProblem as ImportedProblem);
				if (problem.ref !== problemRef) {
					throw new Error(`旧题目缓存的键 ${problemRef} 与题目路径 ${problem.ref} 不一致。`);
				}
				problems[problemRef] = problem;
				if (problem !== cachedProblem) {
					historyWasSanitized = true;
				}
			}
		}
		if (value.sourcePaths && typeof value.sourcePaths === 'object') {
			for (const [problemRef, sourcePath] of Object.entries(value.sourcePaths)) {
				if (typeof sourcePath === 'string' && isHeaderSafeSourcePath(sourcePath)) {
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
		const cache: WorkspaceProblemCache = {
			version: 4,
			problems,
			sourcePaths,
			submissions,
			editorials,
		};
		if (historyWasSanitized) {
			workspaceCachesNeedingRewrite.add(cache);
		}
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

async function writeWorkspaceProblemCache(cache: WorkspaceProblemCache): Promise<void> {
	await vscode.workspace.fs.createDirectory(getWorkspaceCacheDirectoryUri());
	assertUniqueWorkspaceProblemRecordFileNames(Object.keys(cache.problems));
	await Promise.all(Object.entries(cache.problems).map(async ([problemRef, problem]) => {
		const record: WorkspaceProblemRecord = {
			version: workspaceProblemRecordVersion,
			problem,
			sourcePath: cache.sourcePaths[problemRef],
			submissions: cache.submissions[problemRef] ?? [],
			editorial: cache.editorials[problemRef],
		};
		await vscode.workspace.fs.writeFile(getWorkspaceProblemRecordUri(problemRef), new TextEncoder().encode(`${JSON.stringify(record, undefined, '\t')}\n`));
	}));
	workspaceCachesNeedingRewrite.delete(cache);
}

function mutateWorkspaceProblemCache<T>(mutation: (cache: WorkspaceProblemCache) => T | Promise<T>, alwaysWrite: boolean | ((result: T) => boolean)): Promise<T> {
	const operation = workspaceCacheMutationTail.then(async () => {
		const cache = await readWorkspaceProblemCache();
		const result = await mutation(cache);
		if ((typeof alwaysWrite === 'function' ? alwaysWrite(result) : alwaysWrite) || workspaceCachesNeedingRewrite.has(cache)) {
			await writeWorkspaceProblemCache(cache);
		}
		return result;
	});
	workspaceCacheMutationTail = operation.then(() => undefined, () => undefined);
	return operation;
}

async function submitCphProblem(
	value: CphProblemForSubmission,
	bridge: ShortestPathOjLocalBridge,
	panel: ShortestPathOjProblemPanel,
	unknownSubmissions: Map<string, SubmissionAttempt>,
): Promise<void> {
	if (typeof value.url !== 'string' || typeof value.srcPath !== 'string') {
		throw new Error('当前 CPH 活动题目不是 ShortestPath OJ 题目。');
	}
	const problem = Object.values((await readWorkspaceProblemCache()).problems).find(item => item.url === value.url);
	if (!problem) {
		throw new Error('当前 CPH 活动题目不是 ShortestPath OJ 题目。');
	}
	await submitProblem(problem, bridge, panel, unknownSubmissions, value.srcPath);
}

async function submitProblem(
	problem: ImportedProblem,
	bridge: ShortestPathOjLocalBridge,
	panel: ShortestPathOjProblemPanel,
	unknownSubmissions: Map<string, SubmissionAttempt>,
	explicitSourcePath?: string,
): Promise<void> {
	if (problem.capabilities.submission.languages.length === 0) {
		throw new Error('网页未提供可用的提交语言，无法发起提交。');
	}
	if (!bridge.isBound(problem.ref)) {
		throw new Error('题目网页未连接，请从网站重新在 ShortestPath IDE 中打开。');
	}
	const retry = unknownSubmissions.get(problem.ref);
	if (retry) {
		const choice = await panel.confirm(`上一次提交结果未知。重试将原样提交 ${retry.sourcePath}，并复用同一个操作 ID。`, '重试', '新建提交');
		if (choice) {
			await sendSubmissionAttempt(problem, bridge, panel, unknownSubmissions, retry);
			return;
		}
		unknownSubmissions.delete(problem.ref);
	}
	const sourcePath = explicitSourcePath ?? (await readWorkspaceProblemCache()).sourcePaths[problem.ref];
	if (!sourcePath) {
		throw new Error('请先将题目导入 CPH Plus 再从题目面板提交。');
	}
	const safeSourcePath = await validateWorkspaceSourcePath(sourcePath);
	const document = await vscode.workspace.openTextDocument(vscode.Uri.file(safeSourcePath));
	if (!(await document.save())) {
		throw new Error('提交前请先保存源文件。');
	}
	const sourceCode = document.getText();
	if (!sourceCode.trim()) {
		throw new Error('源文件为空。');
	}
	const language = await selectSubmissionLanguage(problem.capabilities.submission.languages, safeSourcePath);
	if (!language) {
		return;
	}
	const attempt: SubmissionAttempt = {
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
	panel: ShortestPathOjProblemPanel,
	unknownSubmissions: Map<string, SubmissionAttempt>,
	attempt: SubmissionAttempt,
): Promise<void> {
	unknownSubmissions.set(problem.ref, attempt);
	let result;
	try {
		result = await bridge.requestSubmission(problem.ref, attempt.operationId, attempt.language, attempt.sourceCode);
		unknownSubmissions.delete(problem.ref);
	} catch (error) {
		if (!(error instanceof OutcomeUnknownError)) {
			unknownSubmissions.delete(problem.ref);
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
		throw new Error('提交源码必须位于当前工作区。');
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
	throw new Error(`拒绝提交工作区之外的文件：${realSourcePath}`);
}

async function selectSubmissionLanguage(languages: SubmissionLanguage[], sourcePath: string): Promise<SubmissionLanguage | undefined> {
	const extension = sourcePath.toLowerCase().split('.').pop();
	const configured = vscode.workspace.getConfiguration('shortestpath.oj').get<string>('cppSubmissionLanguage', 'ask');
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
		{ title: '选择 ShortestPath OJ 提交语言', placeHolder: '使用网站当前提供的语言' },
	);
	return selected?.language;
}

function forwardSamplesToCph(problem: ImportedProblem, sourcePath: string | undefined, signal: AbortSignal): Promise<CphImportResult> {
	signal.throwIfAborted();
	const parts = problem.ref.split('/');
	const payload = JSON.stringify({
		name: problem.title,
		url: problem.url,
		interactive: false,
		memoryLimit: problem.limits.memoryMB,
		timeLimit: problem.limits.timeMs,
		group: parts.slice(0, -1).join('/'),
		tests: problem.samples.map(sample => ({ input: sample.input, output: sample.output })),
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
		};
		if (sourcePath && isHeaderSafeSourcePath(sourcePath)) {
			headers['X-ShortestPath-Source-Path'] = sourcePath;
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
					finish(typeof result.sourcePath === 'string' && isHeaderSafeSourcePath(result.sourcePath) ? { succeeded: true, sourcePath: result.sourcePath } : { succeeded: false });
				} catch {
					finish({ succeeded: false });
				}
			});
		});
		signal.addEventListener('abort', abort, { once: true });
		timeout = setTimeout(() => request.destroy(), 5000);
		request.once('error', () => finish({ succeeded: false }));
		request.end(payload);
	});
}

async function addStressCounterExampleToCph(problem: ImportedProblem, task: StressTask): Promise<void> {
	const sourcePath = (await readWorkspaceProblemCache()).sourcePaths[problem.ref];
	if (!sourcePath) {
		throw new Error('请先将题目添加到 CPH。');
	}
	if (!task.counterExample) {
		throw new Error('当前对拍任务没有反例。');
	}
	const payload = JSON.stringify({ input: task.counterExample.input, output: task.counterExample.expected });
	await new Promise<void>((resolve, reject) => {
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		};
		const request = http.request({
			hostname: '127.0.0.1',
			port: 27121,
			method: 'POST',
			path: '/',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(payload),
				'X-ShortestPath-OJ-Add-Test': 'true',
				'X-ShortestPath-Source-Path': sourcePath,
			},
		}, response => {
			const chunks: Buffer[] = [];
			response.on('data', (chunk: Buffer) => chunks.push(chunk));
			response.on('end', () => {
				if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
					finish();
					return;
				}
				finish(new Error(Buffer.concat(chunks).toString('utf8') || '无法将反例添加到 CPH。'));
			});
		});
		const timeout = setTimeout(() => {
			request.destroy();
			finish(new Error('无法连接 CPH，请确认 CPH Plus 已启用。'));
		}, 5000);
		request.once('error', () => finish(new Error('无法连接 CPH，请确认 CPH Plus 已启用。')));
		request.end(payload);
	});
}

type ProblemViewSections = {
	operationNotice: string;
	status: string;
	submissionButton: string;
	information: string;
	statement: string;
	hints: string;
	editorialAction: string;
	submissions: string;
	compatibilityWarning: string;
};

const problemViewSectionIds: Record<keyof ProblemViewSections, string> = {
	operationNotice: 'oj-operation-notice',
	status: 'oj-status',
	submissionButton: 'oj-submission-button',
	information: 'oj-information',
	statement: 'oj-statement',
	hints: 'oj-hints',
	editorialAction: 'oj-editorial-action',
	submissions: 'oj-submissions',
	compatibilityWarning: 'oj-compatibility-warning',
};

const problemViewTabIds: Record<'statement' | 'hints' | 'submissions', string> = {
	statement: 'oj-statement',
	hints: 'oj-hints',
	submissions: 'oj-submissions',
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
	const { problem } = state;
	return {
		operationNotice: operationToastMessage
			? `<div class="operation-notice error" role="alert">${escapeHtml(operationToastMessage)}</div>`
			: showLongRunningOperationNotice
				? `<div class="operation-notice" role="status">${localize('操作长时间没有响应，可能是因为触发了安全验证，请到浏览器处理。')}</div>`
				: '',
		status: `<div class="connection ${state.connected ? 'connected' : 'disconnected'}">${escapeHtml(state.statusMessage)}</div>`,
		submissionButton: `<button type="button" data-command="submit"${state.connected ? '' : ' disabled'}>${localize('提交代码')}</button>`,
		information: renderInformation(problem),
		statement: renderStatement(problem),
		hints: renderHints(state),
		editorialAction: renderEditorialAction(problem, state.connected, state.cachedEditorial?.state === 'available', editorialRequestInFlight),
		submissions: renderSubmissions(state),
		compatibilityWarning: state.compatibilityWarningDismissed || problem.compatibilityWarnings.length === 0
			? ''
			: `<div class="compatibility-warning" role="status"><span>${escapeHtml(problem.compatibilityWarnings.join(' '))}</span><button type="button" data-command="dismissCompatibilityWarning" aria-label="${localize('关闭兼容性提示')}">${localize('关闭')}</button></div>`,
	};
}

function getProblemWebviewHtml(state: ProblemPanelState, sections: ProblemViewSections, template: string, webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const { problem } = state;
	const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'problemView.js'));
	const styles = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'problemView.css'));
	const katexStyles = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'katex', 'katex.min.css'));
	const timer = getProblemViewTimer(state);
	const judgeType = describeJudgeType(problem.judge.checkerType, problem.judge.floatEpsilon);
	const judgeTypeTooltip = judgeType === 'Float Judge' && problem.judge.floatEpsilon !== null ? describeFloatJudgeTolerance(problem.judge.floatEpsilon) : undefined;
	const metadataJudge = judgeType ? `<strong class="judge-type${judgeTypeTooltip ? ' judge-type-with-tolerance' : ''}"${judgeTypeTooltip ? ' tabindex="0"' : ''}>${escapeHtml(judgeType)}${judgeTypeTooltip ? `<span class="judge-type-tolerance" role="tooltip">${escapeHtml(judgeTypeTooltip)}</span>` : ''}</strong>` : '';
	const metadataParts = [
		`<span class="meta-item meta-collapsible">${escapeHtml(problem.topic.title)}</span>`,
		`<span class="meta-item meta-collapsible">${escapeHtml(problem.judge.mode.toUpperCase())}</span>`,
		metadataJudge ? `<span class="meta-item">${metadataJudge}</span>` : '',
	].filter(Boolean);
	return fillTemplate(template, {
		CSP_SOURCE: webview.cspSource,
		KATEX_STYLES_URI: katexStyles.toString(),
		STYLES_URI: styles.toString(),
		SCRIPT_URI: script.toString(),
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
		STATEMENT: sections.statement,
		HINTS: sections.hints,
		EDITORIAL_ACTION: sections.editorialAction,
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
	const coreTags = problem.metadata.coreAlgorithm ? [`<span class="tag core">${escapeHtml(problem.metadata.coreAlgorithm)}</span>`] : [];
	const auxiliaryTags = problem.metadata.auxiliaryAlgorithms.map(tag => `<span class="tag auxiliary">${escapeHtml(tag)}</span>`);
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
	const difficultyTag = `<span class="tag difficulty-tag ${difficultyTagClasses}" style="--difficulty-background: ${escapeAttribute(difficulty.backgroundHex)}; --difficulty-foreground: ${escapeAttribute(difficulty.textColor)};">${escapeHtml(difficulty.label)}</span>`;
	return `<div class="info-grid">
				<div class="info-cell"><span class="info-label">${localize('时间限制')}</span><span class="info-value">${problem.limits.timeMs} ms</span></div>
				<div class="info-cell"><span class="info-label">${localize('内存限制')}</span><span class="info-value">${problem.limits.memoryMB} MB</span></div>
				<div class="info-cell"><span class="info-label">${localize('题目难度')}</span><span class="info-value">${difficultyTag}</span></div>
				<div class="info-cell info-action tag-popover-anchor">
					<span class="info-label">${localize('题目标签')}</span>
					<span class="info-value tag-summary" aria-label="${summaryCount} 个标签">${summaryCount > 0 ? `${summaryCount}` : '0'} <span class="tag-arrow" aria-hidden="true"></span></span>
					<div class="tag-popover">
						<div class="tag-popover-arrow"></div>
						<div class="tag-popover-content">${allTags}</div>
					</div>
				</div>
			</div>`;
}

function renderStatement(problem: ImportedProblem): string {
	const sections: Array<[string, MarkdownContent | undefined]> = [
		[localize('题目描述'), problem.statement.description],
		[localize('输入格式'), problem.statement.inputFormat],
		[localize('输出格式'), problem.statement.outputFormat],
		[localize('数据范围'), problem.statement.constraints],
	];
	const statement = sections
		.filter((entry): entry is [string, MarkdownContent] => entry[1] !== undefined)
		.map(([title, content]) => `<section><h2>${title}</h2><div data-i18n-ignore>${renderMarkdownContent(content, problem.url)}</div></section>`)
		.join('');
	const samples = problem.samples
		.map((sample, index) => {
			const io = `<article class="sample">
				<h3>样例 ${index + 1}</h3>
				<div class="sample-io-grid">
					<div class="io-block">
						<div class="io-header"><h4>样例输入</h4><button type="button" class="copy-btn" aria-label="复制样例输入">复制</button></div>
						<pre><code>${escapeHtml(sample.input)}</code></pre>
					</div>
					<div class="io-block">
						<div class="io-header"><h4>样例输出</h4><button type="button" class="copy-btn" aria-label="复制样例输出">复制</button></div>
						<pre><code>${escapeHtml(sample.output)}</code></pre>
					</div>
				</div>
			</article>`;
			const explanation = sample.explanation.trim()
				? `<div class="sample-explanation" data-render-math data-i18n-ignore>${renderProblemMarkdown(sample.explanation, problem.url)}</div>`
				: '';
			return `${io}${explanation}`;
		})
		.join('');
	return `${statement}${samples ? `<section class="samples"><h2>样例</h2>${samples}</section>` : ''}`;
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
		const statusText = state.problem.state.timer.accepted ? '' : viewed ? '已查看答案' : unlocked ? '已解锁' : '提示尚未解锁';
		const remainingAttr = !unlocked && hint.remainingMs > 0 ? ` data-remaining-ms="${hint.remainingMs}"` : '';
		const viewedClass = viewed ? ' viewed' : '';
		const countdown = locked && hint.remainingMs > 0 ? `<span class="hint-countdown">剩余 ${formatDuration(hint.remainingMs)}</span>` : '';
		const status = statusText || countdown ? `<span class="hint-list-status"><span class="hint-lock-label">${escapeHtml(statusText)}</span>${countdown}</span>` : '';
		const itemTag = unlocked ? 'button' : 'div';
		const interaction = unlocked
			? ` type="button" data-command="openHintModal" data-hint-id="${escapeAttribute(hint.id)}"`
			: ' aria-disabled="true"';
		return `<${itemTag} class="hint-list-item${unlocked ? '' : ' locked'}${viewedClass}"${interaction} aria-label="提示 ${hint.seq}${statusText ? `，${escapeAttribute(statusText)}` : ''}"${remainingAttr}><span class="hint-list-num">提示 ${hint.seq}</span>${status}</${itemTag}>`;
	}).join('');
	return `<section class="hints"><h2>提示</h2><div class="hint-list">${items}</div></section>`;
}

const likeSvgOutlined = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-thumbs-up size-3.5" aria-hidden="true"><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"></path><path d="M7 10v12"></path></svg>';
const likeSvgFilled = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-thumbs-up size-3.5 fill-current" aria-hidden="true"><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"></path><path d="M7 10v12"></path></svg>';

function renderLikeButton(hintId: string, target: 'question' | 'answer', likes: { liked: boolean; count: number }, enabled: boolean): string {
	const label = `${likes.liked ? '取消点赞' : '点赞'}提示${target === 'question' ? '问题' : '答案'}，当前 ${likes.count} 赞`;
	return `<button type="button" class="like-btn${likes.liked ? ' liked' : ''}" data-command="like" data-hint-id="${escapeAttribute(hintId)}" data-target="${target}" data-liked="${likes.liked}" aria-label="${escapeAttribute(label)}"${enabled ? '' : ' disabled'}><span class="like-icon like-icon-outline" aria-hidden="true">${likeSvgOutlined}</span><span class="like-icon like-icon-filled" aria-hidden="true">${likeSvgFilled}</span><span class="like-count" aria-hidden="true">${likes.count}</span></button>`;
}

function renderHintModal(state: ProblemPanelState, hint: ProblemHint): string {
	const questionContent = hint.question
		? `<div data-render-math data-i18n-ignore>${renderMarkdownContent(hint.question, state.problem.url)}</div>`
		: '<p>提示问题尚未解锁。</p>';
	const questionLike = renderLikeButton(hint.id, 'question', hint.likes.question, state.connected && Boolean(hint.question));
	const answer = state.answers.get(hint.id);
	const answerLike = renderLikeButton(hint.id, 'answer', hint.likes.answer, state.connected && Boolean(answer));
	const unlocked = hint.unlocked || state.problem.state.timer.accepted;
	const canRequestAnswer = state.connected;
	const canShowAnswer = unlocked && canRequestAnswer;
	const answerContent = answer
		? `<div data-render-math data-i18n-ignore>${renderMarkdownContent(answer, state.problem.url)}</div>`
		: `<button type="button" data-command="answer" data-hint-id="${escapeAttribute(hint.id)}" data-can-request="${canRequestAnswer}"${canShowAnswer ? '' : ' disabled'}${!unlocked && hint.remainingMs > 0 ? ` data-remaining-ms="${hint.remainingMs}"` : ''}>${unlocked ? '显示答案' : `<span class="hint-countdown">剩余 ${formatDuration(hint.remainingMs)}</span>`}</button>`;
	const feedback = state.hintMessages.get(hint.id);
	return `<div class="modal-header"><h3>提示 ${hint.seq}</h3><button type="button" class="modal-close" data-command="closeModal" aria-label="关闭提示">×</button></div><div class="modal-body">${feedback ? `<p class="hint-feedback" role="status">${escapeHtml(feedback)}</p>` : ''}<div class="modal-columns"><div class="modal-column"><div class="hint-section-heading"><h4>问题</h4>${questionLike}</div>${questionContent}</div><div class="modal-column"><div class="hint-section-heading"><h4>答案</h4>${answerLike}</div>${answerContent}</div></div></div>`;
}

function renderEditorialAction(problem: ImportedProblem, connected: boolean, hasCachedEditorial: boolean, requestInFlight: boolean): string {
	if (requestInFlight) {
		return '<button type="button" class="editorial-loading" data-command="editorial" disabled>正在加载解题报告…</button>';
	}
	if (hasCachedEditorial) {
		return '<button type="button" data-command="editorial">查看解题报告</button>';
	}
	if (!problem.state.timer.accepted && problem.state.editorial.remainingMs > 0) {
		return '<button type="button" class="editorial-locked" data-command="editorial">查看解题报告</button>';
	}
	return `<button type="button" data-command="editorial"${canViewEditorial(connected, hasCachedEditorial) ? '' : ' disabled'}>查看解题报告</button>`;
}

function getEditorialPanelHtml(editorial: EditorialResult, problem: ImportedProblem, webview: vscode.Webview, extensionUri: vscode.Uri, canLike: boolean): string {
	if (editorial.state !== 'available') {
		return '';
	}
	const styles = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'problemView.css'));
	const katexStyles = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'katex', 'katex.min.css'));
	const baseUrl = problem.url;
	const hintsHtml = editorial.hints.map(hint => {
		const qLike = renderLikeButton(hint.hintId, 'question', { liked: hint.questionLiked, count: hint.questionLikeCount }, canLike);
		const aLike = renderLikeButton(hint.hintId, 'answer', { liked: hint.answerLiked, count: hint.answerLikeCount }, canLike);
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
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src https:;">
<link rel="stylesheet" href="${katexStyles}">
<link rel="stylesheet" href="${styles}">
</head>
<body class="editorial-body">
<h1 class="editorial-title">解题报告</h1>
<div class="editorial-container">
<div class="editorial-text">
<section class="editorial-section"><h2>提示回顾</h2>${hintsHtml}</section>
<section class="editorial-section"><h2>简化题解</h2><div data-render-math data-i18n-ignore>${renderMarkdownContent(editorial.simpleContent, baseUrl)}</div></section>
<section class="editorial-section"><h2>详细题解</h2><div data-render-math data-i18n-ignore>${renderMarkdownContent(editorial.content, baseUrl)}</div></section>
</div>
<div class="editorial-resizer" role="separator" aria-label="调整题解和参考代码宽度" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="80" tabindex="0"></div>
<div class="editorial-code"><h2>参考代码</h2>${codeHtml}</div>
</div>
<script>
const vscode = acquireVsCodeApi();
const editorialContainer = document.querySelector('.editorial-container');
const editorialResizer = document.querySelector('.editorial-resizer');
const savedLayout = vscode.getState() || {};
let editorialCodeWidth = typeof savedLayout.editorialCodeWidth === 'number' ? Math.min(80, Math.max(0, savedLayout.editorialCodeWidth)) : 45;
const saveEditorialLayout = () => vscode.setState({ editorialCodeWidth });
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
window.addEventListener('message', (event) => {
	const message = event.data;
	if (!message || message.type !== 'editorialLike' || typeof message.hintId !== 'string') {
		return;
	}
	document.querySelectorAll('[data-command="like"]').forEach((element) => {
		if (!(element instanceof HTMLButtonElement) || element.dataset.hintId !== message.hintId) {
			return;
		}
		const isQuestion = element.dataset.target === 'question';
		const liked = isQuestion ? message.questionLiked : message.answerLiked;
		const count = isQuestion ? message.questionLikeCount : message.answerLikeCount;
		if (typeof liked !== 'boolean' || typeof count !== 'number') {
			return;
		}
		element.dataset.liked = String(liked);
		element.classList.toggle('liked', liked);
		element.setAttribute('aria-label', (liked ? '取消点赞' : '点赞') + '提示' + (isQuestion ? '问题' : '答案') + '，当前 ' + count + ' 赞');
		const countElement = element.querySelector('.like-count');
		if (countElement) {
			countElement.textContent = String(count);
		}
	});
});
document.addEventListener('click', (event) => {
	const button = event.target.closest('[data-command="like"]');
	if (!button) {
		return;
	}
	const hintId = button.dataset.hintId;
	const target = button.dataset.target;
	const liked = button.dataset.liked === 'true';
	vscode.postMessage({ command: 'like', hintId, target, liked: !liked });
});
</script>
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
			const status = renderSubmissionStatus(item.status, statusClass);
			const localHistoryNotice = !liveSubmission ? '<p class="submission-history-notice">此提交来自本地保存的历史记录，未存储具体评测信息，因此没有更多可用信息。</p>' : '';
			const detailNotice = liveSubmission && item.detailState === 'unavailable' ? `<p class="warning">结果已结束，详情暂不可用：${escapeHtml(item.detailError?.message ?? '')}</p>` : '';
			const compileError = liveSubmission && item.compileErrorMessage ? `<pre class="error"><code>${escapeHtml(item.compileErrorMessage)}</code></pre>` : '';
			const details = liveSubmission && item.details.length ? `<table><thead><tr><th>#</th><th>测试点</th><th>状态</th><th>时间</th><th>内存</th></tr></thead><tbody>${item.details.map(detail => {
				const detailStatus = describeSubmissionDetailStatus(detail.status);
				const detailStatusHtml = detailStatus.statusClass ? renderSubmissionStatus(detailStatus.label, detailStatus.statusClass) : escapeHtml(detailStatus.label);
				return `<tr><td>${detail.seq}</td><td>${escapeHtml(detail.caseName)}</td><td>${detailStatusHtml}</td><td>${detail.timeMs} ms</td><td>${detail.memoryKB} KB</td></tr>`;
			}).join('')}</tbody></table>` : '';
			const disconnected = liveSubmission && state.disconnectedSubmissions.has(item.submissionId) ? '<p class="warning">评测转发已断开；后端任务状态未知，请重新连接并恢复观察。</p>' : '';
			const showStressHint = liveSubmission && shouldShowStressHint(state, item);
			const stressSection = showStressHint ? renderSubmissionStress(state, item) : '';
			const shouldOpen = index === 0;
			const stagePrefix = stage ? `${escapeHtml(stage)} · ` : '';
			const summary = `<span class="submission-summary-title">提交 ${escapeHtml(item.submissionId)} · ${status}</span><span class="submission-summary-meta">${stagePrefix}${item.score} 分 · ${item.maxTimeMs} ms · ${item.maxMemoryKB} KB</span>`;
			const body = `${localHistoryNotice}${disconnected}${detailNotice}${compileError}${details}${stressSection}`;
			return body ? `<details class="submission" data-persist-key="submission:${escapeAttribute(item.submissionId)}"${shouldOpen ? ' open' : ''}><summary>${summary}</summary><div class="submission-body">${body}</div></details>` : `<article class="submission submission-record">${summary}</article>`;
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
				? '<progress></progress><span>运行中，网站尚未提供轮数进度</span>'
				: `<progress max="${task.roundsPlanned}" value="${Math.min(task.roundsExecuted, task.roundsPlanned)}"></progress><span>${task.roundsExecuted} / ${task.roundsPlanned}</span>`;
			const canAddCounterExample = Boolean(task.counterExample) && isStressFinished(task.status);
			const counterExampleAction = canAddCounterExample ? `<button type="button" data-command="addStressCounterExample" data-task-id="${escapeAttribute(task.taskId)}"${state.addingStressCounterExamples.has(task.taskId) || state.addedStressCounterExamples.has(task.taskId) ? ' disabled' : ''}>${state.addedStressCounterExamples.has(task.taskId) ? '已添加到 CPH' : state.addingStressCounterExamples.has(task.taskId) ? '正在添加到 CPH…' : '添加到 CPH'}</button>` : '';
			const counterExample = task.counterExample ? `<details><summary>反例</summary><h4>输入</h4><pre><code>${escapeHtml(task.counterExample.input)}</code></pre><h4>期望输出</h4><pre><code>${escapeHtml(task.counterExample.expected)}</code></pre><h4>实际输出</h4><pre><code>${escapeHtml(task.counterExample.actual)}</code></pre></details>${counterExampleAction}` : '';
			const disconnected = state.disconnectedStressTasks.has(task.taskId) ? '<p class="warning">对拍转发已断开；后端任务仍可能继续，请重新连接并刷新对拍上下文。</p>' : '';
			return `<div class="stress-task"><h4>对拍任务 ${escapeHtml(task.taskId)} · ${escapeHtml(task.status)}</h4><div class="progress">${progress}</div>${disconnected}${task.errorMessage ? `<p class="error">${escapeHtml(task.errorMessage)}</p>` : ''}${counterExample}</div>`;
		}).join('');
	}
	const defaultRounds = state.stressContext?.defaultRounds ?? state.problem.capabilities.stress.defaultRounds ?? 120;
	const hint = '<p class="submission-stress-hint">提交出现 WA，可以使用对拍找到错误数据。</p>';
	const button = `<button type="button" data-command="startStress" data-submission-id="${escapeAttribute(submissionId)}" data-rounds="${defaultRounds}"${state.connected ? '' : ' disabled'}>发起对拍</button>`;
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
	if (!isWrongAnswerStatus(submission.status)) {
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

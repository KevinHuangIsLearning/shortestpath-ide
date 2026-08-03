/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as vscode from 'vscode';
import { canRequestEditorial, shouldConfirmEditorial } from './editorialAccess';
import { createProblemMarkdownRenderer, ProblemMarkdownRenderer } from './markdownRenderer';
import { findOpenFileViewColumn, OpenFileTabGroup, shouldHideProblemPanelWhenSourceInactive, shouldRestoreProblemPanel, shouldRestoreProblemPanelAfterEditorial } from './problemPanelLifecycle';
import { OutcomeUnknownError, ShortestPathOjLocalBridge } from './shortestpathOjLocalBridge';
import {
	applyEditorialLikeResult,
	applyEditorialLockRemaining,
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
	bridgePort,
} from './shortestpathOjProtocol';

const workspaceCacheDirectoryName = '.shortestpath';
const workspaceCacheFileName = 'oj-problems.json';

type WorkspaceProblemCache = {
	version: 3;
	problems: Record<string, ImportedProblem>;
	sourcePaths: Record<string, string>;
};

type CphImportResult = { succeeded: boolean; sourcePath?: string };


function isWrongAnswerStatus(status: string): boolean {
	return status === 'WA' || status === 'Wrong Answer' || /\bWA\b/i.test(status);
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
	connected: boolean;
	statusMessage: string;
	answers: Map<string, MarkdownContent>;
	hintMessages: Map<string, string>;
	editorial?: EditorialResult;
	submissions: Map<string, SubmissionSnapshot>;
	finishedSubmissions: Set<string>;
	disconnectedSubmissions: Set<string>;
	stressContext?: StressContext;
	stressTasks: Map<string, StressTask>;
	finishedStressTasks: Set<string>;
	disconnectedStressTasks: Set<string>;
	addingStressCounterExamples: Set<string>;
	addedStressCounterExamples: Set<string>;
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
};

class ShortestPathOjProblemPanel {
	private panel: vscode.WebviewPanel | undefined;
	private state: ProblemPanelState | undefined;
	private sentSections: ProblemViewSections | undefined;
	private sentTimerJson = '';
	private pendingSections: ProblemViewSections | undefined;
	private pendingTimer: ProblemViewTimer | undefined;
	private webviewReady = false;
	private renderedProblemRef: string | undefined;
	private editorialPanel: vscode.WebviewPanel | undefined;
	private reopenProblemAfterEditorial = false;
	private editorialHiddenSourcePath: string | undefined;
	private suppressRestoreForInactiveSource = false;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly template: string,
		private readonly actions: ProblemPanelActions,
		private readonly unknownStressStarts: Set<string>,
	) { }

	showProblem(problem: ImportedProblem, connected: boolean, sourcePath?: string): void {
		if (!this.state || this.state.problem.ref !== problem.ref) {
			this.reopenProblemAfterEditorial = false;
			this.editorialHiddenSourcePath = undefined;
			this.editorialPanel?.dispose();
			this.editorialPanel = undefined;
			const answers = new Map<string, MarkdownContent>();
			for (const hint of problem.state.hints) {
				const cached = hintAnswerCache.get(hintAnswerCacheKey(problem.ref, hint.id));
				if (cached) {
					answers.set(hint.id, cached);
				}
			}
			this.state = {
				problem,
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
				sourcePath,
			};
		} else {
			this.state.problem = problem;
			this.state.connected = connected;
			this.state.statusMessage = connected ? '已连接题目网页。' : '等待用户从网站重新发送题目。';
			if (sourcePath) {
				this.state.sourcePath = sourcePath;
			}
		}
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
			panel.reveal(panel.viewColumn, false);
		}
	}

	updateProblemState(problemRef: string, state: ProblemState): void {
		if (!this.state || this.state.problem.ref !== problemRef) {
			return;
		}
		this.state.problem = applyProblemState(this.state.problem, state);
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
			}
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
		this.render();
	}

	reveal(): void {
		if (!this.state || this.editorialPanel) {
			return;
		}
		const panelCreated = this.ensureProblemPanel();
		this.render();
		const panel = this.panel;
		if (!panelCreated && !this.editorialPanel && panel) {
			panel.reveal(panel.viewColumn, false);
		}
	}

	hideProblemWhenSourceInactive(): boolean {
		// Problem, CPH, and terminal views can temporarily clear activeTextEditor.
		// That must not be mistaken for switching to another source file.
		if (this.panel?.active || !this.state || !shouldHideProblemPanelWhenSourceInactive(this.state.sourcePath, getActiveEditorPath())) {
			return false;
		}
		if (this.panel) {
			this.suppressRestoreForInactiveSource = true;
			this.panel.dispose();
		}
		return true;
	}

	hideProblemForCph(problemRef: string, sourcePath?: string): void {
		if (this.state?.problem.ref !== problemRef) {
			return;
		}
		if (sourcePath && isActiveEditor(sourcePath)) {
			return;
		}
		this.state = undefined;
		this.reopenProblemAfterEditorial = false;
		this.editorialHiddenSourcePath = undefined;
		this.editorialPanel?.dispose();
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
		this.editorialPanel.webview.html = getEditorialPanelHtml(this.state.editorial, this.state.problem, this.editorialPanel.webview, this.extensionUri);
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

	private showLockedEditorialNotice(remainingMs: number): void {
		void this.panel?.webview.postMessage({
			type: 'showHintModal',
			html: `<div class="modal-header"><h3>解题报告</h3><button type="button" class="modal-close" data-command="closeModal" aria-label="关闭">×</button></div><div class="modal-body"><p class="hint-feedback" data-remaining-ms="${remainingMs}">${escapeHtml('解题报告尚未解锁，')}<span class="editorial-countdown">${escapeHtml(`剩余 ${formatDuration(remainingMs)}`)}</span></p></div>`,
		});
	}

	private getProblemViewColumn(): vscode.ViewColumn {
		const cppColumn = this.findCppEditorColumn();
		if (cppColumn !== undefined) {
			const existingRightGroup = vscode.window.tabGroups.all.find(group => group.viewColumn === cppColumn + 1);
			return existingRightGroup?.viewColumn ?? vscode.ViewColumn.Beside;
		}
		const activeViewColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
		const existingRightGroup = vscode.window.tabGroups.all.find(group => group.viewColumn === activeViewColumn + 1);
		return existingRightGroup?.viewColumn ?? vscode.ViewColumn.Beside;
	}

	private findCppEditorColumn(): vscode.ViewColumn | undefined {
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

	private showEditorialPanel(editorial: EditorialResult, problem: ImportedProblem): void {
		if (editorial.state !== 'available') {
			return;
		}
		const title = `解题报告: ${problem.title}`;
		if (this.editorialPanel) {
			this.hideProblemWhileEditorialOpen();
			this.editorialPanel.title = title;
			this.editorialPanel.webview.html = getEditorialPanelHtml(editorial, problem, this.editorialPanel.webview, this.extensionUri);
			this.editorialPanel.reveal(this.editorialPanel.viewColumn, false);
			return;
		}
		const viewColumn = this.findCodeEditorColumn();
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
		panel.webview.onDidReceiveMessage(async (message) => {
			if (!this.state) {
				return;
			}
			if (typeof message !== 'object' || message === null) {
				return;
			}
			const value = message as { command?: unknown; hintId?: unknown; target?: unknown; liked?: unknown };
			if (value.command === 'like' && typeof value.hintId === 'string' && (value.target === 'question' || value.target === 'answer') && typeof value.liked === 'boolean') {
				const result = await this.actions.like(this.state.problem, value.hintId, value.target, value.liked);
				this.state.problem = applyLikeResult(this.state.problem, result);
				if (this.state.editorial) {
					this.state.editorial = applyEditorialLikeResult(this.state.editorial, result);
				}
				this.refreshEditorial();
			}
		});
		panel.webview.html = getEditorialPanelHtml(editorial, problem, panel.webview, this.extensionUri);
		panel.onDidDispose(() => {
			if (this.editorialPanel === panel) {
				this.editorialPanel = undefined;
			}
			if (this.reopenProblemAfterEditorial) {
				this.reopenProblemAfterEditorial = false;
				const hiddenSourcePath = this.editorialHiddenSourcePath;
				this.editorialHiddenSourcePath = undefined;
				if (shouldRestoreProblemPanelAfterEditorial(
					hiddenSourcePath,
					this.state?.sourcePath,
					this.panel !== undefined,
					getOpenFileTabGroups().flatMap(group => group.filePaths),
				)) {
					this.reveal();
				}
			}
		});
		this.editorialPanel = panel;
		this.hideProblemWhileEditorialOpen();
	}

	private hideProblemWhileEditorialOpen(): void {
		if (!this.panel) {
			return;
		}
		this.reopenProblemAfterEditorial = true;
		this.editorialHiddenSourcePath = this.state?.sourcePath;
		this.panel.dispose();
	}

	private ensurePanel(viewColumn: vscode.ViewColumn): boolean {
		if (this.panel) {
			return false;
		}
		const panel = vscode.window.createWebviewPanel(
			'shortestpath.ojProblem',
			'ShortestPath OJ',
			{ viewColumn, preserveFocus: false },
			{
				enableScripts: true,
				localResourceRoots: [this.extensionUri],
				retainContextWhenHidden: true,
			},
		);
		panel.onDidDispose(() => {
			const disposedSourcePath = this.state?.sourcePath;
			if (this.panel === panel) {
				this.panel = undefined;
				this.sentSections = undefined;
				this.pendingSections = undefined;
				this.pendingTimer = undefined;
				this.sentTimerJson = '';
				this.webviewReady = false;
			}
			if (this.reopenProblemAfterEditorial) {
				return;
			}
			if (this.suppressRestoreForInactiveSource) {
				this.suppressRestoreForInactiveSource = false;
				return;
			}
			setTimeout(() => {
				if (shouldRestoreProblemPanel(
					disposedSourcePath,
					this.state?.sourcePath,
					this.panel !== undefined,
					getOpenFileTabGroups().flatMap(group => group.filePaths),
				)) {
					this.reveal();
				}
			}, 0);
		});
		panel.webview.onDidReceiveMessage(message => {
			void this.handleMessage(message);
		});
		this.panel = panel;
		return true;
	}

	private ensureProblemPanel(): boolean {
		const existingViewColumns = new Set(vscode.window.tabGroups.all.map(group => group.viewColumn));
		const panelCreated = this.ensurePanel(this.getProblemViewColumn());
		const problemViewColumn = this.panel?.viewColumn;
		if (panelCreated && problemViewColumn !== undefined) {
			setTimeout(() => this.closeShortestPathNewTabs(problemViewColumn), 0);
		}
		if (panelCreated && problemViewColumn !== undefined && !existingViewColumns.has(problemViewColumn)) {
			setTimeout(() => {
				void vscode.commands.executeCommand('shortestpath.oj.resizeEditorGroups', problemViewColumn - 1);
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
						if (!state.problem.state.timer.accepted && state.problem.state.editorial.remainingMs > 0) {
							this.showLockedEditorialNotice(state.problem.state.editorial.remainingMs);
							return;
						}
						const result = await this.actions.editorial(state.problem);
						if (result) {
							state.editorial = result;
							if (result.state === 'available') {
								this.showEditorialPanel(result, state.problem);
							} else {
								state.problem = applyEditorialLockRemaining(state.problem, result.remainingMs);
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
					if (!state.stressContext.eligibleSubmissions.some(submission => submission.submissionId === value.submissionId)) {
						throw new Error('该提交当前不可用于对拍。');
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
			if (value.command === 'submit') {
				state.statusMessage = message;
			}
			if ((value.command === 'answer' || value.command === 'openHintModal') && typeof value.hintId === 'string') {
				state.hintMessages.set(value.hintId, message);
				this.refreshHintModal(value.hintId);
			}
			this.render();
		}
	}

	private render(): void {
		if (!this.panel || !this.state) {
			return;
		}
		this.panel.title = `ShortestPath OJ: ${this.state.problem.title}`;
		const sections = renderProblemViewSections(this.state);
		const timer = getProblemViewTimer(this.state);
		if (!this.sentSections || this.renderedProblemRef !== this.state.problem.ref) {
			// Full re-render: the webview reloads and must signal readiness before
			// incremental updates can be delivered.
			this.panel.webview.html = getProblemWebviewHtml(this.state, sections, this.template, this.panel.webview, this.extensionUri);
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
	const output = vscode.window.createOutputChannel('ShortestPath OJ');
	context.subscriptions.push(output);
	const template = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'resources', 'problemView.html')));
	renderProblemMarkdown = await createProblemMarkdownRenderer(getShikiTheme);
	context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(() => {
		markdownContentCache = new WeakMap();
		panel.refreshEditorial();
		panel.reveal();
	}));
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
	}, unknownStressStarts);
	bridge = new ShortestPathOjLocalBridge({
		async importProblem(problem, signal) {
			signal.throwIfAborted();
			const cache = await readWorkspaceProblemCache();
			signal.throwIfAborted();
			const action = cache.problems[problem.ref] ? 'updated' : 'created';
			const previousSourcePath = cache.sourcePaths[problem.ref];
			cache.problems[problem.ref] = problem;
			const cph = await forwardSamplesToCph(problem, previousSourcePath, signal);
			signal.throwIfAborted();
			if (cph.sourcePath) {
				cache.sourcePaths[problem.ref] = cph.sourcePath;
			}
			await writeWorkspaceProblemCache(cache);
			if (!cph.succeeded) {
				output.appendLine(`CPH Plus did not accept samples for ${problem.ref}.`);
			}
			return action;
		},
		async activateProblem(problem) {
			const sourcePath = (await readWorkspaceProblemCache()).sourcePaths[problem.ref];
			panel.showProblem(problem, true, sourcePath);
		},
		async updateProblemState(problemRef, state) {
			const cache = await readWorkspaceProblemCache();
			const problem = cache.problems[problemRef];
			if (!problem) {
				throw new Error('当前连接尚未导入题目。');
			}
			cache.problems[problemRef] = applyProblemState(problem, state);
			panel.updateProblemState(problemRef, state);
			await writeWorkspaceProblemCache(cache);
		},
		handleEvent(problemRef, event) {
			panel.handleEvent(problemRef, event);
		},
		handleDisconnect(problemRef) {
			panel.setDisconnected(problemRef);
		},
	}, bridgePort);
	bridge.onListening(() => output.appendLine(`WebSocket bridge listening at ws://127.0.0.1:${bridgePort}/shortestpath-oj with shortestpath-oj-v1.`));
	bridge.onError(error => {
		output.appendLine(`WebSocket bridge error: ${error.message}`);
	});
	context.subscriptions.push(new vscode.Disposable(() => { void bridge.close(); }));

	context.subscriptions.push(vscode.window.registerUriHandler({
		handleUri(uri) {
			if (uri.authority === 'shortestpath.shortestpath-oj' && uri.path === '/wake') {
				output.appendLine('Received ShortestPath OJ wake URI.');
			}
		},
	}));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.showProblem', () => panel.reveal()));
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
		setTimeout(() => panel.hideProblemWhenSourceInactive(), 0);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.openIntegratedBrowser', async () => {
		await vscode.window.openBrowserTab('https://shortestpath.cn/topics', { viewColumn: vscode.ViewColumn.Active, preserveFocus: false });
	}));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.openIntegratedBrowserDirect', async () => {
		await vscode.window.openBrowserTab('https://shortestpath.cn/login', { viewColumn: vscode.ViewColumn.Active, preserveFocus: false });
	}));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.openControlPanel', async () => {
		await vscode.window.openBrowserTab('https://shortestpath.cn/topics', { viewColumn: vscode.ViewColumn.Active, preserveFocus: false });
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
		throw new Error('Open a workspace folder before importing a ShortestPath OJ problem.');
	}
	return vscode.Uri.joinPath(workspaceFolder.uri, workspaceCacheDirectoryName);
}

function getWorkspaceCacheUri(): vscode.Uri {
	return vscode.Uri.joinPath(getWorkspaceCacheDirectoryUri(), workspaceCacheFileName);
}

function createEmptyWorkspaceProblemCache(): WorkspaceProblemCache {
	return {
		version: 3,
		problems: Object.create(null) as Record<string, ImportedProblem>,
		sourcePaths: Object.create(null) as Record<string, string>,
	};
}

async function readWorkspaceProblemCache(): Promise<WorkspaceProblemCache> {
	try {
		const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(getWorkspaceCacheUri()));
		if (!content.trim()) {
			return createEmptyWorkspaceProblemCache();
		}
		const value = JSON.parse(content) as Partial<WorkspaceProblemCache>;
		const problems = Object.create(null) as Record<string, ImportedProblem>;
		const sourcePaths = Object.create(null) as Record<string, string>;
		if (value.version === 3 && value.problems && typeof value.problems === 'object') {
			Object.assign(problems, value.problems);
		}
		if (value.version === 3 && value.sourcePaths && typeof value.sourcePaths === 'object') {
			Object.assign(sourcePaths, value.sourcePaths);
		}
		return {
			version: 3,
			problems,
			sourcePaths,
		};
	} catch (error) {
		if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
			return createEmptyWorkspaceProblemCache();
		}
		throw error;
	}
}

async function writeWorkspaceProblemCache(cache: WorkspaceProblemCache): Promise<void> {
	await vscode.workspace.fs.createDirectory(getWorkspaceCacheDirectoryUri());
	await vscode.workspace.fs.writeFile(getWorkspaceCacheUri(), new TextEncoder().encode(`${JSON.stringify(cache, undefined, '\t')}\n`));
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
	if (!problem.capabilities.submission.enabled || problem.capabilities.submission.languages.length === 0) {
		throw new Error('当前题目不允许从 IDE 提交。');
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
		if (sourcePath) {
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
					finish(typeof result.sourcePath === 'string' ? { succeeded: true, sourcePath: result.sourcePath } : { succeeded: false });
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
	status: string;
	submissionButton: string;
	information: string;
	statement: string;
	hints: string;
	editorialAction: string;
	submissions: string;
};

const problemViewSectionIds: Record<keyof ProblemViewSections, string> = {
	status: 'oj-status',
	submissionButton: 'oj-submission-button',
	information: 'oj-information',
	statement: 'oj-statement',
	hints: 'oj-hints',
	editorialAction: 'oj-editorial-action',
	submissions: 'oj-submissions',
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

function renderProblemViewSections(state: ProblemPanelState): ProblemViewSections {
	const { problem } = state;
	return {
		status: `<div class="connection ${state.connected ? 'connected' : 'disconnected'}">${escapeHtml(state.statusMessage)}</div>`,
		submissionButton: problem.capabilities.submission.enabled ? `<button type="button" data-command="submit"${state.connected ? '' : ' disabled'}>提交代码</button>` : '',
		information: renderInformation(problem),
		statement: renderStatement(problem),
		hints: renderHints(state),
		editorialAction: renderEditorialAction(problem, state.connected),
		submissions: renderSubmissions(state),
	};
}

function getProblemWebviewHtml(state: ProblemPanelState, sections: ProblemViewSections, template: string, webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const { problem } = state;
	const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'problemView.js'));
	const styles = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'problemView.css'));
	const katexStyles = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'katex', 'katex.min.css'));
	const timer = getProblemViewTimer(state);
	return fillTemplate(template, {
		CSP_SOURCE: webview.cspSource,
		KATEX_STYLES_URI: katexStyles.toString(),
		STYLES_URI: styles.toString(),
		SCRIPT_URI: script.toString(),
		ELAPSED_MS: String(timer.elapsedMs),
		TIMER_RUNNING: String(timer.running),
		TIMER_ACCEPTED: String(timer.accepted),
		TIMER_VALUE: formatDuration(timer.elapsedMs),
		CAPTURED_AT: String(timer.capturedAt),
		TITLE: escapeHtml(problem.title),
		METADATA: `${escapeHtml(problem.topic.title)} · ${problem.limits.timeMs} ms · ${problem.limits.memoryMB} MB · ${escapeHtml(problem.judge.mode.toUpperCase())}`,
		PROBLEM_URL: escapeAttribute(problem.url),
		STATUS: sections.status,
		SUBMISSION_BUTTON: sections.submissionButton,
		INFORMATION: sections.information,
		STATEMENT: sections.statement,
		HINTS: sections.hints,
		EDITORIAL_ACTION: sections.editorialAction,
		SUBMISSIONS: sections.submissions,
	});
}

function renderInformation(problem: ImportedProblem): string {
	const coreTags = problem.metadata.coreAlgorithm ? [`<span class="tag core">${escapeHtml(problem.metadata.coreAlgorithm)}</span>`] : [];
	const auxiliaryTags = problem.metadata.auxiliaryAlgorithms.map(tag => `<span class="tag auxiliary">${escapeHtml(tag)}</span>`);
	const allTags = [...coreTags, ...auxiliaryTags].join('') || '<span class="empty-tags">暂无标签</span>';
	const summaryCount = (problem.metadata.coreAlgorithm ? 1 : 0) + problem.metadata.auxiliaryAlgorithms.length;
	const difficulty = String(problem.metadata.difficulty);
	return `<div class="info-grid">
				<div class="info-cell"><span class="info-label">时间限制</span><span class="info-value">${problem.limits.timeMs} ms</span></div>
				<div class="info-cell"><span class="info-label">内存限制</span><span class="info-value">${problem.limits.memoryMB} MB</span></div>
				<div class="info-cell"><span class="info-label">题目难度</span><span class="info-value">${escapeHtml(difficulty)}</span></div>
				<div class="info-cell info-action tag-popover-anchor">
					<span class="info-label">题目标签</span>
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
		['题目描述', problem.statement.description],
		['输入格式', problem.statement.inputFormat],
		['输出格式', problem.statement.outputFormat],
		['数据范围', problem.statement.constraints],
	];
	const statement = sections
		.filter((entry): entry is [string, MarkdownContent] => entry[1] !== undefined)
		.map(([title, content]) => `<section><h2>${title}</h2>${renderMarkdownContent(content, problem.url)}</section>`)
		.join('');
	const explanations = problem.samples
		.map((sample, index) => sample.explanation.trim() ? `<article class="sample"><h3>样例 ${index + 1} 解释</h3><div data-render-math>${renderProblemMarkdown(sample.explanation, problem.url)}</div></article>` : '')
		.filter(Boolean)
		.join('');
	const sampleHint = '<p class="sample-hint">样例输入/输出请在左侧 CPH 面板中查看。</p>';
	return `${statement}${explanations ? `<section class="samples"><h2>样例解释</h2>${explanations}</section>` : ''}${sampleHint}`;
}

function renderHints(state: ProblemPanelState): string {
	if (state.problem.state.hints.length === 0) {
		return '';
	}
	const items = state.problem.state.hints.map(hint => {
		// While online, only the website state determines whether an answer was
		// viewed. The locally cached body is a fallback for an offline panel.
		const viewed = hint.viewed || (!state.connected && state.answers.has(hint.id));
		const unlocked = hint.unlocked || state.problem.state.timer.accepted;
		const locked = !viewed && !unlocked;
		const statusText = viewed ? '已查看答案' : unlocked ? '已解锁' : '提示尚未解锁';
		const remainingAttr = !unlocked && hint.remainingMs > 0 ? ` data-remaining-ms="${hint.remainingMs}"` : '';
		const viewedClass = viewed ? ' viewed' : '';
		const countdown = locked && hint.remainingMs > 0 ? `<span class="hint-countdown">剩余 ${formatDuration(hint.remainingMs)}</span>` : '';
		const interaction = unlocked
			? ` data-command="openHintModal" data-hint-id="${escapeAttribute(hint.id)}" role="button" tabindex="0"`
			: ' aria-disabled="true"';
		return `<div class="hint-list-item${unlocked ? '' : ' locked'}${viewedClass}"${interaction} aria-label="提示 ${hint.seq}，${escapeAttribute(statusText)}"${remainingAttr}><span class="hint-list-num">提示 ${hint.seq}</span><span class="hint-list-status"><span class="hint-lock-label">${escapeHtml(statusText)}</span>${countdown}</span></div>`;
	}).join('');
	return `<section class="hints"><h2>提示</h2><div class="hint-list">${items}</div></section>`;
}

const likeSvgOutlined = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-thumbs-up size-3.5" aria-hidden="true"><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"></path><path d="M7 10v12"></path></svg>';
const likeSvgFilled = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-thumbs-up size-3.5 fill-current" aria-hidden="true"><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"></path><path d="M7 10v12"></path></svg>';

function renderLikeButton(hintId: string, target: 'question' | 'answer', likes: { liked: boolean; count: number }, enabled: boolean): string {
	const svg = likes.liked ? likeSvgFilled : likeSvgOutlined;
	const label = `${likes.liked ? '取消点赞' : '点赞'}提示${target === 'question' ? '问题' : '答案'}，当前 ${likes.count} 赞`;
	return `<button type="button" class="like-btn${likes.liked ? ' liked' : ''}" data-command="like" data-hint-id="${escapeAttribute(hintId)}" data-target="${target}" data-liked="${likes.liked}" aria-label="${escapeAttribute(label)}"${enabled ? '' : ' disabled'}>${svg}<span aria-hidden="true">${likes.count}</span></button>`;
}

function renderHintModal(state: ProblemPanelState, hint: ProblemHint): string {
	const questionContent = hint.question
		? `<div data-render-math>${renderMarkdownContent(hint.question, state.problem.url)}</div>`
		: '<p>提示问题尚未解锁。</p>';
	const questionLike = renderLikeButton(hint.id, 'question', hint.likes.question, state.connected && Boolean(hint.question) && state.problem.capabilities.hintLike);
	const answer = state.answers.get(hint.id);
	const answerLike = renderLikeButton(hint.id, 'answer', hint.likes.answer, state.connected && Boolean(answer) && state.problem.capabilities.hintLike);
	const unlocked = hint.unlocked || state.problem.state.timer.accepted;
	const canRequestAnswer = state.connected && state.problem.capabilities.hintAnswer;
	const canShowAnswer = unlocked && canRequestAnswer;
	const answerContent = answer
		? `<div data-render-math>${renderMarkdownContent(answer, state.problem.url)}</div>`
		: `<button type="button" data-command="answer" data-hint-id="${escapeAttribute(hint.id)}" data-can-request="${canRequestAnswer}"${canShowAnswer ? '' : ' disabled'}${!unlocked && hint.remainingMs > 0 ? ` data-remaining-ms="${hint.remainingMs}"` : ''}>${unlocked ? '显示答案' : `<span class="hint-countdown">剩余 ${formatDuration(hint.remainingMs)}</span>`}</button>`;
	const feedback = state.hintMessages.get(hint.id);
	return `<div class="modal-header"><h3>提示 ${hint.seq}</h3><button type="button" class="modal-close" data-command="closeModal" aria-label="关闭提示">×</button></div><div class="modal-body">${feedback ? `<p class="hint-feedback" role="status">${escapeHtml(feedback)}</p>` : ''}<div class="modal-columns"><div class="modal-column"><div class="hint-section-heading"><h4>问题</h4>${questionLike}</div>${questionContent}</div><div class="modal-column"><div class="hint-section-heading"><h4>答案</h4>${answerLike}</div>${answerContent}</div></div></div>`;
}

function renderEditorialAction(problem: ImportedProblem, connected: boolean): string {
	if (!problem.capabilities.editorial) {
		return '';
	}
	if (!problem.state.timer.accepted && problem.state.editorial.remainingMs > 0) {
		return '<button type="button" class="editorial-locked" data-command="editorial">查看解题报告</button>';
	}
	return `<button type="button" data-command="editorial"${canRequestEditorial(connected) ? '' : ' disabled'}>查看解题报告</button>`;
}

function getEditorialPanelHtml(editorial: EditorialResult, problem: ImportedProblem, webview: vscode.Webview, extensionUri: vscode.Uri): string {
	if (editorial.state !== 'available') {
		return '';
	}
	const styles = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'problemView.css'));
	const katexStyles = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'katex', 'katex.min.css'));
	const baseUrl = problem.url;
	const hintsHtml = editorial.hints.map(hint => {
		const qLike = renderLikeButton(hint.hintId, 'question', { liked: hint.questionLiked, count: hint.questionLikeCount }, true);
		const aLike = renderLikeButton(hint.hintId, 'answer', { liked: hint.answerLiked, count: hint.answerLikeCount }, true);
		return `<article class="editorial-hint">
<div class="editorial-hint-header"><span class="editorial-hint-title">提示 ${hint.seq}</span></div>
<div class="editorial-hint-body">
<div class="editorial-hint-row"><div class="editorial-hint-row-heading"><span class="editorial-hint-label">问题</span><div class="like-row">${qLike}</div></div><div class="editorial-hint-content" data-render-math>${renderMarkdownContent(hint.question, baseUrl)}</div></div>
<div class="editorial-hint-row"><div class="editorial-hint-row-heading"><span class="editorial-hint-label">答案</span><div class="like-row">${aLike}</div></div><div class="editorial-hint-content" data-render-math>${renderMarkdownContent(hint.answer, baseUrl)}</div></div>
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
<section class="editorial-section"><h2>简化题解</h2><div data-render-math>${renderMarkdownContent(editorial.simpleContent, baseUrl)}</div></section>
<section class="editorial-section"><h2>详细题解</h2><div data-render-math>${renderMarkdownContent(editorial.content, baseUrl)}</div></section>
</div>
<div class="editorial-code"><h2>参考代码</h2>${codeHtml}</div>
</div>
<script>
const vscode = acquireVsCodeApi();
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
	const submission = state.problem.capabilities.submission;
	if (!submission.enabled) {
		return '';
	}
	const items = [...state.submissions.values()]
		.sort((left, right) => compareSubmissionIdDescending(left.submissionId, right.submissionId))
		.map((item, index) => {
			const detailNotice = item.detailState === 'unavailable' ? `<p class="warning">结果已结束，详情暂不可用：${escapeHtml(item.detailError?.message ?? '')}</p>` : '';
			const compileError = item.compileErrorMessage ? `<pre class="error"><code>${escapeHtml(item.compileErrorMessage)}</code></pre>` : '';
			const details = item.details.length ? `<table><thead><tr><th>#</th><th>测试点</th><th>状态</th><th>时间</th><th>内存</th></tr></thead><tbody>${item.details.map(detail => `<tr><td>${detail.seq}</td><td>${escapeHtml(detail.caseName)}</td><td>${escapeHtml(detail.status)}</td><td>${detail.timeMs} ms</td><td>${detail.memoryKB} KB</td></tr>`).join('')}</tbody></table>` : '';
			const disconnected = state.disconnectedSubmissions.has(item.submissionId) ? '<p class="warning">评测转发已断开；后端任务状态未知，请重新连接并恢复观察。</p>' : '';
			const showStressHint = shouldShowStressHint(state, item);
			const stressSection = showStressHint ? renderSubmissionStress(state, item) : '';
			const shouldOpen = index === 0;
			return `<details class="submission" data-persist-key="submission:${escapeAttribute(item.submissionId)}"${shouldOpen ? ' open' : ''}><summary><span class="submission-summary-title">提交 ${escapeHtml(item.submissionId)} · ${escapeHtml(item.status)}</span><span class="submission-summary-meta">${escapeHtml(item.stage ?? 'waiting') || 'waiting'} · ${item.score} 分 · ${item.maxTimeMs} ms · ${item.maxMemoryKB} KB</span></summary><div class="submission-body">${disconnected}${detailNotice}${compileError}${details}${stressSection}</div></details>`;
		}).join('');
	return `<section class="submissions"><h2>评测</h2><form id="watch-submission"><input name="submissionId" inputmode="numeric" placeholder="已有提交 ID"><button type="submit"${submission.watchExisting && state.connected ? '' : ' disabled'}>恢复观察</button></form>${items || '<p>暂无评测记录。</p>'}</section>`;
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
	const eligibility = state.stressContext
		? state.stressContext.eligibleSubmissions.some(item => item.submissionId === submissionId)
		: true;
	const hint = '<p class="submission-stress-hint">提交出现 WA，可以使用对拍找到错误数据。</p>';
	const button = eligibility
		? `<button type="button" data-command="startStress" data-submission-id="${escapeAttribute(submissionId)}" data-rounds="${defaultRounds}"${state.connected ? '' : ' disabled'}>发起对拍</button>`
		: '<p class="warning">该提交当前不可用于对拍。</p>';
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
	if ([...state.stressTasks.values()].some(task => task.submissionId === submission.submissionId)) {
		return true;
	}
	if (!state.problem.capabilities.stress.supported || !isWrongAnswerStatus(submission.status)) {
		return false;
	}
	if (!state.stressContext) {
		return true;
	}
	return state.stressContext.eligibleSubmissions.some(item => item.submissionId === submission.submissionId);
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
	const activeEditor = vscode.window.activeTextEditor;
	return activeEditor?.document.uri.scheme === 'file' ? activeEditor.document.fileName : undefined;
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

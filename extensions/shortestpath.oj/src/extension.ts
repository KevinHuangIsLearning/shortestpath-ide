/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as vscode from 'vscode';
import { OutcomeUnknownError, ShortestPathOjLocalBridge } from './shortestpathOjLocalBridge';
import {
	applyLikeResult,
	applyProblemState,
	EditorialResult,
	findProblemRefForSourcePath,
	HintAnswerResult,
	ImportedProblem,
	IncomingEvent,
	LikeResult,
	MarkdownContent,
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
	editorial?: EditorialResult;
	submissions: Map<string, SubmissionSnapshot>;
	finishedSubmissions: Set<string>;
	disconnectedSubmissions: Set<string>;
	stressContext?: StressContext;
	stressTasks: Map<string, StressTask>;
	finishedStressTasks: Set<string>;
	disconnectedStressTasks: Set<string>;
};

type ProblemPanelActions = {
	answer(problem: ImportedProblem, hintId: string): Promise<HintAnswerResult>;
	like(problem: ImportedProblem, hintId: string, target: 'question' | 'answer', liked: boolean): Promise<LikeResult>;
	editorial(problem: ImportedProblem): Promise<EditorialResult | undefined>;
	submit(problem: ImportedProblem): Promise<void>;
	watchSubmission(problem: ImportedProblem, submissionId: string): Promise<void>;
	loadStress(problem: ImportedProblem): Promise<StressContext>;
	startStress(problem: ImportedProblem, submissionId: string, rounds: number): Promise<StressTask>;
};

class ShortestPathOjProblemPanel {
	private panel: vscode.WebviewPanel | undefined;
	private state: ProblemPanelState | undefined;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly template: string,
		private readonly actions: ProblemPanelActions,
		private readonly unknownStressStarts: Set<string>,
	) { }

	showProblem(problem: ImportedProblem, connected: boolean): void {
		if (!this.state || this.state.problem.ref !== problem.ref) {
			this.state = {
				problem,
				connected,
				statusMessage: connected ? '已连接题目网页。' : '等待用户从网站重新发送题目。',
				answers: new Map(),
				submissions: new Map(),
				finishedSubmissions: new Set(),
				disconnectedSubmissions: new Set(),
				stressTasks: new Map(),
				finishedStressTasks: new Set(),
				disconnectedStressTasks: new Set(),
			};
		} else {
			this.state.problem = problem;
			this.state.connected = connected;
			this.state.statusMessage = connected ? '已连接题目网页。' : '等待用户从网站重新发送题目。';
		}
		this.ensurePanel();
		this.render();
		this.panel?.reveal(vscode.ViewColumn.Beside, false);
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
			if (event.type === 'submission.progress' && state.finishedSubmissions.has(snapshot.submissionId)) {
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
		if (!this.state) {
			return;
		}
		this.ensurePanel();
		this.render();
		this.panel?.reveal(vscode.ViewColumn.Beside, false);
	}

	hideProblemForCph(problemRef: string): void {
		if (this.state?.problem.ref !== problemRef) {
			return;
		}
		this.state = undefined;
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

	private ensurePanel(): void {
		if (this.panel) {
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			'shortestpath.ojProblem',
			'ShortestPath OJ',
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
			{
				enableScripts: true,
				localResourceRoots: [this.extensionUri],
				retainContextWhenHidden: true,
			},
		);
		panel.onDidDispose(() => {
			if (this.panel === panel) {
				this.panel = undefined;
			}
		});
		panel.webview.onDidReceiveMessage(message => {
			void this.handleMessage(message);
		});
		this.panel = panel;
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
		};
		try {
			switch (value.command) {
				case 'answer':
					if (typeof value.hintId !== 'string') {
						return;
					}
					state.statusMessage = '正在通过网页获取提示答案…';
					this.render();
					{
						const result = await this.actions.answer(state.problem, value.hintId);
						if (result.state === 'revealed') {
							state.answers.set(result.hintId, result.answer);
							state.problem = applyAnswerLikes(state.problem, result);
							state.statusMessage = '提示答案已同步。';
						} else {
							state.statusMessage = result.remainingMs > 0
								? `提示尚未解锁，剩余 ${formatDuration(result.remainingMs)}。`
								: '网站要求先打开该提示。';
						}
					}
					break;
				case 'like':
					if (typeof value.hintId !== 'string' || (value.target !== 'question' && value.target !== 'answer') || typeof value.liked !== 'boolean') {
						return;
					}
					state.problem = applyLikeResult(state.problem, await this.actions.like(state.problem, value.hintId, value.target, value.liked));
					state.statusMessage = '点赞状态已同步。';
					break;
				case 'editorial':
					{
						const result = await this.actions.editorial(state.problem);
						if (result) {
							state.editorial = result;
							state.statusMessage = result.state === 'available' ? '解题报告已同步。' : `解题报告尚未解锁，剩余 ${formatDuration(result.remainingMs)}。`;
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
					state.statusMessage = `正在观察提交 ${value.submissionId}。`;
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
					state.statusMessage = state.stressContext.availability.message || '对拍上下文已同步。';
					break;
				case 'startStress':
					if (typeof value.submissionId !== 'string' || typeof value.rounds !== 'number' || !Number.isInteger(value.rounds) || value.rounds <= 0) {
						throw new Error('请选择可用提交并填写正整数轮数。');
					}
					if (!state.stressContext?.eligibleSubmissions.some(submission => submission.submissionId === value.submissionId)) {
						throw new Error('只能选择最近一次对拍上下文提供的可用提交。');
					}
					if (this.unknownStressStarts.has(state.problem.ref)) {
						const choice = await vscode.window.showWarningMessage(
							'上一次对拍启动结果未知。再次发起可能创建另一个任务，是否继续？',
							{ modal: true },
							vscode.l10n.t('Continue'),
						);
						if (!choice) {
							return;
						}
						this.unknownStressStarts.delete(state.problem.ref);
					}
					{
						const task = await this.actions.startStress(state.problem, value.submissionId, value.rounds);
						state.stressTasks.set(task.taskId, task);
						this.unknownStressStarts.delete(state.problem.ref);
						state.statusMessage = `对拍任务 ${task.taskId} 已受理。`;
					}
					break;
				default:
					return;
			}
			this.render();
		} catch (error) {
			if (value.command === 'startStress' && error instanceof OutcomeUnknownError) {
				this.unknownStressStarts.add(state.problem.ref);
			}
			state.statusMessage = error instanceof Error ? error.message : String(error);
			this.render();
			void vscode.window.showErrorMessage(state.statusMessage);
		}
	}

	private render(): void {
		if (!this.panel || !this.state) {
			return;
		}
		this.panel.title = `ShortestPath OJ: ${this.state.problem.title}`;
		this.panel.webview.html = getProblemWebviewHtml(this.state, this.template, this.panel.webview, this.extensionUri);
	}
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const output = vscode.window.createOutputChannel('ShortestPath OJ');
	context.subscriptions.push(output);
	const template = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'resources', 'problemView.html')));
	// The action closures are created before their bridge and panel dependencies are assigned.
	// eslint-disable-next-line prefer-const
	let bridge: ShortestPathOjLocalBridge;
	let panel: ShortestPathOjProblemPanel;
	const unknownSubmissions = new Map<string, SubmissionAttempt>();
	const unknownStressStarts = new Set<string>();
	// eslint-disable-next-line prefer-const
	panel = new ShortestPathOjProblemPanel(context.extensionUri, template, {
		answer: (problem, hintId) => bridge.requestHintAnswer(problem.ref, hintId),
		like: (problem, hintId, target, liked) => bridge.requestLike(problem.ref, hintId, target, liked),
		editorial: async problem => {
			if (problem.state.editorial.remainingMs > 0) {
				return {
					state: 'locked',
					remainingMs: problem.state.editorial.remainingMs,
					unlockReason: 'state_wait',
				};
			}
			let confirmed = false;
			if (problem.state.editorial.requiresConfirmation) {
				const choice = await vscode.window.showWarningMessage(
					problem.state.editorial.confirmationMessage,
					{ modal: true },
					vscode.l10n.t('Confirm'),
				);
				if (!choice) {
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
		activateProblem(problem) {
			panel.showProblem(problem, true);
			void vscode.window.showInformationMessage(vscode.l10n.t('ShortestPath OJ imported: {0}', problem.title));
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
		void vscode.window.showErrorMessage(vscode.l10n.t('ShortestPath OJ bridge could not listen on localhost:{0}: {1}', bridgePort, error.message));
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
		const problem = Object.values((await readWorkspaceProblemCache()).problems).find(item => item.url === url);
		if (problem) {
			panel.showProblem(problem, bridge.isBound(problem.ref));
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.hideProblemForCphSourcePath', async (sourcePath: string) => {
		const ref = findProblemRefForSourcePath((await readWorkspaceProblemCache()).sourcePaths, sourcePath);
		if (ref) {
			panel.hideProblemForCph(ref);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.submitProblem', async (problem: CphProblemForSubmission) => {
		await submitCphProblem(problem, bridge, panel, unknownSubmissions);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.submitProblemForUrl', async (url: string) => {
		const problem = Object.values((await readWorkspaceProblemCache()).problems).find(item => item.url === url);
		if (!problem) {
			throw new Error(vscode.l10n.t('Import this problem into CPH Plus before submitting from the problem panel.'));
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
		throw new Error(vscode.l10n.t('The active CPH problem is not a ShortestPath OJ problem.'));
	}
	const problem = Object.values((await readWorkspaceProblemCache()).problems).find(item => item.url === value.url);
	if (!problem) {
		throw new Error(vscode.l10n.t('The active CPH problem is not a ShortestPath OJ problem.'));
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
		const choice = await vscode.window.showWarningMessage(
			`上一次提交结果未知。重试将原样提交 ${retry.sourcePath}，并复用同一个操作 ID。`,
			{ modal: true },
			vscode.l10n.t('Retry Same Submission'),
			vscode.l10n.t('Start New Submission'),
		);
		if (!choice) {
			return;
		}
		if (choice === vscode.l10n.t('Retry Same Submission')) {
			await sendSubmissionAttempt(problem, bridge, panel, unknownSubmissions, retry);
			return;
		}
		unknownSubmissions.delete(problem.ref);
	}
	const sourcePath = explicitSourcePath ?? (await readWorkspaceProblemCache()).sourcePaths[problem.ref];
	if (!sourcePath) {
		throw new Error(vscode.l10n.t('Import this problem into CPH Plus before submitting from the problem panel.'));
	}
	const safeSourcePath = await validateWorkspaceSourcePath(sourcePath);
	const document = await vscode.workspace.openTextDocument(vscode.Uri.file(safeSourcePath));
	if (!(await document.save())) {
		throw new Error(vscode.l10n.t('Save the source file before submitting.'));
	}
	const sourceCode = document.getText();
	if (!sourceCode.trim()) {
		throw new Error(vscode.l10n.t('The source file is empty.'));
	}
	const language = await selectSubmissionLanguage(problem.capabilities.submission.languages, safeSourcePath);
	if (!language) {
		return;
	}
	const confirmation = await vscode.window.showWarningMessage(
		`确认提交文件：${safeSourcePath}`,
		{ modal: true },
		vscode.l10n.t('Submit'),
	);
	if (!confirmation) {
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
	void vscode.window.showInformationMessage(result.message);
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

function getProblemWebviewHtml(state: ProblemPanelState, template: string, webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const { problem } = state;
	const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'problemView.js'));
	const styles = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'problemView.css'));
	const katexStyles = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'katex', 'katex.min.css'));
	const katex = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'katex', 'katex.min.js'));
	const timer = problem.state.timer;
	return fillTemplate(template, {
		CSP_SOURCE: webview.cspSource,
		KATEX_STYLES_URI: katexStyles.toString(),
		STYLES_URI: styles.toString(),
		KATEX_SCRIPT_URI: katex.toString(),
		SCRIPT_URI: script.toString(),
		ELAPSED_MS: String(timer.elapsedMs),
		TIMER_RUNNING: String(timer.mode === 'timed' && timer.running),
		CAPTURED_AT: String(timer.capturedAtUnixMs),
		TITLE: escapeHtml(problem.title),
		METADATA: `${escapeHtml(problem.topic.title)} · ${problem.limits.timeMs} ms · ${problem.limits.memoryMB} MB · ${escapeHtml(problem.judge.mode.toUpperCase())}`,
		PROBLEM_URL: escapeAttribute(problem.url),
		STATUS: `<div class="connection ${state.connected ? 'connected' : 'disconnected'}">${escapeHtml(state.statusMessage)}</div>`,
		SUBMISSION_BUTTON: problem.capabilities.submission.enabled ? `<button type="button" data-command="submit"${state.connected ? '' : ' disabled'}>提交</button>` : '',
		INFORMATION: renderInformation(problem),
		STATEMENT: renderStatement(problem),
		HINTS: renderHints(state),
		EDITORIAL_ACTION: renderEditorialAction(problem, state.connected),
		EDITORIAL: renderEditorial(state.editorial, problem.url),
		SUBMISSIONS: renderSubmissions(state),
		STRESS: renderStress(state),
		SAMPLE_COUNT: String(problem.samples.length),
	});
}

function renderInformation(problem: ImportedProblem): string {
	const tags = [
		`难度 ${problem.metadata.difficulty}`,
		problem.metadata.coreAlgorithm,
		...problem.metadata.auxiliaryAlgorithms,
		problem.judge.checkerType,
	].filter(Boolean);
	return `<section class="information">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</section>`;
}

function renderStatement(problem: ImportedProblem): string {
	const sections: Array<[string, MarkdownContent | undefined]> = [
		['题目描述', problem.statement.description],
		['输入格式', problem.statement.inputFormat],
		['输出格式', problem.statement.outputFormat],
		['数据范围', problem.statement.constraints],
	];
	return sections
		.filter((entry): entry is [string, MarkdownContent] => entry[1] !== undefined)
		.map(([title, content]) => `<section><h2>${title}</h2>${renderMarkdown(content.content, problem.url)}</section>`)
		.join('');
}

function renderHints(state: ProblemPanelState): string {
	if (state.problem.state.hints.length === 0) {
		return '';
	}
	return `<section class="hints"><h2>提示</h2>${state.problem.state.hints.map(hint => {
		const question = hint.question ? `<div data-render-math>${renderMarkdown(hint.question.content, state.problem.url)}</div>` : '<p>提示问题尚未解锁。</p>';
		const answer = state.answers.get(hint.id);
		const questionLike = renderLikeButton(hint.id, 'question', hint.likes.question, state.connected && Boolean(hint.question) && state.problem.capabilities.hintLike);
		const answerLike = renderLikeButton(hint.id, 'answer', hint.likes.answer, state.connected && Boolean(answer) && state.problem.capabilities.hintLike);
		const answerBody = answer
			? `<div data-render-math>${renderMarkdown(answer.content, state.problem.url)}</div>${answerLike}`
			: `<button type="button" data-command="answer" data-hint-id="${escapeAttribute(hint.id)}"${!hint.unlocked || !state.connected || !state.problem.capabilities.hintAnswer ? ' disabled' : ''}>${hint.unlocked ? '查看答案' : `剩余 ${formatDuration(hint.remainingMs)}`}</button>`;
		return `<article class="hint"><h3>提示 ${hint.seq}</h3>${question}${questionLike}<section class="hint-answer"><h4>答案</h4>${answerBody}</section></article>`;
	}).join('')}</section>`;
}

function renderLikeButton(hintId: string, target: 'question' | 'answer', likes: { liked: boolean; count: number }, enabled: boolean): string {
	return `<button type="button" class="like" data-command="like" data-hint-id="${escapeAttribute(hintId)}" data-target="${target}" data-liked="${likes.liked}"${enabled ? '' : ' disabled'}>${likes.liked ? '取消点赞' : '点赞'}（${likes.count}）</button>`;
}

function renderEditorialAction(problem: ImportedProblem, connected: boolean): string {
	if (!problem.capabilities.editorial) {
		return '';
	}
	const remaining = problem.state.editorial.remainingMs;
	return `<button type="button" data-command="editorial"${remaining > 0 || !connected ? ' disabled' : ''}>${remaining > 0 ? `解题报告剩余 ${formatDuration(remaining)}` : '查看解题报告'}</button>`;
}

function renderEditorial(editorial: EditorialResult | undefined, baseUrl: string): string {
	if (!editorial || editorial.state === 'locked') {
		return '';
	}
	const hints = editorial.hints.map(hint => `<article><h3>提示 ${hint.seq}</h3><div data-render-math>${renderMarkdown(hint.question.content, baseUrl)}</div><div data-render-math>${renderMarkdown(hint.answer.content, baseUrl)}</div></article>`).join('');
	return `<section class="solution-report"><h2>解题报告</h2>${hints}<h3>简化题解</h3><div data-render-math>${renderMarkdown(editorial.simpleContent.content, baseUrl)}</div><h3>详细题解</h3><div data-render-math>${renderMarkdown(editorial.content.content, baseUrl)}</div><h3>参考代码</h3><pre><code>${escapeHtml(editorial.solutionCode)}</code></pre></section>`;
}

function renderSubmissions(state: ProblemPanelState): string {
	const submission = state.problem.capabilities.submission;
	if (!submission.enabled) {
		return '';
	}
	const items = [...state.submissions.values()].map(item => {
		const detailNotice = item.detailState === 'unavailable' ? `<p class="warning">结果已结束，详情暂不可用：${escapeHtml(item.detailError?.message ?? '')}</p>` : '';
		const compileError = item.compileErrorMessage ? `<pre class="error"><code>${escapeHtml(item.compileErrorMessage)}</code></pre>` : '';
		const details = item.details.length ? `<table><thead><tr><th>#</th><th>测试点</th><th>状态</th><th>时间</th><th>内存</th></tr></thead><tbody>${item.details.map(detail => `<tr><td>${detail.seq}</td><td>${escapeHtml(detail.caseName)}</td><td>${escapeHtml(detail.status)}</td><td>${detail.timeMs} ms</td><td>${detail.memoryKB} KB</td></tr>`).join('')}</tbody></table>` : '';
		const disconnected = state.disconnectedSubmissions.has(item.submissionId) ? '<p class="warning">评测转发已断开；后端任务状态未知，请重新连接并恢复观察。</p>' : '';
		return `<article class="submission"><h3>提交 ${escapeHtml(item.submissionId)} · ${escapeHtml(item.status)}</h3><p>${escapeHtml(item.stage ?? '')} · ${item.score} 分 · ${item.maxTimeMs} ms · ${item.maxMemoryKB} KB</p>${disconnected}${detailNotice}${compileError}${details}</article>`;
	}).join('');
	return `<section class="submissions"><h2>评测</h2><form id="watch-submission"><input name="submissionId" inputmode="numeric" placeholder="已有提交 ID"><button type="submit"${submission.watchExisting && state.connected ? '' : ' disabled'}>恢复观察</button></form>${items || '<p>暂无评测记录。</p>'}</section>`;
}

function renderStress(state: ProblemPanelState): string {
	if (!state.problem.capabilities.stress.supported) {
		return '';
	}
	const context = state.stressContext;
	const tasks = [...state.stressTasks.values()].map(task => {
		const active = task.status === 'queued' || task.status === 'running';
		const progress = active && task.roundsExecuted === 0
			? '<progress></progress><span>运行中，网站尚未提供轮数进度</span>'
			: `<progress max="${task.roundsPlanned}" value="${Math.min(task.roundsExecuted, task.roundsPlanned)}"></progress><span>${task.roundsExecuted} / ${task.roundsPlanned}</span>`;
		const counterExample = task.counterExample ? `<details><summary>反例</summary><h4>输入</h4><pre><code>${escapeHtml(task.counterExample.input)}</code></pre><h4>期望输出</h4><pre><code>${escapeHtml(task.counterExample.expected)}</code></pre><h4>实际输出</h4><pre><code>${escapeHtml(task.counterExample.actual)}</code></pre></details>` : '';
		const disconnected = state.disconnectedStressTasks.has(task.taskId) ? '<p class="warning">对拍转发已断开；后端任务仍可能继续，请重新连接并刷新对拍上下文。</p>' : '';
		return `<article class="stress-task"><h3>任务 ${escapeHtml(task.taskId)} · ${escapeHtml(task.status)}</h3><div class="progress">${progress}</div>${disconnected}${task.errorMessage ? `<p class="error">${escapeHtml(task.errorMessage)}</p>` : ''}${counterExample}</article>`;
	}).join('');
	const form = context?.availability.state === 'ready'
		? `<form id="start-stress"><select name="submissionId">${context.eligibleSubmissions.map(item => `<option value="${escapeAttribute(item.submissionId)}">${escapeHtml(item.submissionId)} · ${escapeHtml(item.status)} · ${escapeHtml(item.language)}</option>`).join('')}</select><input name="rounds" type="number" min="1" value="${context.defaultRounds}"><button type="submit"${context.eligibleSubmissions.length && state.connected ? '' : ' disabled'}>发起对拍</button></form>`
		: `<p>${escapeHtml(context?.availability.message ?? '点击后从网站读取可用提交和现有任务。')}</p>`;
	return `<section class="stress"><h2>题目级对拍</h2><button type="button" data-command="loadStress"${state.connected ? '' : ' disabled'}>刷新对拍上下文</button>${form}${tasks}</section>`;
}

function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
	return template.replace(/\{\{([A-Z_]+)\}\}/g, (placeholder, name: string) => values[name] ?? placeholder);
}

function renderMarkdown(markdown: string, baseUrl: string): string {
	const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
	const output: string[] = [];
	let index = 0;
	while (index < lines.length) {
		const line = lines[index];
		if (line.startsWith('```')) {
			const language = line.slice(3).trim();
			const code: string[] = [];
			index++;
			while (index < lines.length && !lines[index].startsWith('```')) {
				code.push(lines[index++]);
			}
			index += index < lines.length ? 1 : 0;
			output.push(`<pre><code${language ? ` class="language-${escapeAttribute(language)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
			continue;
		}
		if (line.trim() === '$$') {
			const formula: string[] = [];
			index++;
			while (index < lines.length && lines[index].trim() !== '$$') {
				formula.push(lines[index++]);
			}
			index += index < lines.length ? 1 : 0;
			output.push(`<div class="math-block" data-tex="${escapeAttribute(formula.join('\n'))}"></div>`);
			continue;
		}
		const heading = /^(#{1,6})\s+(.+)$/.exec(line);
		if (heading) {
			output.push(`<h${heading[1].length}>${renderInlineMarkdown(heading[2], baseUrl)}</h${heading[1].length}>`);
			index++;
			continue;
		}
		if (/^\s*[-*+]\s+/.test(line)) {
			const items: string[] = [];
			while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
				const content = lines[index].replace(/^\s*[-*+]\s+/, '');
				const task = /^\[([ xX])\]\s+/.exec(content);
				items.push(`<li>${task ? `<input type="checkbox" disabled${task[1] === ' ' ? '' : ' checked'}> ${renderInlineMarkdown(content.slice(task[0].length), baseUrl)}` : renderInlineMarkdown(content, baseUrl)}</li>`);
				index++;
			}
			output.push(`<ul>${items.join('')}</ul>`);
			continue;
		}
		if (/^\s*\d+\.\s+/.test(line)) {
			const items: string[] = [];
			while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
				items.push(`<li>${renderInlineMarkdown(lines[index].replace(/^\s*\d+\.\s+/, ''), baseUrl)}</li>`);
				index++;
			}
			output.push(`<ol>${items.join('')}</ol>`);
			continue;
		}
		if (index + 1 < lines.length && line.includes('|') && /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[index + 1])) {
			const headers = splitTableRow(line);
			index += 2;
			const rows: string[][] = [];
			while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
				rows.push(splitTableRow(lines[index++]));
			}
			output.push(`<table><thead><tr>${headers.map(cell => `<th>${renderInlineMarkdown(cell, baseUrl)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map((_, cell) => `<td>${renderInlineMarkdown(row[cell] ?? '', baseUrl)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
			continue;
		}
		if (!line.trim()) {
			index++;
			continue;
		}
		const paragraph = [line];
		index++;
		while (index < lines.length && lines[index].trim() && !/^(#{1,6})\s+|^```|^\s*[-*+]\s+|^\$\$$/.test(lines[index])) {
			paragraph.push(lines[index++]);
		}
		output.push(`<p>${paragraph.map(value => renderInlineMarkdown(value, baseUrl)).join('<br>')}</p>`);
	}
	return output.join('');
}

function splitTableRow(line: string): string[] {
	return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
}

function renderInlineMarkdown(value: string, baseUrl: string): string {
	let rendered = escapeHtml(value);
	rendered = rendered.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, alt: string, url: string) => `<img src="${escapeAttribute(resolveUrl(url, baseUrl))}" alt="${alt}">`);
	rendered = rendered.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) => `<a href="${escapeAttribute(resolveUrl(url, baseUrl))}">${label}</a>`);
	rendered = rendered.replace(/`([^`\n]+)`/g, '<code>$1</code>');
	rendered = rendered.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
	rendered = rendered.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
	return rendered;
}

function resolveUrl(value: string, baseUrl: string): string {
	try {
		const url = new URL(value, baseUrl);
		return url.protocol === 'https:' ? url.toString() : '#';
	} catch {
		return '#';
	}
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

function escapeHtml(value: string): string {
	return value.replace(/[&<>]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]!);
}

function escapeAttribute(value: string): string {
	return escapeHtml(value).replace(/"/g, '&quot;');
}

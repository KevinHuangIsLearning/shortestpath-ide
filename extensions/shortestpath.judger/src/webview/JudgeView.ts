import { retainExecutable } from '../executableCleanup';
import { sameTestcase } from '../testcasePresentation';
import { isShortestPathProblem, setProblemCompletion } from '../problemTimer';
import { webviewBootstrap } from '../webviewBootstrap';
import { problemLanguage } from '../problemOptions';
import { stopTestcase } from '../testcaseCancellation';
import { problemActions } from '../problemActions';
import { persistTestcaseAction, persistImportedTests } from '../testcaseRepository';
import fs from 'fs';
import path from 'path';
import { stageDroppedTestcases } from '../droppedTestcases';
import { importTestcases, importTestcasesWithPicker } from '../importTestcases';
import { fillBrowserSubmission, getBrowserSubmission, logSubmission } from '../browserSubmission';
import * as vscode from 'vscode';
import localize from '../i18n';
import { storeSubmitProblem, submitKattisProblem } from '../companion';
import {
    clearKillRequested,
    killRunning,
    runningBinaries,
} from '../executions';
import { saveProblemFromWebview, saveProblem, getProblem, getProblemDirectory } from '../parser';
import { applyProblemPatch } from '../problemDocument';
import {
    Problem,
    TestCase,
    VSToWebViewMessage,
    WebviewToVSEvent,
} from '../types';
import {
    getLanguage,
    deleteProblemFile,
    getProblemForDocument,
    isValidLanguage,
} from '../utils';
import { runSingleAndSave } from './processRunSingle';
import runAllAndSave from './processRunAll';
import runTestCases from '../runTestCases';
import {
    getAutoShowJudgePref,
    getRemoteServerAddressPref,
    getLiveUserCountPref,
    getRetainWebviewContextPref,
    getDefaultOnlineJudge,
    getDefaultSubmitMethod,
    getHideOutputDifferencePref,
    updatePreference,
    getPythonCommand,
} from '../preferences';
import {
    compileFile,
    getBinSaveLocation,
    runningCompilers,
    setOnlineJudgeEnv,
    onlineJudgeEnv,
} from '../compiler';
import { translations } from './translations';
import { getInitialJudgeProblem } from './judgeLifecycle';
import {
    isStressTestRunning,
    runStressTest,
    StressFailure,
} from '../stressTest';
class JudgeViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'judger.judgeView';

    private _view?: vscode.WebviewView;

    private messageBuffer: VSToWebViewMessage[] = [];

    private currentProblem: Problem | undefined;

    private ordinaryRunRunning = false;
    private readonly recentProblems = new Map<string, Problem>();

    public isViewUninitialized() {
        return this._view === undefined;
    }

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            async (message: WebviewToVSEvent) => {
                globalThis.logger.log('Got from webview', message.command === 'drop-testcases' ? { command: message.command, srcPath: message.srcPath, fileCount: message.files?.length, paths: message.paths } : message);
                switch (message.command) {
                    case 'get-oj-timer': {
                        try {
                            const timer = await vscode.commands.executeCommand<import('../types').OjTimer | undefined>('shortestpath.oj.getTimerForJudger', message.url, message.srcPath);
                            this.extensionToJudgeViewMessage({ command: 'oj-timer', srcPath: message.srcPath, url: message.url, requestId: message.requestId, timer });
                        } catch (error) { globalThis.logger.log('OJ timer unavailable', String(error)); }
                        break;
                    }
                    case 'mark-accepted':
                    case 'set-completion': {
                        const current = getProblem(message.srcPath);
                        if (current && !isShortestPathProblem(current.url) && (message.command === 'set-completion' || current.timeAcceptedAtUnixMs === undefined)) {
                            const completion = message.command === 'mark-accepted' ? 'accepted' : message.completion;
                            if (!['none', 'partial', 'accepted'].includes(completion)) { break; }
                            const accepted = setProblemCompletion(current, completion);
                            saveProblem(accepted.srcPath, accepted, false, true);
                            this.extensionToJudgeViewMessage({ command: 'problem-options', srcPath: accepted.srcPath, completion, patch: { timeStartedAtUnixMs: accepted.timeStartedAtUnixMs, timePartialAcceptedAtUnixMs: accepted.timePartialAcceptedAtUnixMs, timeAcceptedAtUnixMs: accepted.timeAcceptedAtUnixMs, storageRevision: accepted.storageRevision } });
                        }
                        break;
                    }
                    case 'problem-actions': {
                        try {
                            const patch = await problemActions(getProblem(message.problem.srcPath) ?? message.problem, [...this.recentProblems.values()]);
                            const current = getProblem(message.problem.srcPath);
                            if (patch === 'clear') { this.extensionToJudgeViewMessage({ command: 'problem-options', srcPath: message.problem.srcPath, clear: true }); }
                            else if (current) {
                                const updated = patch ? applyProblemPatch(current, patch) : current;
                                if (patch) { saveProblem(updated.srcPath, updated); }
                                this.extensionToJudgeViewMessage({ command: 'new-problem', problem: updated, onlyIfActive: true });
                            }
                        } catch (error) { void vscode.window.showErrorMessage(String(error)); }
                        break;
                    }
                    case 'problem-patch': {
                        try {
                            // Re-validate against the stored problem, not the webview snapshot.
                            const current = getProblem(message.srcPath);
                            if (!current) { break; }
                            const merged = applyProblemPatch(current, message.patch);
                            saveProblem(merged.srcPath, merged);
                            this.extensionToJudgeViewMessage({ command: 'problem-options', srcPath: merged.srcPath, patch: { ...message.patch, storageRevision: merged.storageRevision } });
                        } catch (error) { void vscode.window.showErrorMessage(String(error)); }
                        break;
                    }
                    case 'testcase-action': {
                        try {
                            const saved = await persistTestcaseAction(message.problem.srcPath, message.id, message.action, message.mode, message.result);
                            if (saved) {
                                this.extensionToJudgeViewMessage({ command: 'testcase-changed', srcPath: saved.problem.srcPath, ...saved.change });
                                this.extensionToJudgeViewMessage({ command: 'new-problem', problem: saved.problem, onlyIfActive: true });
                            }
                        } catch (error) { void vscode.window.showErrorMessage(String(error)); }
                        break;
                    }
                    case 'drop-testcases': {
                        let staged: string | undefined;
                        let retainStaged = false;
                        try {
                            const tests = [];
                            let sources = message.paths ?? [];
                            if (message.files) {
                                staged = stageDroppedTestcases(path.join(getProblemDirectory(message.srcPath), 'imports'), message.files);
                                sources = message.folder ? [staged] : message.files.map(file => path.join(staged!, file.name));
                            }
                                const seen = new Set<string>();
                                for (const value of sources) {
                                    const uri = value.startsWith('file:') ? vscode.Uri.parse(value) : vscode.Uri.file(value);
                                    if (uri.scheme !== 'file') { throw new Error('Only local testcase files can be imported'); }
                                    const file = uri.fsPath;
                                    if (fs.statSync(file).isDirectory()) {
                                        tests.push(...await importTestcases(message.srcPath, file, true));
                                    } else {
                                        const config = vscode.workspace.getConfiguration('judger.problem', vscode.Uri.file(message.srcPath));
                                        const extensions = [...config.get<string[]>('inputFileExtensionList', ['.in']), ...config.get<string[]>('outputFileExtensionList', ['.ans', '.out'])];
                                        const suffix = extensions.find(ext => file.endsWith(ext));
                                        const key = suffix && config.get('foundMatchTestcaseBehavior', 'always') === 'always' ? file.slice(0, -suffix.length) : file;
                                        if (seen.has(key)) { continue; }
                                        seen.add(key);
                                        tests.push(...await importTestcases(message.srcPath, file, true));
                                    }
                                }

                            retainStaged = !!staged && tests.some(test => [test.inputPath, test.outputPath].some(file => file && !path.relative(staged!, file).startsWith('..') && !path.isAbsolute(path.relative(staged!, file))));
                            if (tests.length) { this.persistImportedTests(message.srcPath, tests); }
                        } catch (error) {
                            void vscode.window.showErrorMessage(localize('judger.import.failed', 'Could not import testcases: {0}', String(error)));
                        } finally {
                            if (staged && !retainStaged) { fs.rmSync(staged, { recursive: true, force: true }); }
                        }
                        break;
                    }
                    case 'import-testcases':
                    case 'import-testcase-folder':
                    case 'import-testcase-files':
                    case 'import-testcase-zip': {
                        try {
                            const tests = message.command === 'import-testcases' ? await importTestcasesWithPicker(message.srcPath) : await importTestcases(message.srcPath, message.pathOrUri, message.command === 'import-testcase-files', message.command === 'import-testcase-folder');
                            if (tests === 'json') {
                                this.extensionToJudgeViewMessage({ command: 'show-json-import', srcPath: message.srcPath });
                            } else if (tests.length) { this.persistImportedTests(message.srcPath, tests); }
                        } catch (error) {
                            void vscode.window.showErrorMessage(localize('judger.import.failed', 'Could not import testcases: {0}', String(error)));
                        }
                        break;
                    }
                    case 'run-single-and-save': {
                        if (
                            isStressTestRunning() ||
                            this.ordinaryRunRunning || runningBinaries.length > 0 || runningCompilers.length > 0
                        ) {
                            void vscode.window.showErrorMessage(
                                'Stop the stress test before running test cases.',
                            );
                            break;
                        }
                        const problem = this.resolveRunProblem(message.problem);
                        if (!problem) { break; }
                        const id = message.id;
                        this.ordinaryRunRunning = true;
                        clearKillRequested();
                        void runSingleAndSave(problem, id).catch(error => {
                            void vscode.window.showErrorMessage(localize('judger.run.failed', 'Could not run testcases: {0}', String(error)));
                        }).finally(() => {
                            this.ordinaryRunRunning = false;
                            this.extensionToJudgeViewMessage({ command: 'not-running' });
                        });
                        break;
                    }

                    case 'run-all-and-save': {
                        void this.runAll(message.problem).catch(error => {
                            void vscode.window.showErrorMessage(localize('judger.run.failed', 'Could not run testcases: {0}', String(error)));
                        });
                        break;
                    }

                    case 'stress-start': {
                        if (
                            isStressTestRunning() ||
                            this.ordinaryRunRunning ||
                            runningBinaries.length > 0 ||
                            runningCompilers.length > 0
                        ) {
                            this.extensionToJudgeViewMessage({
                                command: 'stress-finished',
                                runId: message.runId,
                                state: 'error',
                                iteration: 0,
                                message:
                                    'Stop the current run before starting a stress test.',
                            });
                            break;
                        }
                        const problem = this.resolveRunProblem(message.problem);
                        if (problem) { await this.startStressTest({ ...message, problem }); }
                        break;
                    }

                    case 'stress-stop': {
                        if (isStressTestRunning()) {
                            killRunning();
                        }
                        break;
                    }

                    case 'open-stress-example': {
                        try {
                            const document =
                                await vscode.workspace.openTextDocument({
                                    language: message.language,
                                    content: message.content,
                                });
                            await vscode.window.showTextDocument(document, {
                                viewColumn: vscode.ViewColumn.Beside,
                                preview: false,
                            });
                        } catch (error) {
                            globalThis.logger.error(
                                'Failed to open stress test example',
                                error,
                            );
                            void vscode.window.showErrorMessage(
                                'Failed to open the generator example.',
                            );
                        }
                        break;
                    }

                    case 'pick-stress-file': {
                        const selected = await vscode.window.showOpenDialog({
                            canSelectFiles: true,
                            canSelectFolders: false,
                            canSelectMany: false,
                            openLabel:
                                message.role === 'std'
                                    ? 'Select std'
                                    : 'Select generator',
                        });
                        const file = selected?.[0]?.fsPath;
                        if (file && isValidLanguage(file)) {
                            this.extensionToJudgeViewMessage({
                                command: 'stress-file-selected',
                                role: message.role,
                                path: file,
                            });
                        } else if (file) {
                            void vscode.window.showErrorMessage(
                                'Unsupported source file extension.',
                            );
                        }
                        break;
                    }

                    case 'copy-text': {
                        try {
                            await vscode.env.clipboard.writeText(message.text);
                        } catch (error) {
                            globalThis.logger.error(
                                'Failed to copy text from webview',
                                error,
                            );
                            void vscode.window.showErrorMessage(
                                'Failed to copy text to the clipboard.',
                            );
                        }
                        break;
                    }

                    case 'save': {
                        if (!saveProblemFromWebview(message.problem)) {
                            const current = getProblem(message.problem.srcPath);
                            if (current) { this.extensionToJudgeViewMessage({ command: 'new-problem', problem: current, onlyIfActive: true }); }
                        }
                        break;
                    }

                    case 'kill-running': {
                        if (message.testcaseId !== undefined) { stopTestcase(message.problem.srcPath, message.testcaseId); }
                        else { killRunning(); }
                        break;
                    }

                    case 'get-ext-logs': {
                        this.sendExtLogs();
                        break;
                    }

                    case 'delete-tcs': {
                        this.extensionToJudgeViewMessage({
                            command: 'new-problem',
                            problem: undefined,
                            onlineJudgeEnv: getDefaultOnlineJudge(),
                        });
                        await deleteProblemFile(message.problem.srcPath);
                        break;
                    }

                    case 'submitBrowser': {
                        logSubmission(`Webview submitBrowser received; currentProblem=${!!this.currentProblem}`);
                        try {
                            if (this.currentProblem) { await fillBrowserSubmission(this.currentProblem); }
                        } finally {
                            await this.extensionToJudgeViewMessage({ command: 'submit-finished' });
                        }
                        break;
                    }

                    case 'submitWithChoice': {
                        logSubmission(`Webview submitWithChoice received; currentProblem=${!!this.currentProblem}`);
                        try {
                            let method = getDefaultSubmitMethod();
                            if (method === 'ask') {
                                const selection = await vscode.window.showQuickPick([
                                    { label: 'VJudge', value: 'vjudge' as const },
                                    { label: localize('judger.submit.native', '原 OJ'), value: 'native' as const },
                                ], { placeHolder: localize('judger.submit.chooseMethod', '选择提交方式') });
                                if (!selection) { break; }
                                method = selection.value;
                            }
                            if (method === 'vjudge') {
                                if (this.currentProblem) { await fillBrowserSubmission(this.currentProblem); }
                            } else {
                                const hostname = new URL(message.problem.url).hostname;
                                if (hostname === 'open.kattis.com') { await submitKattisProblem(message.problem); }
                                else { storeSubmitProblem(message.problem); }
                            }
                        } finally {
                            await this.extensionToJudgeViewMessage({ command: 'submit-finished' });
                        }
                        break;
                    }

                    case 'submitCf': {
                        storeSubmitProblem(message.problem);
                        break;
                    }

                    case 'submitCSES': {
                        storeSubmitProblem(message.problem);
                        break;
                    }
                    case 'submitKattis': {
                        await submitKattisProblem(message.problem);
                        break;
                    }

                    case 'submitShortestPath': {
                        try {
                            await vscode.commands.executeCommand(
                                'shortestpath.oj.submitProblem',
                                message.problem,
                            );
                        } catch (error) {
                            void vscode.window.showErrorMessage(
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                            );
                        }
                        break;
                    }

                    case 'online-judge-env': {
                        switch (message.value) {
                            case 'true': {
                                setOnlineJudgeEnv(true);
                                break;
                            }
                            case 'false': {
                                setOnlineJudgeEnv(false);
                                break;
                            }
                            case 'default': {
                                const val = getDefaultOnlineJudge();
                                setOnlineJudgeEnv(val);
                                this.extensionToJudgeViewMessage({
                                    command: 'update-online-judge-env',
                                    value: val,
                                });
                                break;
                            }
                        }
                        break;
                    }

                    case 'get-initial-problem': {
                        this.getInitialProblem();
                        break;
                    }

                    case 'set-hide-output-diff': {
                        // message.value expected boolean
                        try {
                            await updatePreference(
                                'general.hideOutputDifference',
                                message.value,
                                vscode.ConfigurationTarget.Global,
                            );
                        } catch (err) {
                            globalThis.logger.error(
                                'Failed to update preference',
                                err,
                            );
                        }
                        break;
                    }

                    case 'create-local-problem': {
                        runTestCases();
                        break;
                    }

                    case 'url': {
                        vscode.env.openExternal(vscode.Uri.parse(message.url));
                        break;
                    }

                    case 'open-settings': {
                        vscode.commands.executeCommand(
                            'workbench.action.openSettings',
                            '@ext:shortestpath.judger',
                        );
                        break;
                    }

                    case 'open-file': {
                        try {
                            const doc = await vscode.workspace.openTextDocument(
                                message.path,
                            );
                            await vscode.window.showTextDocument(doc, {
                                viewColumn: vscode.ViewColumn.One,
                                preview: false,
                            });
                        } catch (err: any) {
                            globalThis.logger.error('Failed to open file', err);
                            vscode.window.showErrorMessage(
                                `Failed to open file: ${err.message}`,
                            );
                        }
                        break;
                    }

                    default: {
                        globalThis.logger.error(
                            'Unknown event received from webview',
                        );
                    }
                }
            },
        );
    }

    private sendExtLogs() {
        this.extensionToJudgeViewMessage({
            command: 'ext-logs',
            logs: globalThis.storedLogs,
        });
    }

    private async startStressTest(
        message: Extract<WebviewToVSEvent, { command: 'stress-start' }>,
    ) {
        const iterations = Math.floor(message.iterations);
        if (
            !Number.isFinite(iterations) ||
            iterations < 0 ||
            iterations > 100000
        ) {
            this.extensionToJudgeViewMessage({
                command: 'stress-finished',
                runId: message.runId,
                state: 'error',
                iteration: 0,
                message: 'Iterations must be between 0 and 100000.',
            });
            return;
        }

        const generatorPath = message.generatorPath;
        const stdPath = message.stdPath;
        if (
            !generatorPath ||
            !stdPath ||
            !isValidLanguage(generatorPath) ||
            !isValidLanguage(stdPath)
        ) {
            this.extensionToJudgeViewMessage({
                command: 'stress-finished',
                runId: message.runId,
                state: 'error',
                iteration: 0,
                message: 'Select a valid generator and standard program first.',
            });
            return;
        }

        try {
            const result = await runStressTest(
                message.problem,
                generatorPath,
                stdPath,
                iterations,
                {
                    onStatus: (phase, role, iteration, total) => {
                        this.extensionToJudgeViewMessage({
                            command: 'stress-status',
                            runId: message.runId,
                            phase,
                            role,
                            iteration,
                            total,
                        });
                    },
                    onProgress: (iteration, total) => {
                        this.extensionToJudgeViewMessage({
                            command: 'stress-progress',
                            runId: message.runId,
                            iteration,
                            total,
                        });
                    },
                    onFailure: (iteration, testcase, runResult) => {
                        const current = getProblem(message.problem.srcPath) ?? message.problem;
                        while (current.tests.some(test => test.id === testcase.id)) { testcase.id++; }
                        runResult.id = testcase.id;
                        const updated = { ...current, tests: [...current.tests, testcase] };
                        saveProblem(updated.srcPath, updated);
                        this.extensionToJudgeViewMessage({ command: 'new-problem', problem: updated, onlyIfActive: true });
                        this.extensionToJudgeViewMessage({ command: 'run-single-result', problem: updated, result: runResult });
                        this.extensionToJudgeViewMessage({
                            command: 'stress-failure',
                            runId: message.runId,
                            iteration,
                            testcase,
                            result: runResult,
                        });
                    },
                },
            );
            this.extensionToJudgeViewMessage({
                command: 'stress-finished',
                runId: message.runId,
                state: result.state,
                iteration: result.iteration,
            });
        } catch (error) {
            const failure = error instanceof StressFailure ? error : undefined;
            this.extensionToJudgeViewMessage({
                command: 'stress-finished',
                runId: message.runId,
                state: 'error',
                iteration: failure?.iteration || 0,
                message: failure ? failure.message : 'Stress testing failed.',
            });
        }
    }

    private persistImportedTests(srcPath: string, tests: TestCase[]) {
        const updated = persistImportedTests(srcPath, tests, vscode.workspace.getConfiguration('judger.problem').get('clearBeforeLoad', false));
        if (updated) { this.extensionToJudgeViewMessage({ command: 'new-problem', problem: updated, onlyIfActive: true }); }
    }

    private resolveRunProblem(snapshot: Problem): Problem | null {
        if (!saveProblemFromWebview(snapshot)) {
            const current = getProblem(snapshot.srcPath);
            this.extensionToJudgeViewMessage({ command: 'new-problem', problem: current ?? undefined, onlyIfActive: !!current });
            return current;
        }
        const current = getProblem(snapshot.srcPath);
        // Storage promotes large inline data to file references. Reflect that before
        // sending results so the view neither keeps huge editors nor rejects the run.
        if (current && current.tests.some(test => !sameTestcase(test, snapshot.tests.find(value => value.id === test.id)))) {
            this.extensionToJudgeViewMessage({ command: 'new-problem', problem: current, onlyIfActive: true });
        }
        return current;
    }

    public async compileSource(srcPath: string) {
        if (isStressTestRunning() || this.ordinaryRunRunning || runningBinaries.length > 0 || runningCompilers.length > 0) {
            void vscode.window.showErrorMessage(localize('judger.run.busy', 'Stop the current run before running testcases.'));
            return;
        }
        this.ordinaryRunRunning = true;
        clearKillRequested();
        const problem = getProblem(srcPath);
        const executable = retainExecutable(getBinSaveLocation(srcPath, problem ? problemLanguage(getLanguage(srcPath), problem) : getLanguage(srcPath)), srcPath);
        try { await compileFile(srcPath, { instrumentation: !problem?.interactorPath, language: problem ? problemLanguage(getLanguage(srcPath), problem) : getLanguage(srcPath) }); }
        finally { executable.dispose(); this.ordinaryRunRunning = false; this.extensionToJudgeViewMessage({ command: 'not-running' }); }
    }

    public async runAll(problem: Problem) {
        if (isStressTestRunning() || this.ordinaryRunRunning || runningBinaries.length > 0 || runningCompilers.length > 0) {
            void vscode.window.showErrorMessage(localize('judger.run.busy', 'Stop the current run before running testcases.'));
            return;
        }
        const current = this.resolveRunProblem(problem);
        if (!current) { return; }
        this.ordinaryRunRunning = true;
        clearKillRequested();
        try { await runAllAndSave(current); }
        catch (error) { void vscode.window.showErrorMessage(localize('judger.run.failed', 'Could not run testcases: {0}', String(error))); }
        finally {
            this.ordinaryRunRunning = false;
            this.extensionToJudgeViewMessage({ command: 'not-running' });
        }
    }

    private getInitialProblem() {
        const doc = vscode.window.activeTextEditor?.document;
        this.extensionToJudgeViewMessage({
            command: 'new-problem',
            // A recreated view may request its initial state while focus is
            // on Output, a terminal, or the integrated browser. Reuse the
            // last source problem in that case instead of clearing the view.
            problem: getInitialJudgeProblem(
                doc,
                this.currentProblem,
                getProblemForDocument,
            ),
            onlineJudgeEnv: onlineJudgeEnv,
        });

        // also load any messages from before that were lost.
        this.messageBuffer.forEach((message) => {
            globalThis.logger.log('Restored buffer command', message.command);
            this._view?.webview.postMessage(message);
        });

        this.messageBuffer = [];

        return;
    }

    public problemPath: string | undefined;

    public async focus() {
        globalThis.logger.log('focusing');
        if (!this._view) {
            await vscode.commands.executeCommand('judger.judgeView.focus');
        } else {
            this._view.show?.(true);
        }
    }

    private focusIfNeeded = (message: VSToWebViewMessage) => {
        globalThis.logger.log(message.command);

        switch (message.command) {
            case 'waiting-for-submit':
            case 'compiling-start':
            case 'run-all': {
                this.focus();
            }
        }

        if (
            message.command === 'new-problem' &&
            message.problem !== undefined &&
            getAutoShowJudgePref()
        ) {
            this.focus();
        }
    };

    public async refreshBrowserSubmission(): Promise<void> {
        if (!this.currentProblem) { return; }
        let submission: ReturnType<typeof getBrowserSubmission>;
        try { submission = getBrowserSubmission(this.currentProblem.url); } catch { /* Invalid mapping. */ }
        const available = !!submission;
        this.currentProblem.browserSubmissionAvailable = available;
        this.currentProblem.browserSubmissionKind = submission?.kind;
        await this.extensionToJudgeViewMessage({ command: 'browser-submission-availability', srcPath: this.currentProblem.srcPath, available, kind: submission?.kind });
    }

    /** Posts a message to the webview. */
    public extensionToJudgeViewMessage = async (
        message: VSToWebViewMessage,
    ) => {
        if (message.command === 'problem-options' && message.patch) {
            if (this.currentProblem?.srcPath === message.srcPath) { this.currentProblem = { ...this.currentProblem, ...message.patch }; }
            const recent = this.recentProblems.get(message.srcPath);
            if (recent) { this.recentProblems.set(message.srcPath, { ...recent, ...message.patch }); }
        }
        if (message.command === 'run-single-result') { this.recentProblems.set(message.problem.srcPath, message.problem); }
        if (message.command === 'new-problem') {
            if (message.onlyIfActive && message.problem?.srcPath !== this.currentProblem?.srcPath) { return; }
            if (message.problem) { this.recentProblems.set(message.problem.srcPath, message.problem); }
            if (message.problem) {
                let submission: ReturnType<typeof getBrowserSubmission>;
                try { submission = getBrowserSubmission(message.problem.url); } catch { /* Invalid mapping: retain native submission. */ }
                message.problem = { ...message.problem, browserSubmissionAvailable: !!submission, browserSubmissionKind: submission?.kind };
            }
            message.onlineJudgeEnv = message.onlineJudgeEnv ?? onlineJudgeEnv;
            this.currentProblem = message.problem;
            this.problemPath = message.problem?.srcPath;
        }
        this.focusIfNeeded(message);
        if (
            (this._view && this._view.visible) ||
            (this._view && getRetainWebviewContextPref())
        ) {
            // Always focus on the view whenever a command is posted. Meh.
            // this._view.show?.(true); // `show` is not implemented in 1.49 but is for 1.50 insiders
            this._view.webview.postMessage(message);
            if (message.command !== 'submit-finished') {
                globalThis.logger.log('View got message', message);
            }
        } else {
            if (message.command !== 'new-problem') {
                globalThis.logger.log('Pushing to buffer', message.command);
                this.messageBuffer.push(message);
            } else {
                this.messageBuffer = [];
            }
        }
    };

    private _getHtmlForWebview(webview: vscode.Webview) {
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'app.css'),
        );

        const remoteServerAddress = getRemoteServerAddressPref();

        const showLiveUserCount = getLiveUserCountPref();

        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'codicon.css'),
        );

        const generatedJsonUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this._extensionUri,
                'dist',
                'static',
                'generated.json',
            ),
        );

        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this._extensionUri,
                'dist',
                'frontend.module.js',
            ),
        );

        const meowAudioUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'meow.mp3'),
        );

        const remoteMessage = globalThis.remoteMessage
            ? globalThis.remoteMessage.trim()
            : ' ';

        const locale = vscode.env.language;
        const translation = translations[locale] || translations['en'];

        let pythonCommand = getPythonCommand();
        if (process.platform === 'win32' && pythonCommand === 'python3') {
            pythonCommand = 'python';
        }

        const problemConfiguration = vscode.workspace.getConfiguration('judger.problem', vscode.window.activeTextEditor?.document.uri ?? null);
        const bootstrap = webviewBootstrap({
            meowAudioUri: meowAudioUri.toString(), remoteMessage, generatedJsonUri: generatedJsonUri.toString(),
            remoteServerAddress, showLiveUserCount, showOutputDifference: !getHideOutputDifferencePref(), translations: translation,
            judgePreferences: { expandBehavior: problemConfiguration.get('expandBehavior', 'failed'), hiddenStatuses: problemConfiguration.get('hiddenStatuses', []), clearBeforeLoad: problemConfiguration.get('clearBeforeLoad', false) },
            locale, pythonCommand,
        });
        const html = `
            <!DOCTYPE html>
            <html>
                <head>
                    <link rel="stylesheet" href="${styleUri}" />
                    <link rel="stylesheet" href="${codiconsUri}" />
                    <meta charset="UTF-8" />
                </head>
                <body>
                    <div id="app">
                        An error occurred! Restarting VS Code may solve the
                        issue. If not, please
                        <a href="https://github.com/KevinHuangIsLearning/competitive-programming-helper-plus/issues"
                            >report the bug on GitHub</a
                        >.
                    </div>
                    <script>
                        ${bootstrap}
                    </script>
                    <script src="${scriptUri}"></script>
                </body>
            </html>
        `;

        return html;
    }
}

export default JudgeViewProvider;

import * as vscode from 'vscode';
import { storeSubmitProblem, submitKattisProblem } from '../companion';
import {
    clearKillRequested,
    deleteBinary,
    killRunning,
    runningBinaries,
} from '../executions';
import { saveProblem } from '../parser';
import {
    Problem,
    VSToWebViewMessage,
    WebviewToVSEvent,
} from '../types';
import {
    deleteProblemFile,
    getLanguage,
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
    getHideOutputDifferencePref,
    updatePreference,
    getPythonCommand,
} from '../preferences';
import {
    runningCompilers,
    getBinSaveLocation,
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
import {
    isLargeSampleTestRunning,
    runLargeSampleTest,
    scanLargeSampleDirectory,
} from '../largeSampleTest';

class JudgeViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'cph.judgeView';

    private _view?: vscode.WebviewView;

    private messageBuffer: VSToWebViewMessage[] = [];

    private currentProblem: Problem | undefined;

    private ordinaryRunRunning = false;

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
                globalThis.logger.log('Got from webview', message);
                switch (message.command) {
                    case 'run-single-and-save': {
                        if (
                            isStressTestRunning() ||
                            isLargeSampleTestRunning() ||
                            this.ordinaryRunRunning
                        ) {
                            void vscode.window.showErrorMessage(
                                'Stop the stress test before running test cases.',
                            );
                            break;
                        }
                        const problem = message.problem;
                        const id = message.id;
                        this.ordinaryRunRunning = true;
                        void runSingleAndSave(problem, id).finally(() => {
                            this.ordinaryRunRunning = false;
                        });
                        break;
                    }

                    case 'run-all-and-save': {
                        if (
                            isStressTestRunning() ||
                            isLargeSampleTestRunning() ||
                            this.ordinaryRunRunning
                        ) {
                            void vscode.window.showErrorMessage(
                                'Stop the stress test before running test cases.',
                            );
                            break;
                        }
                        const problem = message.problem;
                        this.ordinaryRunRunning = true;
                        void this.runAllIncludingLargeSamples(
                            problem,
                            message.largeSampleRunId,
                        ).finally(() => {
                            this.ordinaryRunRunning = false;
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
                        await this.startStressTest(message);
                        break;
                    }

                    case 'pick-large-sample-directory': {
                        const selected = await vscode.window.showOpenDialog({
                            canSelectFiles: false,
                            canSelectFolders: true,
                            canSelectMany: false,
                            openLabel: 'Select large sample directory',
                        });
                        if (selected?.[0]) {
                            this.extensionToJudgeViewMessage({
                                command: 'large-sample-directory-selected',
                                path: selected[0].fsPath,
                            });
                        }
                        break;
                    }

                    case 'pick-large-sample-checker': {
                        const selected = await vscode.window.showOpenDialog({
                            canSelectFiles: true,
                            canSelectFolders: false,
                            canSelectMany: false,
                            openLabel: 'Select large sample checker',
                        });
                        if (selected?.[0]) {
                            this.extensionToJudgeViewMessage({
                                command: 'large-sample-checker-selected',
                                path: selected[0].fsPath,
                            });
                        }
                        break;
                    }

                    case 'scan-large-sample': {
                        const result = await scanLargeSampleDirectory(
                            message.directory,
                            message.answerMode || 'auto',
                        );
                        this.extensionToJudgeViewMessage({
                            command: 'large-sample-scan-result',
                            directory: message.directory,
                            ...result,
                        });
                        break;
                    }

                    case 'large-sample-start': {
                        if (
                            isStressTestRunning() ||
                            isLargeSampleTestRunning() ||
                            this.ordinaryRunRunning ||
                            runningBinaries.length > 0 ||
                            runningCompilers.length > 0
                        ) {
                            this.extensionToJudgeViewMessage({
                                command: 'large-sample-finished',
                                runId: message.runId,
                                state: 'error',
                                passed: 0,
                                failed: 0,
                                skipped: 0,
                                message:
                                    'Stop the current run before starting a large sample test.',
                            });
                            break;
                        }
                        await this.startLargeSampleTest(message);
                        break;
                    }

                    case 'large-sample-run-single': {
                        if (
                            isStressTestRunning() ||
                            isLargeSampleTestRunning() ||
                            this.ordinaryRunRunning ||
                            runningBinaries.length > 0 ||
                            runningCompilers.length > 0
                        ) {
                            this.extensionToJudgeViewMessage({
                                command: 'large-sample-finished',
                                runId: message.runId,
                                state: 'error',
                                passed: 0,
                                failed: 0,
                                skipped: 0,
                                message:
                                    'Stop the current run before running a large sample.',
                            });
                            break;
                        }
                        await this.startLargeSampleTest(message, {
                            onlyCaseName: message.testcaseName,
                        });
                        break;
                    }

                    case 'large-sample-stop': {
                        if (isLargeSampleTestRunning()) killRunning();
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

                    case 'open-large-sample-file': {
                        try {
                            const document = await vscode.workspace.openTextDocument(
                                message.path,
                            );
                            await vscode.window.showTextDocument(document, {
                                viewColumn: vscode.ViewColumn.Beside,
                                preview: false,
                            });
                        } catch (error) {
                            globalThis.logger.error(
                                'Failed to open large sample file',
                                error,
                            );
                            void vscode.window.showErrorMessage(
                                'Failed to open the large sample file.',
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
                        saveProblem(message.problem.srcPath, message.problem);
                        break;
                    }

                    case 'kill-running': {
                        killRunning();
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

                    case 'submitCf': {
                        storeSubmitProblem(message.problem);
                        break;
                    }

                    case 'submitCSES': {
                        storeSubmitProblem(message.problem);
                        break;
                    }
                    case 'submitKattis': {
                        submitKattisProblem(message.problem);
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
                            '@ext:DivyanshuAgrawal.competitive-programming-helper',
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
            iterations < 1 ||
            iterations > 100000
        ) {
            this.extensionToJudgeViewMessage({
                command: 'stress-finished',
                runId: message.runId,
                state: 'error',
                iteration: 0,
                message: 'Iterations must be between 1 and 100000.',
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

    private async startLargeSampleTest(
        message: Extract<
            WebviewToVSEvent,
            | { command: 'large-sample-start' }
            | { command: 'large-sample-run-single' }
        >,
        selection: { onlyCaseName?: string } = {},
        precompiled = false,
    ) {
        clearKillRequested();
        const checkerPath = message.checkerEnabled
            ? message.checkerPath ||
              message.problem.largeSampleCheckerPath ||
              (message.problem.largeSampleCheckerEnabled
                  ? message.problem.customCheckerPath
                  : undefined)
            : undefined;
        if (message.checkerEnabled && !checkerPath?.trim()) {
            this.extensionToJudgeViewMessage({
                command: 'large-sample-finished',
                runId: message.runId,
                state: 'error',
                passed: 0,
                failed: 0,
                skipped: 0,
                message: 'Select a custom checker before starting.',
            });
            return;
        }
        try {
            const result = await runLargeSampleTest(
                message.problem,
                message.directory,
                message.runId,
                {
                    comparison: message.comparison,
                    runMode:
                        message.command === 'large-sample-run-single'
                            ? 'stop-on-failure'
                            : message.runMode,
                    answerMode: message.answerMode,
                    checkerPath: checkerPath?.trim(),
                    onlyCaseName: selection.onlyCaseName,
                    skippedCaseNames: message.problem.largeSampleSkippedCases,
                    precompiled,
                    callbacks: {
                        onStatus: (phase, index, total, name, statusMessage) => {
                            this.extensionToJudgeViewMessage({
                                command: 'large-sample-status',
                                runId: message.runId,
                                phase,
                                index,
                                total,
                                name,
                                message: statusMessage,
                            });
                        },
                        onFailure: (failure, index, total) => {
                            this.extensionToJudgeViewMessage({
                                command: 'large-sample-failure',
                                runId: message.runId,
                                index,
                                total,
                                testcase: failure.testcase,
                                outputPath: failure.outputPath,
                                stdout: failure.stdout,
                                stderr: failure.stderr,
                                answer: failure.answer,
                                passed: false,
                                reason: failure.reason,
                                diff: failure.diff,
                                checkerRun: failure.checkerRun,
                            });
                        },
                        onCaseResult: (
                            testcase,
                            index,
                            total,
                            state,
                            outputPath,
                            reason,
                            time,
                        ) => {
                            this.extensionToJudgeViewMessage({
                                command: 'large-sample-case-result',
                                runId: message.runId,
                                index,
                                total,
                                testcase,
                                state,
                                outputPath,
                                reason,
                                time,
                            });
                        },
                    },
                },
            );
            this.extensionToJudgeViewMessage({
                command: 'large-sample-finished',
                runId: message.runId,
                ...result,
            });
        } catch (error) {
            this.extensionToJudgeViewMessage({
                command: 'large-sample-finished',
                runId: message.runId,
                state: 'error',
                passed: 0,
                failed: 0,
                skipped: 0,
                message:
                    error instanceof Error
                        ? error.message
                        : 'Large sample testing failed.',
            });
        }
    }

    public async runAllIncludingLargeSamples(
        problem: Problem,
        requestedRunId?: number,
    ) {
        const directory = problem.largeSampleDirectory?.trim();
        const shouldRunLargeSamples =
            Boolean(directory) && problem.largeSampleEnabled !== false;
        if (!shouldRunLargeSamples || !directory) {
            await runAllAndSave(problem);
            return;
        }

        try {
            const didRunOrdinaryCases = await runAllAndSave(problem, true);
            if (!didRunOrdinaryCases) return;
            const runId = requestedRunId || Date.now();
            this.extensionToJudgeViewMessage({
                command: 'large-sample-run-started',
                runId,
            });
            await this.startLargeSampleTest(
                {
                    command: 'large-sample-start',
                    runId,
                    problem,
                    directory,
                    comparison: problem.largeSampleComparison || {
                        ignoreTrailingWhitespace: true,
                        ignoreBlankLines: false,
                        ignoreOuterWhitespace: true,
                        tokenCompare: false,
                    },
                    runMode: problem.largeSampleRunMode || 'stop-on-failure',
                    answerMode: problem.largeSampleAnswerMode || 'auto',
                    checkerEnabled: problem.largeSampleCheckerEnabled ?? false,
                    checkerPath: problem.largeSampleCheckerPath,
                },
                {},
                true,
            );
        } finally {
            deleteBinary(
                getLanguage(problem.srcPath),
                getBinSaveLocation(problem.srcPath),
            );
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
            await vscode.commands.executeCommand('cph.judgeView.focus');
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

    /** Posts a message to the webview. */
    public extensionToJudgeViewMessage = async (
        message: VSToWebViewMessage,
    ) => {
        if (message.command === 'new-problem') {
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
                        // Since the react script takes time to load, the problem is sent to the webview before it has even loaded.
                        // So, for the initial request, ask for it again.
                        window.vscodeApi = acquireVsCodeApi();
                        window.meowAudioUri = '${meowAudioUri}';
                        window.remoteMessage = '${remoteMessage}';
                        window.generatedJsonUri = '${generatedJsonUri}';
                        window.remoteServerAddress = '${remoteServerAddress}';
                        window.showLiveUserCount = ${showLiveUserCount};
                        window.showOutputDifference = ${!getHideOutputDifferencePref()};
                        window.translations = ${JSON.stringify(translation)};
                        window.locale = ${JSON.stringify(locale)};
                        window.pythonCommand = '${pythonCommand}';

                        document.addEventListener(
                            'DOMContentLoaded',
                            (event) => {
                                vscodeApi.postMessage({
                                    command: 'get-initial-problem',
                                });
                                vscodeApi.postMessage({
                                    command: 'online-judge-env',
                                    value: 'default',
                                });
                                globalThis.logger.log("Requested initial problem");
                            },
                        );
                    </script>
                    <script src="${scriptUri}"></script>
                </body>
            </html>
        `;

        return html;
    }
}

export default JudgeViewProvider;

import { getProblemDirectory } from './parser';
import { registerProblemDocuments } from './problemDocument';
/************************************************************************************/
globalThis.storedLogs = '';
function customLogger(
    originalMethod: (...args: any[]) => void,
    ...args: any[]
) {
    originalMethod(...args);

    globalThis.storedLogs += new Date().toISOString() + ' ';
    globalThis.storedLogs +=
        args
            .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : arg))
            .join(' ') + '\n';
}

globalThis.logger = {};
globalThis.logger.log = (...args: any[]) => customLogger(console.log, ...args);
globalThis.logger.error = (...args: any[]) =>
    customLogger(console.error, ...args);
globalThis.logger.warn = (...args: any[]) =>
    customLogger(console.warn, ...args);
globalThis.logger.info = (...args: any[]) =>
    customLogger(console.info, ...args);
globalThis.logger.debug = (...args: any[]) =>
    customLogger(console.debug, ...args);
/************************************************************************************/

import * as vscode from 'vscode';
import { migrateSettings } from './settingsMigration';
import { setupCompanionServer, handleNewProblem } from './companion';
import { registerBrowserImport } from './browserImport';
import runTestCases from './runTestCases';
import {
	editorChanged,
	editorClosed,
	judgeViewTabsChanged,
    checkLaunchWebview,
} from './webview/editorChange';
import { submitToCodeForces, submitToKattis } from './submit';
import { registerBrowserSubmission } from './browserSubmission';
import JudgeViewProvider from './webview/JudgeView';
import {
    getRetainWebviewContextPref,
    getDefaultOnlineJudge,
} from './preferences';
import TelemetryReporter from '@vscode/extension-telemetry';
import config from './config';
import localize from './i18n';
import { setOnlineJudgeEnv } from './compiler';
import { checkUnsupported } from './utils';
import { createLatestTaskScheduler } from './webview/judgeLifecycle';

let judgeViewProvider: JudgeViewProvider;

export const getJudgeViewProvider = () => {
    return judgeViewProvider;
};

const registerCommands = (context: vscode.ExtensionContext) => {
    globalThis.logger.log('Registering commands');
    registerBrowserSubmission(context);
    registerBrowserImport(context, handleNewProblem);
    context.subscriptions.push(vscode.commands.registerCommand('judger.getProblemDirectory', (srcPath: string) => getProblemDirectory(srcPath)));
    // Keep existing user keybindings and external callers working after the ID change.
    for (const command of ['runTestCases', 'submitToCodeForces', 'submitToKattis', 'compileWithoutRunning', 'runSubmitScript', 'getSubmitScriptAliases', 'getSubmitScriptDefaults', 'judgeView.focus']) {
        context.subscriptions.push(vscode.commands.registerCommand(`cph.${command}`, (...args: unknown[]) => vscode.commands.executeCommand(`judger.${command}`, ...args)));
    }
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('judger.general')) { void judgeViewProvider?.refreshBrowserSubmission(); }
    }));
    const disposable = vscode.commands.registerCommand(
        'judger.runTestCases',
        () => {
            runTestCases();
        },
    );

    const disposable2 = vscode.commands.registerCommand(
        'extension.runCodeforcesTestcases',
        () => {
            runTestCases();
        },
    );

    const disposable3 = vscode.commands.registerCommand(
        'judger.submitToCodeForces',
        () => {
            submitToCodeForces();
        },
    );
    const disposable4 = vscode.commands.registerCommand(
        'judger.submitToKattis',
        () => {
            submitToKattis();
        },
    );

    const disposable5 = vscode.commands.registerCommand(
        'judger.compileWithoutRunning',
        async () => {
            globalThis.logger.log('Running command "compileWithoutRunning"');
            const editor = vscode.window.activeTextEditor;
            if (editor === undefined) {
                checkUnsupported('');
                return;
            }
            const srcPath = editor.document.fileName;
            if (checkUnsupported(srcPath)) {
                return;
            }
            await getJudgeViewProvider().compileSource(srcPath);
        },
    );

    judgeViewProvider = new JudgeViewProvider(context.extensionUri);

    const webviewView = vscode.window.registerWebviewViewProvider(
        JudgeViewProvider.viewType,
        judgeViewProvider,
        {
            webviewOptions: {
                retainContextWhenHidden: getRetainWebviewContextPref(),
            },
        },
    );

    context.subscriptions.push(webviewView);
    context.subscriptions.push(disposable);
    context.subscriptions.push(disposable2);
    context.subscriptions.push(disposable3);
    context.subscriptions.push(disposable4);
    context.subscriptions.push(disposable5);
    globalThis.reporter = new TelemetryReporter(config.telemetryKey);
    context.subscriptions.push(globalThis.reporter);
};

// This method is called when the extension is activated
export async function activate(context: vscode.ExtensionContext) {
    await migrateSettings(context);
    setOnlineJudgeEnv(getDefaultOnlineJudge());
    globalThis.logger.log('cph: activate() execution started');
    globalThis.extensionContext = context;

    downloadRemoteMessage();

    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        1000,
    );
    statusBarItem.text = localize(
        'judger.extension.statusBarText',
        ' $(run-all)  Run Testcases',
    );
    statusBarItem.tooltip = localize(
        'judger.extension.statusBarTooltip',
        'ShortestPath Judger - Run all testcases or create if none exist.',
    );
    context.subscriptions.push(statusBarItem);
    statusBarItem.show();
    statusBarItem.command = 'judger.runTestCases';

    registerCommands(context);
    registerProblemDocuments(context, problem => { void judgeViewProvider.extensionToJudgeViewMessage({ command: 'new-problem', problem, onlyIfActive: true }); });
    const companion = setupCompanionServer();
    if (companion) { context.subscriptions.push(new vscode.Disposable(() => companion.close())); }
    checkLaunchWebview();

	const tabChangeScheduler = createLatestTaskScheduler(
		(task) => setTimeout(task, 0),
		(handle) => clearTimeout(handle),
	);
	context.subscriptions.push(
		vscode.workspace.onDidCloseTextDocument((e) => {
			editorClosed(e);
			tabChangeScheduler.schedule(judgeViewTabsChanged);
		}),
		new vscode.Disposable(tabChangeScheduler.dispose),
	);
	// A document can remain retained after its final editor tab is closed, so
	// use the tab model rather than visible editors to distinguish closing a
	// source tab from merely moving focus to another editor.
	context.subscriptions.push(
		vscode.window.tabGroups.onDidChangeTabs(() => {
			tabChangeScheduler.schedule(judgeViewTabsChanged);
		}),
	);

	const activeEditorChangeScheduler = createLatestTaskScheduler(
        (task) => setTimeout(task, 0),
        (handle) => clearTimeout(handle),
	);
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            // A custom editor (such as the integrated browser) may emit this
            // event while VS Code is still transitioning tabs. Read the settled
            // active text editor on the next turn instead of using that transient
            // event payload.
            activeEditorChangeScheduler.schedule(() => {
                editorChanged(vscode.window.activeTextEditor);
            });
        }),
        new vscode.Disposable(activeEditorChangeScheduler.dispose),
    );

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('judger.general.defaultOnlineJudge')) {
            const newValue = getDefaultOnlineJudge();
            setOnlineJudgeEnv(newValue);
            getJudgeViewProvider().extensionToJudgeViewMessage({
                command: 'update-online-judge-env',
                value: newValue,
            });
        }
    }));

    return;
}

async function downloadRemoteMessage() {
    try {
        globalThis.logger.log('Fetching remote message');
        globalThis.remoteMessage = await (
            await fetch(config.remoteMessageUrl)
        ).text();
        getJudgeViewProvider().extensionToJudgeViewMessage({
            command: 'remote-message',
            message: globalThis.remoteMessage,
        });
        globalThis.logger.log(
            'Remote message fetched',
            globalThis.remoteMessage,
        );
    } catch (e) {
        globalThis.logger.error('Error fetching remote message', e);
    }
}

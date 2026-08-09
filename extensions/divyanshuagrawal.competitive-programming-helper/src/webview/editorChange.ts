import * as vscode from 'vscode';
import { getJudgeViewProvider } from '../extension';
import { getProblemForDocument } from '../utils';
import { getAutoShowJudgePref, getDefaultOnlineJudge } from '../preferences';
import { setOnlineJudgeEnv } from '../compiler';
import { getRefreshSourcePath } from './judgeLifecycle';

let lastActiveSourcePath: string | undefined;

/**
 * Refresh the webview only when another supported local source file becomes
 * active. Moving focus to a terminal, Output, integrated browser, or another
 * non-source surface preserves the current problem and its running results.
 *
 * @param e An editor
 */
export const editorChanged = async (e: vscode.TextEditor | undefined) => {
    globalThis.logger.log('Changed editor to', e?.document.fileName);

    if (e === undefined) {
        globalThis.logger.log(
            'No active text editor; preserving the current Judge view',
        );
        return;
    }

    const sourcePath = getRefreshSourcePath(
        e.document,
        getJudgeViewProvider().problemPath,
        lastActiveSourcePath,
    );
    if (sourcePath === undefined) {
        globalThis.logger.log(
            'Non-source or repeated editor activation; preserving Judge view',
        );
        return;
    }

    lastActiveSourcePath = sourcePath;

    setOnlineJudgeEnv(getDefaultOnlineJudge()); // reset the non-debug mode set in webview as configured.

    const problem = getProblemForDocument(e.document);

    if (problem === undefined) {
        getJudgeViewProvider().extensionToJudgeViewMessage({
            command: 'new-problem',
            problem: undefined,
        });
        return;
    }

    if (
        getAutoShowJudgePref() &&
        getJudgeViewProvider().isViewUninitialized()
    ) {
        vscode.commands.executeCommand('cph.judgeView.focus');
    }

    globalThis.logger.log('Sent problem @', Date.now());
    getJudgeViewProvider().extensionToJudgeViewMessage({
        command: 'new-problem',
        problem,
    });
    void vscode.commands.executeCommand(
        'shortestpath.oj.showProblemForCph',
        problem.url,
    );
};

export const editorClosed = (e: vscode.TextDocument) => {
    globalThis.logger.log('Closed editor:', e.uri.fsPath);
    const srcPath = e.uri.fsPath;
    if (lastActiveSourcePath === srcPath) {
        lastActiveSourcePath = undefined;
    }
};

export const judgeViewTabsChanged = () => {
	const problemPath = getJudgeViewProvider().problemPath;
	if (problemPath === undefined) {
		return;
	}
	const sourceTabIsOpen = vscode.window.tabGroups.all.some(group => group.tabs.some(tab => {
		const input = tab.input as { uri?: vscode.Uri } | undefined;
		return input?.uri?.scheme === 'file' && input.uri.fsPath === problemPath;
	}),
	);
	if (sourceTabIsOpen) {
		return;
	}
	// The source tab is gone, so clear both the Judge view and the ShortestPath
	// problem preview. Unlike visibleTextEditors, tabGroups does not report a
	// false close merely because focus moved to another editor.
    if (lastActiveSourcePath === problemPath) {
        lastActiveSourcePath = undefined;
    }
    getJudgeViewProvider().extensionToJudgeViewMessage({
        command: 'new-problem',
        problem: undefined,
    });
    void vscode.commands.executeCommand(
        'shortestpath.oj.hideProblemForCphSourcePath',
        problemPath,
    );
};

export const checkLaunchWebview = () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    editorChanged(editor);
};

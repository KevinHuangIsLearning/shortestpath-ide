import * as vscode from 'vscode';
import { getJudgeViewProvider, updateJudgeVisibility } from '../extension';
import { getProblem } from '../parser';
import { usesIntegratedTests } from '../integratedTests';
import { getProblemForDocument } from '../utils';
import { getAutoShowJudgePref, getDefaultOnlineJudge } from '../preferences';
import { setOnlineJudgeEnv } from '../compiler';
import { getRefreshSourcePath, JudgeDocument, shouldClearJudgeForActiveDocument } from './judgeLifecycle';
import { Problem } from '../types';
import { openProblemBrowser } from '../problemBrowser';

let lastActiveSourcePath: string | undefined;
const restoredBrowserTabs = new WeakSet<vscode.Tab>();

/** Paired source tabs can become active without exposing a TextEditor. */
export const updateActiveTabJudgeVisibility = () => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const uri = (input as { uri?: vscode.Uri } | undefined)?.uri;
    if (uri && !shouldClearJudgeForActiveDocument({ fileName: uri.fsPath, uri })) {
        refreshJudgeForSource({ fileName: uri.fsPath, uri }, getProblem(uri.fsPath) ?? undefined);
    }
};

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

    if (!shouldClearJudgeForActiveDocument(e.document)) {
        refreshJudgeForSource(e.document, getProblemForDocument(e.document));
    }
};

/** Text editors and paired source tabs share the same path-based refresh. */
const refreshJudgeForSource = (document: JudgeDocument, problem: Problem | undefined) => {
    updateJudgeVisibility(problem);
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const tabUri = (tab?.input as { uri?: vscode.Uri } | undefined)?.uri;
    if (problem && tab && tabUri?.scheme === 'file' && tabUri.fsPath === document.fileName && !restoredBrowserTabs.has(tab)) {
        restoredBrowserTabs.add(tab);
        void openProblemBrowser(problem).catch(error => {
            restoredBrowserTabs.delete(tab);
            globalThis.logger.error('Failed to restore problem browser:', error);
        });
    }

    const sourcePath = getRefreshSourcePath(
        document,
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

    if (problem === undefined) {
        getJudgeViewProvider().extensionToJudgeViewMessage({
            command: 'new-problem',
            problem: undefined,
        });
        return;
    }

    if (
        !usesIntegratedTests(problem) &&
        getAutoShowJudgePref() &&
        getJudgeViewProvider().isViewUninitialized()
    ) {
        vscode.commands.executeCommand('judger.judgeView.focus');
    }

    globalThis.logger.log('Sent problem @', Date.now());
    getJudgeViewProvider().extensionToJudgeViewMessage({
        command: 'new-problem',
        problem,
    });
    // The OJ coordinator observes native tabs directly. Judge updates must not
    // feed editor activation back into problem navigation.
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

export const refreshActiveJudgeTab = () => {
    judgeViewTabsChanged();
    updateActiveTabJudgeVisibility();
};

export const checkLaunchWebview = () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    editorChanged(editor);
};

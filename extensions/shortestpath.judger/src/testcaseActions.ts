/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger. Licensed under GPL-3.0-or-later.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import { CaseAction, CaseMode, Problem, RunResult, TestCase } from './types';
import { getProbSaveLocation } from './parser';
import localize from './i18n';
import { testcaseDocumentUri } from './problemDocument';

export type CaseChange = { action: CaseAction; testcase: TestCase };

/**
 * Runs one entry of the testcase card's "⋯" menu. The menu itself is drawn by
 * the webview (CaseActionsMenu), so this only executes the action it was handed;
 * the surfaces a webview cannot draw — file pickers, the editor and the diff
 * view — stay here.
 *
 * The repository applies changes to the current stored problem after pickers finish.
 *
 * File actions keep large data in the host and return only a path or bounded text.
 */
export async function testcaseAction(problem: Problem, id: number, action: CaseAction, mode?: CaseMode, result?: RunResult | null): Promise<CaseChange | undefined> {
    const original = problem.tests.find(test => test.id === id);
    if (!original) { return; }
    // Deleting is confirmed in the menu itself: its row turns into "Confirm" on
    // the first press. The host only has to hand the row back for the webview to
    // drop, so there is no second prompt here.
    if (action === 'delete') {
        return { action, testcase: original };
    }
    const testcase = { ...original };
    const directory = path.join(`${getProbSaveLocation(problem.srcPath)}.judger`, 'files');
    const materialize = async (text: string, name: string) => {
        await fs.promises.mkdir(directory, { recursive: true });
        const file = path.join(directory, name);
        await fs.promises.writeFile(file, text);
        return file;
    };
    if (action === 'input' || action === 'output') {
        // The menu always sends a mode alongside a data action.
        if (!mode) { return; }
        const field = action;
        const fileKey = field === 'input' ? 'inputPath' : 'outputPath';
        const file = testcase[fileKey];
        if (mode === 'open') {
            const target = file ? vscode.Uri.file(file) : testcaseDocumentUri(problem.srcPath, id, field);
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target), { viewColumn: vscode.ViewColumn.Beside });
            return;
        }
        if (mode === 'choose') {
            const selected = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false });
            if (!selected?.[0]) { return; }
            testcase[fileKey] = selected[0].fsPath; testcase[field] = '';
        } else if (mode === 'toggle' && file) {
            const limit = vscode.workspace.getConfiguration('judger.problem').get<number>('maxInlineDataLength', 65536);
            if ((await fs.promises.stat(file)).size > limit) {
                throw new Error(localize('judger.actions.large', 'File exceeds the inline limit. Edit it using Open in editor.'));
            }
            testcase[field] = await fs.promises.readFile(file, 'utf8'); delete testcase[fileKey];
        } else if (mode === 'empty') {
            testcase[field] = ''; delete testcase[fileKey];
        } else {
            let target = file;
            if (!target && mode === 'toggle') {
                target = (await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(path.dirname(problem.srcPath), `${id}.${field === 'input' ? 'in' : 'out'}`)) }))?.fsPath;
                if (!target) { return; }
                await fs.promises.writeFile(target, testcase[field]);
            }
            target ??= await materialize(testcase[field], `${id}.${field === 'input' ? 'in' : 'out'}`);
            testcase[fileKey] = target; testcase[field] = '';
        }
    } else if (action === 'compare' && result) {
        const answer = testcase.outputPath ?? await materialize(testcase.output, `${id}.expected`);
        const output = result.stdoutPath ?? await materialize(result.stdout, `${id}.actual`);
        await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(answer), vscode.Uri.file(output), localize('judger.actions.diffTitle', 'Expected ↔ Actual'));
        return;
    } else if (action === 'answer' && result) {
        if (result.stdoutPath) {
            await fs.promises.mkdir(directory, { recursive: true });
            const target = path.join(directory, `${id}.answer-${Date.now()}.out`);
            await fs.promises.copyFile(result.stdoutPath, target);
            testcase.output = ''; testcase.outputPath = target;
        } else { testcase.output = result.stdout; delete testcase.outputPath; }
    } else if (action === 'disable') { testcase.disabled = !testcase.disabled; }
    return { action, testcase };
}

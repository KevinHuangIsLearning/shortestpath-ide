import { problemDocumentUri } from './problemDocument';
/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger. Licensed under GPL-3.0-or-later.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import { Problem } from './types';
import { getProbSaveLocation, saveProblem } from './parser';
import localize from './i18n';

export async function copyProblem(problem: Problem, target: string): Promise<Problem> {
    const directory = `${getProbSaveLocation(target)}.judger`;
    if (path.resolve(target) === path.resolve(problem.srcPath) || fs.existsSync(target) || fs.existsSync(directory)) {
        throw new Error(localize('judger.problem.copyExists', 'The destination source or problem data already exists.'));
    }
    // Claim the destination before copying anything. Rollback only our own files.
    await fs.promises.mkdir(path.dirname(directory), { recursive: true });
    await fs.promises.mkdir(directory);
    let sourceCreated = false;
    try {
        await fs.promises.copyFile(problem.srcPath, target, fs.constants.COPYFILE_EXCL);
        sourceCreated = true;
        const copied = { ...problem, srcPath: target, timeSpentMs: 0, timeStartedAtUnixMs: undefined, timeAcceptedAtUnixMs: undefined, name: path.parse(target).name, tests: problem.tests.map(test => ({ ...test })) };
        for (const test of copied.tests) {
            for (const field of ['inputPath', 'outputPath'] as const) {
                if (!test[field]) { continue; }
                const to = path.join(directory, `${test.id}.${field === 'inputPath' ? 'in' : 'out'}`);
                await fs.promises.copyFile(test[field]!, to, fs.constants.COPYFILE_EXCL);
                test[field] = to;
            }
        }
        saveProblem(target, copied);
        return copied;
    } catch (error) {
        await fs.promises.rm(directory, { recursive: true, force: true });
        if (sourceCreated) { await fs.promises.rm(target, { force: true }); }
        throw error;
    }
}

export async function problemActions(problem: Problem, recentProblems: Problem[] = []): Promise<Partial<Problem> | 'clear' | undefined> {
    const fields = ['name', 'url', 'timeLimit', 'memoryLimit', 'compilerCommand', 'compilerArgs', 'interpreterCommand', 'interpreterArgs'] as const;
    const labels = [
        localize('judger.problem.name', 'Problem name'), localize('judger.problem.url', 'Problem URL'),
        localize('judger.problem.time', 'Time limit (ms)'), localize('judger.problem.memory', 'Memory limit (MiB)'),
        localize('judger.problem.compiler', 'Compiler command'), localize('judger.problem.compilerArgs', 'Compiler arguments (JSON array)'),
        localize('judger.problem.interpreter', 'Interpreter command'), localize('judger.problem.interpreterArgs', 'Interpreter arguments (JSON array)'),
    ];
    const selected = await vscode.window.showQuickPick([
        ...fields.map((key, i) => ({ key: key as string, label: labels[i] })),
        { key: 'recent', label: localize('judger.problem.recent', 'Switch to another problem…') },
        { key: 'copy', label: localize('judger.problem.copy', 'Copy source and testcases…') },
        { key: 'clear', label: localize('judger.problem.clear', 'Clear all results') },
        { key: 'raw', label: localize('judger.problem.raw', 'Edit problem JSON') },
        { key: 'testlib', label: localize('judger.problem.testlib', 'Open bundled testlib.h') },
    ]);
    if (!selected) { return; }
    if (selected.key === 'recent') {
        const target = await vscode.window.showQuickPick(recentProblems.filter(item => item.srcPath !== problem.srcPath).map(item => ({ label: item.name, description: item.srcPath, source: item.srcPath })));
        if (target) { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target.source)); }
        return;
    }
    if (selected.key === 'clear') { return 'clear'; }
    if (selected.key === 'raw') {
        saveProblem(problem.srcPath, problem);
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(problemDocumentUri(problem.srcPath)));
        return;
    }
    if (selected.key === 'testlib') {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(path.join(globalThis.extensionContext.extensionPath, 'dist/static/testlib/testlib.h')));
        return;
    }
    if (selected.key === 'copy') {
        const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(path.dirname(problem.srcPath), `${path.parse(problem.srcPath).name}-copy${path.extname(problem.srcPath)}`)) });
        if (target) {
            await (await vscode.workspace.openTextDocument(problem.srcPath)).save();
            await copyProblem(problem, target.fsPath);
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
        }
        return;
    }
    const key = selected.key as typeof fields[number];
    const numeric = key === 'timeLimit' || key === 'memoryLimit';
    const array = key === 'compilerArgs' || key === 'interpreterArgs';
    const validate = (value: string): string | undefined => {
        if (numeric && (!Number.isFinite(Number(value)) || Number(value) <= 0)) { return localize('judger.problem.positive', 'Enter a positive number.'); }
        if (array && value) {
            try { const data = JSON.parse(value); if (Array.isArray(data) && data.every(item => typeof item === 'string')) { return; } } catch { /* show validation */ }
            return localize('judger.problem.array', 'Enter a JSON array of strings, for example ["-O2", "-std=c++17"].');
        }
        return;
    };
    const current = problem[key];
    const text = await vscode.window.showInputBox({ title: selected.label, value: Array.isArray(current) ? JSON.stringify(current) : String(current ?? ''), validateInput: validate });
    if (text === undefined || validate(text)) { return; }
    return { [key]: numeric ? Number(text) : array ? text ? JSON.parse(text) : undefined : text };
}

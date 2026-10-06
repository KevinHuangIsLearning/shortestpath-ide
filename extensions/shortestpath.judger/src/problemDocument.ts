/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger. Licensed under GPL-3.0-or-later.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { getProblem, saveProblem } from './parser';
import { Problem } from './types';
import { invalidProblemPatchFields } from './problemValidation';
import localize from './i18n';

export const testcaseDocumentUri = (srcPath: string, id: number, field: 'input' | 'output') => vscode.Uri.from({ scheme: 'judger-data', path: `/testcases/${id}.${field === 'input' ? 'in' : 'out'}`, query: encodeURIComponent(srcPath) });

export const problemDocumentUri = (srcPath: string) => vscode.Uri.from({ scheme: 'judger-data', path: '/problem.json', query: encodeURIComponent(srcPath) });

export function validateProblemDocument(text: string, previous: Problem): Problem {
    const data = JSON.parse(text) as Problem;
    if (!data || data.srcPath !== previous.srcPath || !Array.isArray(data.tests) || typeof data.name !== 'string' || typeof data.url !== 'string'
        || !Number.isFinite(data.timeLimit) || data.timeLimit <= 0 || !Number.isFinite(data.memoryLimit) || data.memoryLimit <= 0) {
        throw new Error(localize('judger.problem.invalidDocument', 'Invalid problem data. Keep the source path, positive limits, name, URL and testcase array.'));
    }
    // Field-level constraints live in problemValidation so the settings form and
    // this document writer cannot drift apart.
    if (invalidProblemPatchFields(data).length
        || data.timeSpentMs !== undefined && (!Number.isFinite(data.timeSpentMs) || data.timeSpentMs < 0)) {
        throw new Error(localize('judger.problem.invalidDocument', 'Invalid problem data. Keep the source path, positive limits, name, URL and testcase array.'));
    }
    const ids = new Set<number>();
    for (const test of data.tests) {
        if (!test || typeof test !== 'object' || test.disabled !== undefined && typeof test.disabled !== 'boolean' || !Number.isSafeInteger(test.id) || test.id < 0 || ids.has(test.id) || typeof test.input !== 'string' || typeof test.output !== 'string'
            || test.inputPath !== undefined && typeof test.inputPath !== 'string' || test.outputPath !== undefined && typeof test.outputPath !== 'string') {
            throw new Error(localize('judger.problem.invalidTests', 'Testcases must have unique numeric IDs, text input/output and optional file paths.'));
        }
        ids.add(test.id);
    }
    return data;
}

/**
 * Merges a settings patch into the *current* problem. The host re-checks the
 * shared field rules so a stale webview draft cannot persist invalid values, and
 * merging here (rather than trusting the webview snapshot) keeps concurrently
 * edited testcases and the running timer intact.
 */
export function applyProblemPatch(problem: Problem, patch: Partial<Problem>): Problem {
    const invalid = invalidProblemPatchFields(patch);
    if (invalid.length) {
        throw new Error(localize('judger.problem.invalidPatch', 'Rejected problem settings: {0}', invalid.join(', ')));
    }
    return { ...problem, ...patch };
}

export function registerProblemDocuments(context: vscode.ExtensionContext, changed: (problem: Problem) => void): void {
    const emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    context.subscriptions.push(emitter);
    const read = (uri: vscode.Uri): Problem => {
        const problem = getProblem(decodeURIComponent(uri.query));
        if (!problem) { throw vscode.FileSystemError.FileNotFound(uri); }
        return problem;
    };
    const testcase = (uri: vscode.Uri, problem: Problem) => {
        const match = /^\/testcases\/(\d+)\.(in|out)$/.exec(uri.path);
        const field = match?.[2] === 'in' ? 'input' : 'output';
        const test = match && problem.tests.find(test => test.id === Number(match[1]));
        if (!test) { throw vscode.FileSystemError.FileNotFound(uri); }
        if (test[field === 'input' ? 'inputPath' : 'outputPath']) { throw vscode.FileSystemError.NoPermissions(); }
        return { test, field } as const;
    };
    const contents = (uri: vscode.Uri) => {
        const problem = read(uri);
        if (uri.path === '/problem.json') { return JSON.stringify(problem, null, 2); }
        const { test, field } = testcase(uri, problem);
        return test[field];
    };
    const forbidden = () => { throw vscode.FileSystemError.NoPermissions(); };
    context.subscriptions.push(vscode.workspace.registerFileSystemProvider('judger-data', {
        onDidChangeFile: emitter.event,
        watch: () => new vscode.Disposable(() => {}),
        stat: uri => ({ type: vscode.FileType.File, size: Buffer.byteLength(contents(uri)), ctime: 0, mtime: Date.now() }),
        readFile: uri => Buffer.from(contents(uri)),
        writeFile: (uri, content) => {
            let problem = read(uri);
            const text = Buffer.from(content).toString('utf8');
            if (uri.path === '/problem.json') { problem = validateProblemDocument(text, problem); }
            else {
                const { test, field } = testcase(uri, problem);
                problem = { ...problem, tests: problem.tests.map(item => item.id === test.id ? { ...item, [field]: text } : item) };
            }
            saveProblem(problem.srcPath, problem);
            const normalized = getProblem(problem.srcPath)!;
            changed(normalized);
            emitter.fire([{ uri, type: vscode.FileChangeType.Changed }]);
        },
        readDirectory: forbidden, createDirectory: forbidden, delete: forbidden, rename: forbidden,
    }, { isCaseSensitive: true }));
}

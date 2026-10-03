import fs from 'fs';
import os from 'os';
import path from 'path';
jest.mock('vscode', () => ({ workspace: { workspaceFolders: [] } }), { virtual: true });
jest.mock('../preferences', () => ({ getSaveLocationPref: jest.fn(() => ''), getCollectProblemsInRoot: jest.fn(() => false) }));
import { getProblem, getProbSaveLocation, removeProblem, saveProblem } from '../parser';
import { writeStoredProblem } from '../problemStorage';
import { getSaveLocationPref } from '../preferences';
import * as vscode from 'vscode';
import { Problem } from '../types';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-migrate-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); jest.clearAllMocks(); (getSaveLocationPref as jest.Mock).mockReturnValue(''); });

test.each(['legacy', 'split'])('first read migrates %s data to .shortestpath and never resurrects a deleted problem', format => {
    const source = path.join(root, 'main.cpp');
    const old = getProbSaveLocation(source, true);
    const text = 'a'.repeat(2 * 1024 * 1024);
    const problem = { srcPath: source, tests: [{ id: 1, input: text, output: 'ok' }] } as Problem;
    fs.mkdirSync(path.dirname(old), { recursive: true });
    if (format === 'legacy') { fs.writeFileSync(old, JSON.stringify(problem)); }
    else { writeStoredProblem(old, problem); }
    const migrated = getProblem(source)!;
    expect(getProbSaveLocation(source)).toContain(`${path.sep}.shortestpath${path.sep}`);
    expect(fs.existsSync(`${getProbSaveLocation(source)}.judger/problem.json`)).toBe(true);
    expect(JSON.stringify(migrated).length).toBeLessThan(1024);
    expect(fs.readFileSync(migrated.tests[0].inputPath!, 'utf8')).toBe(text);
    saveProblem(source, migrated);
    expect(getProblem(source)).toEqual(migrated);
    expect(fs.existsSync(format === 'legacy' ? old : `${old}.judger`)).toBe(true);
    removeProblem(source);
    expect(getProblem(source)).toBeNull();
});

test('custom storage location is preserved and upgraded on read', () => {
    (getSaveLocationPref as jest.Mock).mockReturnValue(root);
    const source = path.join(root, 'main.cpp');
    const file = getProbSaveLocation(source);
    fs.writeFileSync(file, JSON.stringify({ tests: [{ id: 1, input: '1', output: '2' }] }));
    expect(getProblem(source)?.tests[0].input).toBe('1');
    expect(fs.existsSync(`${file}.judger/problem.json`)).toBe(true);
});


test('nested source shares the OJ workspace .shortestpath while locating the old sibling .cph', () => {
    const folder = { uri: { fsPath: root } } as vscode.WorkspaceFolder;
    Object.defineProperty(vscode.workspace, 'workspaceFolders', { value: [folder], configurable: true });
    try {
        const source = path.join(root, 'subfolder', 'main.cpp');
        const old = getProbSaveLocation(source, true);
        fs.mkdirSync(path.dirname(old), { recursive: true });
        fs.writeFileSync(old, JSON.stringify({ tests: [{ id: 1, input: '1', output: '2' }] }));
        expect(path.dirname(getProbSaveLocation(source))).toBe(path.join(root, '.shortestpath'));
        expect(getProblem(source)?.tests[0].input).toBe('1');
        expect(fs.existsSync(`${getProbSaveLocation(source)}.judger/problem.json`)).toBe(true);
    } finally { Object.defineProperty(vscode.workspace, 'workspaceFolders', { value: [], configurable: true }); }
});


test('moving the workspace preserves identity and rebases sample and checker paths', () => {
    const first = path.join(root, 'before'); const second = path.join(root, 'after');
    const folders = (folder: string) => Object.defineProperty(vscode.workspace, 'workspaceFolders', { value: [{ uri: { fsPath: folder } }], configurable: true });
    try {
        fs.mkdirSync(first); folders(first);
        const source = path.join(first, 'main.cpp'); const input = path.join(first, '1.in'); const checker = path.join(first, 'checker.cpp');
        fs.writeFileSync(source, 'int main(){}'); fs.writeFileSync(input, 'data'); fs.writeFileSync(checker, 'int main(){}');
        saveProblem(source, { srcPath: source, tests: [{ id: 1, input: '', output: '', inputPath: input }], customCheckerPath: checker } as Problem);
        fs.renameSync(first, second); folders(second);
        const moved = getProblem(path.join(second, 'main.cpp'))!;
        expect(moved.srcPath).toBe(path.join(second, 'main.cpp'));
        expect(moved.tests[0].inputPath).toBe(path.join(second, '1.in'));
        expect(moved.customCheckerPath).toBe(path.join(second, 'checker.cpp'));
    } finally { Object.defineProperty(vscode.workspace, 'workspaceFolders', { value: [], configurable: true }); }
});


test('ordinary saves preserve the start time and cannot undo an AC timestamp', () => {
    const source = path.join(root, 'timer.cpp');
    const original = { srcPath: source, tests: [], timeSpentMs: 3000, name: 'A', url: '', interactive: false, timeLimit: 1000, memoryLimit: 256, group: '' } as Problem;
    saveProblem(source, original);
    const start = getProblem(source)!.timeStartedAtUnixMs!;
    const stale = { ...original };
    saveProblem(source, { ...original, timeAcceptedAtUnixMs: start + 4000 });
    saveProblem(source, stale);
    expect([getProblem(source)!.timeStartedAtUnixMs, getProblem(source)!.timeAcceptedAtUnixMs]).toEqual([start, start + 4000]);
});


test('legacy managed large data migrates into the owning problem, without changing external references', () => {
    const source = path.join(root, 'legacy-large.cpp');
    const legacy = getProbSaveLocation(source, true);
    const managed = path.join(`${legacy}.judger`, 'files', 'old.in');
    const external = path.join(root, 'external.out');
    fs.mkdirSync(path.dirname(managed), { recursive: true });
    fs.writeFileSync(managed, 'x'.repeat(70000)); fs.writeFileSync(external, 'answer');
    writeStoredProblem(legacy, { srcPath: source, tests: [{ id: 1, input: '', output: '', inputPath: managed, outputPath: external }] } as Problem);
    const migrated = getProblem(source)!;
    fs.rmSync(`${legacy}.judger`, { recursive: true, force: true });
    expect([migrated.tests[0].inputPath!.startsWith(`${getProbSaveLocation(source)}.judger`), migrated.tests[0].outputPath, fs.readFileSync(migrated.tests[0].inputPath!, 'utf8').length]).toEqual([true, external, 70000]);
});

import { saveProblemFromWebview } from '../parser';
test('old autosave cannot remove a host-imported testcase; successive current edits remain writable', () => {
    const source = path.join(root, 'main.cpp');
    const initial = { srcPath: source, tests: [{ id: 1, input: 'one', output: '' }] } as Problem;
    saveProblem(source, initial);
    const queued = JSON.parse(JSON.stringify(initial)) as Problem;
    const updated = { ...initial, tests: [...initial.tests, { id: 2, input: 'counterexample', output: '' }] };
    saveProblem(source, updated);
    expect(saveProblemFromWebview(queued)).toBe(false);
    expect(getProblem(source)?.tests).toHaveLength(2);
    updated.tests[0].input = 'new';
    expect(saveProblemFromWebview(updated)).toBe(true);
    updated.tests[0].input = 'newer';
    expect(saveProblemFromWebview(updated)).toBe(true);
    expect(getProblem(source)?.tests[0].input).toBe('newer');
});

test('autosave queued before deletion cannot resurrect the problem', () => {
    const source = path.join(root, 'main.cpp');
    const problem = { name: 'A', url: '', interactive: false, memoryLimit: 256, timeLimit: 1000, group: '', srcPath: source, tests: [] } as Problem;
    saveProblem(source, problem);
    removeProblem(source);
    expect(saveProblemFromWebview(problem)).toBe(false);
    expect(getProblem(source)).toBeNull();
});

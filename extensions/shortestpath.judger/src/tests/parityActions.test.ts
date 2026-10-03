import fs from 'fs';
import os from 'os';
import path from 'path';
jest.mock('vscode', () => ({
    workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback }) },
    window: { showQuickPick: jest.fn(), showOpenDialog: jest.fn(), showSaveDialog: jest.fn() },
    Uri: { file: (fsPath: string) => ({ fsPath }) }, commands: { executeCommand: jest.fn() },
}), { virtual: true });
jest.mock('../i18n', () => ({ __esModule: true, default: (_: string, value: string) => value }));
jest.mock('../preferences', () => ({ getSaveLocationPref: () => '', getCollectProblemsInRoot: () => false }));
import { testcaseAction } from '../testcaseActions';
import { copyProblem } from '../problemActions';
import { validateProblemDocument } from '../problemDocument';
import { getProblem, saveProblem } from '../parser';
import { expandAfterRun } from '../testcasePresentation';
import { Case, Problem } from '../types';
let root: string;
let problem: Problem;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-actions-'));
    problem = { name: 'A', srcPath: path.join(root, 'main.cpp'), url: '', timeLimit: 1000, memoryLimit: 512, tests: [{ id: 1, input: '1', output: '2' }] } as Problem;
    fs.writeFileSync(problem.srcPath, 'int main(){}');
    jest.clearAllMocks();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test('file-to-text rejects oversized data; small text and disabled state persist', async () => {
    const file = path.join(root, 'data.in'); fs.writeFileSync(file, 'x'.repeat(65537));
    problem.tests[0] = { id: 1, input: '', output: '', inputPath: file };
    await expect(testcaseAction(problem, 1, 'input', 'toggle')).rejects.toThrow('inline limit');
    fs.writeFileSync(file, 'small');
    problem.tests[0] = (await testcaseAction(problem, 1, 'input', 'toggle'))!.testcase;
    problem.tests[0] = (await testcaseAction(problem, 1, 'disable'))!.testcase;
    saveProblem(problem.srcPath, problem);
    expect(getProblem(problem.srcPath)?.tests[0]).toEqual({ id: 1, input: 'small', output: '', disabled: true });
});

test('setting file output as answer creates an independent snapshot', async () => {
    const output = path.join(root, 'run.out'); fs.writeFileSync(output, 'correct');
    const changed = await testcaseAction(problem, 1, 'answer', undefined, { id: 1, stdout: '', stdoutPath: output, stderr: '', pass: true, code: 0, signal: null, time: 1, timeOut: false });
    fs.writeFileSync(output, 'next run');
    expect(fs.readFileSync(changed!.testcase.outputPath!, 'utf8')).toBe('correct');
});

test('copy owns its samples and refuses collisions without overwriting', async () => {
    const input = path.join(root, 'input'); fs.writeFileSync(input, '123');
    problem.tests[0].inputPath = input;
    const target = path.join(root, 'copy.cpp');
    const copied = await copyProblem(problem, target);
    fs.writeFileSync(input, 'changed');
    expect(fs.readFileSync(copied.tests[0].inputPath!, 'utf8')).toBe('123');
    await expect(copyProblem(problem, target)).rejects.toThrow('already exists');
    expect(fs.readFileSync(target, 'utf8')).toBe('int main(){}');
});

test('raw editor rejects source redirects, duplicate IDs and invalid limits', () => {
    for (const value of [{ ...problem, srcPath: '/other.cpp' }, { ...problem, tests: [...problem.tests, ...problem.tests] }, { ...problem, timeLimit: -1 }, { ...problem, compilerArgs: [1] }, { ...problem, tests: [null] }, { ...problem, tests: [{ ...problem.tests[0], disabled: 'yes' }] }]) {
        expect(() => validateProblemDocument(JSON.stringify(value), problem)).toThrow();
    }
    expect(validateProblemDocument(JSON.stringify(problem), problem)).toEqual(problem);
});

test('expansion policy skips disabled cases and selects the first failure', () => {
    const cases = [{ id: 1, testcase: { disabled: true }, result: { pass: false } }, { id: 2, testcase: {}, result: { pass: true } }, { id: 3, testcase: {}, result: { pass: false } }, { id: 4, testcase: {}, result: { pass: false } }] as Case[];
    expect(cases.map(item => expandAfterRun('firstFailed', cases, item.id))).toEqual([undefined, false, true, false]);
    expect(expandAfterRun('same', cases, 3)).toBeUndefined();
});


test.each([undefined, 12000])('copying a problem starts a new timer and clears AC: %s', async accepted => {
    const original = { ...problem, timeStartedAtUnixMs: 10000, timeAcceptedAtUnixMs: accepted };
    const copy = await copyProblem(original, path.join(root, 'copy.cpp'));
    expect([copy.timeSpentMs, copy.timeAcceptedAtUnixMs, copy.timeStartedAtUnixMs! > 10000]).toEqual([0, undefined, true]);
});

import { persistImportedTests, persistTestcaseAction } from '../testcaseRepository';
import * as vscode from 'vscode';
test('host persists a picker action after another mutation without depending on the visible webview', async () => {
    saveProblem(problem.srcPath, problem);
    let finish: (value: unknown) => void = () => undefined;
    (vscode.window.showOpenDialog as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const action = persistTestcaseAction(problem.srcPath, 1, 'input', 'choose');
    const imported = persistImportedTests(problem.srcPath, [{ id: 1, input: 'new', output: '' }], false)!;
    const file = path.join(root, 'chosen.in'); fs.writeFileSync(file, 'chosen');
    finish([{ fsPath: file }]);
    await action;
    const stored = getProblem(problem.srcPath)!;
    expect(stored.tests).toHaveLength(2);
    expect(stored.tests[0].inputPath).toBe(file);
    expect(stored.tests[1]).toEqual(imported.tests[1]);
});

test('host imports deduplicate file references and allocate unique ids even without a webview', () => {
    saveProblem(problem.srcPath, problem);
    const test = { id: 1, input: '', output: '', inputPath: path.join(root, 'one.in') };
    persistImportedTests(problem.srcPath, [test, test], false);
    persistImportedTests(problem.srcPath, [test], false);
    expect(getProblem(problem.srcPath)?.tests).toHaveLength(2);
    const replaced = persistImportedTests(problem.srcPath, [test, { ...test, inputPath: 'two.in' }], true)!;
    expect(new Set(replaced.tests.map(test => test.id)).size).toBe(2);
    expect(getProblem(problem.srcPath)?.tests).toEqual(replaced.tests);
});

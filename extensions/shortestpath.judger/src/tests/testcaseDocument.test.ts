/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger. Licensed under GPL-3.0-or-later.
 *--------------------------------------------------------------------------------------------*/
let mockStored: import('../types').Problem;
let mockProvider: import('vscode').FileSystemProvider;
jest.mock('vscode', () => ({
    Uri: { from: (value: unknown) => value, file: (fsPath: string) => ({ fsPath }) },
    EventEmitter: class { event = () => {}; fire() {} }, Disposable: class {},
    FileType: { File: 1 }, FileChangeType: { Changed: 1 },
    FileSystemError: { FileNotFound: () => new Error('missing'), NoPermissions: () => new Error('file-backed') },
    workspace: { openTextDocument: jest.fn(async value => value), registerFileSystemProvider: (_: string, value: import('vscode').FileSystemProvider) => { mockProvider = value; return {}; } },
    window: { showTextDocument: jest.fn() }, ViewColumn: { Beside: 2 },
}), { virtual: true });
jest.mock('../parser', () => ({ getProblem: () => mockStored, saveProblem: (_: string, problem: import('../types').Problem) => { mockStored = problem; }, getProbSaveLocation: () => '/unused' }));
jest.mock('../i18n', () => ({ __esModule: true, default: (_: string, text: string) => text }));
import * as vscode from 'vscode';
import { registerProblemDocuments, testcaseDocumentUri } from '../problemDocument';
import { testcaseAction } from '../testcaseActions';
beforeEach(() => {
    mockStored = { srcPath: '/main.cpp', name: 'A', tests: [{ id: 3, input: '1\n', output: '2\n' }, { id: 7, input: '3', output: '4' }] } as import('../types').Problem;
    registerProblemDocuments({ subscriptions: [] } as unknown as vscode.ExtensionContext, () => {});
});
test('opening inline expected output keeps the testcase inline and saving merges the current problem', async () => {
    const original = structuredClone(mockStored);
    expect(await testcaseAction(mockStored, 3, 'output', 'open')).toBeUndefined();
    expect(mockStored).toEqual(original);
    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(testcaseDocumentUri('/main.cpp', 3, 'output'));
    const uri = testcaseDocumentUri('/main.cpp', 3, 'output');
    expect(Buffer.from(await mockProvider.readFile(uri)).toString()).toBe('2\n');
    mockStored.name = 'concurrent name'; mockStored.tests[1].input = 'changed input';
    await mockProvider.writeFile(uri, Buffer.from('answer\n'), { create: false, overwrite: true });
    expect(mockStored.tests[0]).toEqual({ id: 3, input: '1\n', output: 'answer\n' });
    expect(mockStored.name).toBe('concurrent name'); expect(mockStored.tests[1].input).toBe('changed input');
});
test('file-backed opening uses the original file and stale inline documents cannot overwrite file references', async () => {
    mockStored.tests[0].outputPath = '/answer.out';
    await testcaseAction(mockStored, 3, 'output', 'open');
    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith({ fsPath: '/answer.out' });
    expect(() => mockProvider.writeFile(testcaseDocumentUri('/main.cpp', 3, 'output'), Buffer.from('stale'), { create: false, overwrite: true })).toThrow('file-backed');
    mockStored.tests = [];
    expect(() => mockProvider.readFile(testcaseDocumentUri('/main.cpp', 3, 'output'))).toThrow('missing');
});

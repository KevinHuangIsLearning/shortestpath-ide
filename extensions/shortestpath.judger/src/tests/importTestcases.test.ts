jest.mock('../preferences', () => ({ getSaveLocationPref: () => '', getCollectProblemsInRoot: () => false }));
jest.mock('vscode', () => ({
	Uri: { file: (fsPath: string) => ({ scheme: 'file', fsPath }) },
	workspace: { getWorkspaceFolder: () => undefined, getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
	window: { showQuickPick: jest.fn(async values => values), showWarningMessage: jest.fn(), showOpenDialog: jest.fn() },
}), { virtual: true });
jest.mock('../i18n', () => ({ __esModule: true, default: (_key: string, text: string) => text }));
import fs from 'fs';
import AdmZip from 'adm-zip';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import { importTestcases, importTestcasesWithPicker } from '../importTestcases';
import { getProblemDirectory } from '../parser';
import { stageDroppedTestcases } from '../droppedTestcases';

test('pathless plain text files retain single-file import semantics', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-import-test-'));
	try {
		const directory = stageDroppedTestcases(root, [{ name: 'sample.txt', base64: Buffer.from('1 2\n').toString('base64') }]);
		expect(await importTestcases('/solution.cpp', path.join(directory, 'sample.txt'), true)).toEqual([{ id: 0, input: '', output: '', inputPath: path.join(directory, 'sample.txt') }]);
	} finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('directory import recurses into a dropped folder with ordinary numeric testcase names', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-import-test-'));
	try {
		const directory = stageDroppedTestcases(root, [{ name: 'folder/1.in', base64: 'MQ==' }, { name: 'folder/1.out', base64: 'Mg==' }]);
		expect(await importTestcases('/solution.cpp', directory, true)).toEqual([{ id: 0, input: '', output: '', inputPath: path.join(directory, 'folder/1.in'), outputPath: path.join(directory, 'folder/1.out') }]);
		(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([]);
		await importTestcases('/solution.cpp', undefined, false, true);
		expect(vscode.window.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({ canSelectFiles: false, canSelectFolders: true }));
	} finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test('importing the same ZIP twice reads the newly selected extraction directory', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-repeat-zip-'));
	try {
		const archive = new AdmZip();
		const file = path.join(root, 'sample-data.zip');
		archive.addFile('1.in', Buffer.from('first'));
		archive.addFile('1.out', Buffer.from('answer'));
		archive.writeZip(file);
		const source = path.join(root, 'main.cpp');
		expect(fs.readFileSync((await importTestcases(source, file))[0].inputPath!, 'utf8')).toBe('first');
		archive.updateFile('1.in', Buffer.from('second'));
		archive.writeZip(file);
		expect(fs.readFileSync((await importTestcases(source, file))[0].inputPath!, 'utf8')).toBe('second');
		expect(fs.readFileSync(path.join(getProblemDirectory(source), 'testcases/sample-data/1.in'), 'utf8')).toBe('first');
		expect(fs.existsSync(path.join(getProblemDirectory(source), 'testcases/sample-data-2/1.in'))).toBe(true);
	} finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test.each(['zip', 'file', 'folder'])('import method picker opens the matching %s file dialog', async source => {
	(vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce({ source });
	(vscode.window.showOpenDialog as jest.Mock).mockResolvedValueOnce([]);
	await importTestcasesWithPicker('/solution.cpp');
	expect(vscode.window.showOpenDialog).toHaveBeenLastCalledWith(expect.objectContaining({
		canSelectFolders: source === 'folder',
		canSelectFiles: source !== 'folder',
		filters: source === 'folder' ? undefined : source === 'zip' ? { ZIP: ['zip'] } : { Data: ['in', 'out', 'ans', 'txt'] },
	}));
});

test('cancelling the method picker does not open a file dialog', async () => {
	(vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce(undefined);
	const calls = (vscode.window.showOpenDialog as jest.Mock).mock.calls.length;
	expect(await importTestcasesWithPicker('/solution.cpp')).toEqual([]);
	expect(vscode.window.showOpenDialog).toHaveBeenCalledTimes(calls);
});


test('JSON picker choice opens the existing JSON flow without a file dialog', async () => {
	(vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce({ source: 'json' });
	const calls = (vscode.window.showOpenDialog as jest.Mock).mock.calls.length;
	expect(await importTestcasesWithPicker('/solution.cpp')).toBe('json');
	expect(vscode.window.showOpenDialog).toHaveBeenCalledTimes(calls);
});


test('large ZIP import returns only file references, survives save and reload without inlining', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-big-zip-'));
    try {
        const text = '12345678\n'.repeat(1024 * 1024);
        const archive = new AdmZip();
        archive.addFile('1.in', Buffer.from(text));
        archive.addFile('1.out', Buffer.from(text));
        const zip = path.join(root, 'big.zip');
        archive.writeZip(zip);
        const source = path.join(root, 'main.cpp');
        const tests = await importTestcases(source, zip);
        expect(JSON.stringify(tests).length).toBeLessThan(1024);
        const { writeStoredProblem, readStoredProblem } = await import('../problemStorage');
        const stored = path.join(root, 'data.prob');
        writeStoredProblem(stored, { tests } as import('../types').Problem);
        const restored = readStoredProblem(stored)!.tests;
        expect(restored).toEqual(tests);
        expect(fs.readFileSync(restored[0].inputPath!, 'utf8')).toBe(text);
        expect(fs.readFileSync(restored[0].outputPath!, 'utf8')).toBe(text);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test('identical ZIP bytes dropped from a different staging path reuse the same problem-owned extraction', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-hash-'));
    try {
        const archive = new AdmZip(); archive.addFile('1.in', Buffer.from('input')); archive.addFile('1.out', Buffer.from('answer'));
        const bytes = archive.toBuffer().toString('base64');
        const source = path.join(root, 'main.cpp');
        const first = stageDroppedTestcases(root, [{ name: 'sample.zip', base64: bytes }]);
        const second = stageDroppedTestcases(root, [{ name: 'sample.zip', base64: bytes }]);
        const tests = await importTestcases(source, path.join(first, 'sample.zip'));
        const next = await importTestcases(source, path.join(second, 'sample.zip'));
        expect(next).toEqual(tests);
        expect(path.relative(getProblemDirectory(source), tests[0].inputPath!)).toBe('testcases/sample/1.in');
        expect(fs.readdirSync(path.join(getProblemDirectory(source), 'testcases'))).toEqual(['sample']);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

 describe('cancelled ZIP imports', () => {
    let root: string;
    let source: string;
    let file: string;
    let archive: AdmZip;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-cancel-zip-'));
        source = path.join(root, 'main.cpp');
        file = path.join(root, 'sample.zip');
        archive = new AdmZip();
        archive.addFile('1.in', Buffer.from('input'));
        archive.addFile('1.out', Buffer.from('answer'));
        archive.writeZip(file);
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
    test.each([undefined, []])('cancel or empty selection removes new extraction and empty parents (%p)', async selection => {
        archive.updateFile('1.in', Buffer.alloc(8 * 1024 * 1024, 'x'));
        archive.writeZip(file);
        const before = fs.readdirSync(root);
        (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce(selection);
        expect(await importTestcases(source, file)).toEqual([]);
        expect(fs.readdirSync(root)).toEqual(before);
        expect(fs.existsSync(file)).toBe(true);
    });
    test('picker failure rolls back new files', async () => {
        const before = fs.readdirSync(root);
        (vscode.window.showQuickPick as jest.Mock).mockRejectedValueOnce(new Error('picker failed'));
        await expect(importTestcases(source, file)).rejects.toThrow('picker failed');
        expect(fs.readdirSync(root)).toEqual(before);
    });
    test('cancellation preserves reused extraction and manually edited testcase', async () => {
        const previous = await importTestcases(source, file);
        fs.writeFileSync(previous[0].inputPath!, 'manual edit');
        (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce(undefined);
        expect(await importTestcases(source, file)).toEqual([]);
        expect(fs.readFileSync(previous[0].inputPath!, 'utf8')).toBe('manual edit');
        expect(fs.readdirSync(path.dirname(path.dirname(previous[0].inputPath!)))).toEqual(['sample']);
    });
    test('cancelling changed ZIP removes only its new sibling directory', async () => {
        const previous = await importTestcases(source, file);
        archive.updateFile('1.in', Buffer.from('changed'));
        archive.writeZip(file);
        (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce(undefined);
        expect(await importTestcases(source, file)).toEqual([]);
        expect(fs.readFileSync(previous[0].inputPath!, 'utf8')).toBe('input');
        expect(fs.existsSync(path.join(path.dirname(path.dirname(previous[0].inputPath!)), 'sample-2'))).toBe(false);
    });
    test('ZIP with no testcases leaves no extraction or parent directories', async () => {
        archive = new AdmZip();
        archive.addFile('README.txt', Buffer.from('no testcase'));
        archive.writeZip(file);
        const before = fs.readdirSync(root);
        expect(await importTestcases(source, file)).toEqual([]);
        expect(fs.readdirSync(root)).toEqual(before);
    });
    test('invalid ZIP removes any new empty parent directories', async () => {
        fs.writeFileSync(file, 'invalid zip');
        const before = fs.readdirSync(root);
        await expect(importTestcases(source, file)).rejects.toThrow();
        expect(fs.readdirSync(root)).toEqual(before);
    });
    test('unrelated files created while selecting keep their parent directory', async () => {
        const parent = path.join(getProblemDirectory(source), 'testcases');
        (vscode.window.showQuickPick as jest.Mock).mockImplementationOnce(async () => {
            fs.writeFileSync(path.join(parent, 'keep.txt'), 'keep');
            return undefined;
        });
        expect(await importTestcases(source, file)).toEqual([]);
        expect(fs.readdirSync(parent)).toEqual(['keep.txt']);
    });
    test.each([true, false])('overlapping imports serialize cancel and confirm safely (first cancels=%p)', async firstCancels => {
        let resolveFirst!: (value: unknown) => void;
        let firstItems: unknown;
        const picker = vscode.window.showQuickPick as jest.Mock;
        const calls = picker.mock.calls.length;
        picker.mockImplementationOnce(items => { firstItems = items; return new Promise(resolve => { resolveFirst = resolve; }); });
        const first = importTestcases(source, file);
        await new Promise(resolve => setImmediate(resolve));
        const second = importTestcases(source, file);
        picker.mockImplementationOnce(async items => firstCancels ? items : undefined);
        await new Promise(resolve => setImmediate(resolve));
        expect(picker.mock.calls.length).toBe(calls + 1);
        resolveFirst(firstCancels ? undefined : firstItems);
        const results = await Promise.all([first, second]);
        const imported = results[firstCancels ? 1 : 0];
        expect(results[firstCancels ? 0 : 1]).toEqual([]);
        expect(fs.readFileSync(imported[0].inputPath!, 'utf8')).toBe('input');
        expect(fs.readFileSync(imported[0].outputPath!, 'utf8')).toBe('answer');
        expect(fs.readdirSync(path.dirname(path.dirname(imported[0].inputPath!)))).toEqual(['sample']);
    });

});

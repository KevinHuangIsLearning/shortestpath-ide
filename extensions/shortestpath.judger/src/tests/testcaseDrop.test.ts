import fs from 'fs';
import os from 'os';
import path from 'path';
import { droppedPaths, droppedContents, claimTestcaseDrag } from '../webview/frontend/testcaseDrop';
import { stageDroppedTestcases } from '../droppedTestcases';

function transfer(data: Record<string, string> = {}, files: unknown[] = [], items: unknown[] = []): DataTransfer {
	return { getData: (key: string) => data[key] || '', files, items } as unknown as DataTransfer;
}

test('extracts workbench resources, URI lists and native paths without treating arbitrary text as a path', () => {
	expect(droppedPaths(transfer({ ResourceURLs: JSON.stringify(['file:///tmp/1.in', 'file:///tmp/1.out']) }))).toHaveLength(2);
	expect(droppedPaths(transfer({ CodeFiles: JSON.stringify(['/tmp/data.zip']) }))).toEqual(['/tmp/data.zip']);
	expect(droppedPaths(transfer({ 'text/uri-list': '#comment\r\nfile:///tmp/a.zip\r\n' }))).toEqual(['file:///tmp/a.zip']);
	expect(droppedPaths(transfer({}, [{ path: '/tmp/native.zip' }]))).toEqual(['/tmp/native.zip']);
	expect(droppedPaths(transfer({ 'text/plain': 'program text' }))).toEqual([]);
});

test('reads pathless directory entries across every readEntries batch', async () => {
	const OriginalReader = globalThis.FileReader;
	globalThis.FileReader = class {
		result = 'data:application/octet-stream;base64,YWJj';
		onload?: () => void;
		readAsDataURL() { this.onload?.(); }
	} as unknown as typeof FileReader;
	try {
		const file = (name: string) => ({ name, isFile: true, file: (resolve: (value: unknown) => void) => resolve({ name, size: 3 }) });
		const batches = [[file('1.in')], [file('1.out')], []];
		const entry = { name: 'cases', isDirectory: true, createReader: () => ({ readEntries: (resolve: (value: unknown) => void) => resolve(batches.shift()) }) };
		const result = await droppedContents(transfer({}, [], [{ webkitGetAsEntry: () => entry }]));
		expect(result).toEqual({ folder: true, files: [{ name: 'cases/1.in', base64: 'YWJj' }, { name: 'cases/1.out', base64: 'YWJj' }] });
	} finally { globalThis.FileReader = OriginalReader; }
});

describe('staging dropped contents', () => {
	let root: string;
	beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-drop-test-')); });
	afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });
	test('preserves binary zip bytes and nested files, including large base64 payloads', () => {
		const data = Buffer.alloc(8 * 1024 * 1024, 42);
		const directory = stageDroppedTestcases(root, [{ name: 'data.zip', base64: data.toString('base64') }, { name: 'nested/1.in', base64: 'YWJj' }]);
		expect(fs.readFileSync(path.join(directory, 'data.zip')).equals(data)).toBe(true);
		expect(fs.readFileSync(path.join(directory, 'nested/1.in'), 'utf8')).toBe('abc');
	});
	test.each(['../escape', '/absolute', 'a/../escape', 'C:/escape', 'a\\escape'])('rejects untrusted path %s before staging', name => {
		expect(() => stageDroppedTestcases(root, [{ name, base64: 'YWJj' }])).toThrow();
		expect(fs.readdirSync(root)).toEqual([]);
	});
	test('rejects case-colliding paths and invalid base64', () => {
		expect(() => stageDroppedTestcases(root, [{ name: 'a.in', base64: '' }, { name: 'A.in', base64: '' }])).toThrow();
		expect(() => stageDroppedTestcases(root, [{ name: 'a.in', base64: '???=' }])).toThrow();
	});
});


test('claims dragenter before the Webview host can disable iframe pointer events', () => {
	let defaultPrevented = false, propagated = true;
	const dataTransfer = { dropEffect: 'none' } as DataTransfer;
	claimTestcaseDrag({ dataTransfer, preventDefault: () => { defaultPrevented = true; }, stopPropagation: () => { propagated = false; } });
	// pre/index.html forwards unclaimed file dragenter events as drag-start.
	const hostWouldForwardDragStart = !defaultPrevented;
	expect(hostWouldForwardDragStart).toBe(false);
	expect(propagated).toBe(false);
	expect(dataTransfer.dropEffect).toBe('copy');
	const app = fs.readFileSync(path.resolve(__dirname, '../../src/webview/frontend/App.tsx'), 'utf8');
	expect(app).toContain('onDragEnter={claimTestcaseDrag}');
	expect(app).toContain('onDragOver={claimTestcaseDrag}');
});

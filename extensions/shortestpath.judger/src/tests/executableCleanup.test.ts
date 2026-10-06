/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger. Licensed under GPL-3.0-or-later.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
const mockSettings: Record<string, unknown> = {};
jest.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: (key: string, fallback: unknown) => mockSettings[key] ?? fallback }) }, Uri: { file: (fsPath: string) => ({ fsPath }) } }), { virtual: true });
import { retainExecutable } from '../executableCleanup';
let root: string;
let binary: string;
beforeEach(() => { jest.useFakeTimers(); root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-cleanup-')); binary = path.join(root, 'solution.bin'); fs.writeFileSync(binary, 'old'); mockSettings.executableCleanupEnabled = true; mockSettings.executableCleanupDelaySeconds = 2; });
afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); fs.rmSync(root, { recursive: true, force: true }); });
test('retains the binary until the complete run ends, then honors the delay', () => {
    const first = retainExecutable(binary, '/solution.cpp');
    const second = retainExecutable(binary, '/solution.cpp');
    first.dispose(); jest.advanceTimersByTime(3000); expect(fs.existsSync(binary)).toBe(true);
    second.dispose(); jest.advanceTimersByTime(1999); expect(fs.existsSync(binary)).toBe(true);
    jest.advanceTimersByTime(1); expect(fs.existsSync(binary)).toBe(false);
});
test('a new run cancels the old timer even when compilation reuses the binary', () => {
    retainExecutable(binary, '/solution.cpp').dispose(); jest.advanceTimersByTime(1500);
    const next = retainExecutable(binary, '/solution.cpp'); jest.advanceTimersByTime(1000); expect(fs.existsSync(binary)).toBe(true);
    next.dispose(); jest.advanceTimersByTime(2000); expect(fs.existsSync(binary)).toBe(false);
});
test('does not delete an externally recompiled binary or an interpreted source', () => {
    retainExecutable(binary, '/solution.cpp').dispose(); fs.writeFileSync(binary, 'different binary'); jest.advanceTimersByTime(2000); expect(fs.existsSync(binary)).toBe(true);
    retainExecutable(binary, binary).dispose(); jest.runOnlyPendingTimers(); expect(fs.existsSync(binary)).toBe(true);
});
test('zero cleans immediately after release and disabled cleanup keeps artifacts', () => {
    mockSettings.executableCleanupDelaySeconds = 0; const held = retainExecutable(binary, '/solution.cpp'); jest.runOnlyPendingTimers(); expect(fs.existsSync(binary)).toBe(true);
    held.dispose(); jest.advanceTimersByTime(0); expect(fs.existsSync(binary)).toBe(false);
    fs.writeFileSync(binary, 'new'); mockSettings.executableCleanupEnabled = false; retainExecutable(binary, '/solution.cpp').dispose(); jest.runOnlyPendingTimers(); expect(fs.existsSync(binary)).toBe(true);
});
test('disabling cleanup while a timer is pending preserves the binary', () => {
    retainExecutable(binary, '/solution.cpp').dispose(); mockSettings.executableCleanupEnabled = false; jest.advanceTimersByTime(2000); expect(fs.existsSync(binary)).toBe(true);
});

function createManagedBinary(source: string): string {
	const directory = path.join(root, 'bin', crypto.createHash('sha256').update(source).digest('hex').slice(0, 16));
	fs.mkdirSync(directory, { recursive: true });
	const generated = path.join(directory, 'solution.bin');
	fs.writeFileSync(generated, 'binary');
	return generated;
}

test('removes the empty source directory and bin after cleaning executable and debug symbols', () => {
	const generated = createManagedBinary('/solution.cpp');
	fs.mkdirSync(`${generated}.dSYM`);
	fs.writeFileSync(path.join(`${generated}.dSYM`, 'symbols'), 'debug');
	retainExecutable(generated, '/solution.cpp').dispose();
	jest.advanceTimersByTime(2000);
	expect([fs.existsSync(path.join(root, 'bin')), fs.existsSync(root)]).toEqual([false, true]);
});

test('keeps bin while another source is running and removes it after the last cleanup', () => {
	const first = createManagedBinary('/first.cpp');
	const second = createManagedBinary('/second.cpp');
	const held = retainExecutable(second, '/second.cpp');
	retainExecutable(first, '/first.cpp').dispose();
	jest.advanceTimersByTime(2000);
	expect([fs.existsSync(path.dirname(first)), fs.existsSync(second)]).toEqual([false, true]);
	held.dispose();
	jest.advanceTimersByTime(2000);
	expect(fs.existsSync(path.join(root, 'bin'))).toBe(false);
});

test('preserves nonempty source directories and custom output directories', () => {
	const generated = createManagedBinary('/solution.cpp');
	const extra = path.join(path.dirname(generated), 'keep.txt');
	fs.writeFileSync(extra, 'keep');
	retainExecutable(generated, '/solution.cpp').dispose();
	retainExecutable(binary, '/custom.cpp').dispose();
	jest.advanceTimersByTime(2000);
	expect([fs.existsSync(generated), fs.existsSync(extra), fs.existsSync(root)]).toEqual([false, true, true]);
});

test('cleans empty managed directories when the binary has already been removed', () => {
	const generated = createManagedBinary('/solution.cpp');
	retainExecutable(generated, '/solution.cpp').dispose();
	fs.unlinkSync(generated);
	jest.advanceTimersByTime(2000);
	expect(fs.existsSync(path.join(root, 'bin'))).toBe(false);
});

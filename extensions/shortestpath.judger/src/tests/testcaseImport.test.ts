/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { extractTestcaseZip, scanTestcases } from '../testcaseImport';

describe('ZIP testcase import', () => {
	let folder: string;
	beforeEach(() => {
		folder = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-import-'));
	});
	afterEach(() => {
		fs.rmSync(folder, { recursive: true, force: true });
	});
	test('recurses, naturally sorts, pairs within folders and retains orphan answers', () => {
		const zip = new AdmZip();
		for (const name of [
			'a/10.in',
			'a/10.ans',
			'a/2.in',
			'a/2.out',
			'b/2.ans',
		]) {
			zip.addFile(name, Buffer.from(name));
		}
		const file = path.join(folder, 'tests.zip');
		zip.writeZip(file);
		const target = path.join(folder, 'tests');
		extractTestcaseZip(file, target);
		expect(
			scanTestcases(target).map((pair) => ({
				name: pair.name,
				input: !!pair.input,
				output: !!pair.output,
			})),
		).toEqual([
			{ name: 'a/2', input: true, output: true },
			{ name: 'a/10', input: true, output: true },
			{ name: 'b/2.ans', input: false, output: true },
		]);
		expect(extractTestcaseZip(file, target)).toBe(target);
		expect(fs.existsSync(`${target}-2`)).toBe(false);
	});
	test('repeated imports preserve existing folders, files and manually edited data', () => {
		const archive = new AdmZip();
		archive.addFile('1.in', Buffer.from('new input'));
		archive.addFile('1.out', Buffer.from('new answer'));
		const file = path.join(folder, 'sample-data.zip');
		archive.writeZip(file);
		const target = path.join(folder, 'sample-data');
		expect(extractTestcaseZip(file, target)).toBe(target);
		fs.writeFileSync(path.join(target, '1.in'), 'manual edit');
		fs.writeFileSync(`${target}-2`, 'unrelated file');
		const next = extractTestcaseZip(file, target);
		expect(next).toBe(target);
		expect(fs.readFileSync(path.join(target, '1.in'), 'utf8')).toBe('manual edit');
		expect(fs.readFileSync(`${target}-2`, 'utf8')).toBe('unrelated file');
		expect(fs.readFileSync(path.join(next, '1.in'), 'utf8')).toBe('manual edit');
		expect(scanTestcases(next)).toHaveLength(1);
	});
	test('rejects symlinks before creating the destination', () => {
		const zip = new AdmZip();
		zip.addFile('escape', Buffer.from('../outside'));
		zip.getEntry('escape')!.attr = (0xa1ff << 16) >>> 0;
		const file = path.join(folder, 'tests.zip');
		zip.writeZip(file);
		const target = path.join(folder, 'tests');
		expect(() => extractTestcaseZip(file, target)).toThrow('Unsafe');
		expect(fs.existsSync(target)).toBe(false);
	});
});

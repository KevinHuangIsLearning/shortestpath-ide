/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	readStoredProblem,
	writeStoredProblem,
	removeStoredProblem,
} from '../problemStorage';
import { Problem } from '../types';

describe('versioned problem storage', () => {
	let folder: string;
	beforeEach(() => {
		folder = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-storage-'));
	});
	afterEach(() => {
		fs.rmSync(folder, { recursive: true, force: true });
	});
	const problem: Problem = {
		name: '题目',
		url: '',
		srcPath: '/example.cpp',
		interactive: false,
		memoryLimit: 256,
		timeLimit: 1000,
		group: '',
		tests: [{ id: 9, input: 'a\r\n', output: '中\n' }],
	};
	test('reads legacy, publishes split files, preserves original backup and exact text', () => {
		const file = path.join(folder, 'old.prob');
		fs.writeFileSync(file, JSON.stringify(problem));
		expect(readStoredProblem(file)).toEqual(problem);
		const changed = { ...problem, name: 'new' };
		writeStoredProblem(file, changed);
		expect([
			readStoredProblem(file),
			JSON.parse(fs.readFileSync(file, 'utf8')),
		]).toEqual([changed, problem]);
		const manifest = JSON.parse(
			fs.readFileSync(`${file}.judger/problem.json`, 'utf8'),
		);
		expect(
			fs.readFileSync(
				path.join(`${file}.judger`, manifest.generation, '0.in'),
				'utf8',
			),
		).toBe('a\r\n');
	});
    test('preserves official sample identity and file-backed data after publication and reloading', () => {
        const file = path.join(folder, 'sample.prob');
        const text = 'a'.repeat(70000);
        writeStoredProblem(file, { ...problem, shortestPath: true, tests: [{ id: 1, origin: 'sample', sampleIndex: 0, input: text, output: text }, { id: 2, origin: 'custom', input: text, output: text }] });
        const restored = readStoredProblem(file)!;
        expect(restored.tests.map(test => [test.origin, test.sampleIndex])).toEqual([['sample', 0], ['custom', undefined]]);
        expect(restored.shortestPath).toBe(true);
        expect(restored.tests.every(test => fs.readFileSync(test.inputPath!, 'utf8') === text && fs.readFileSync(test.outputPath!, 'utf8') === text)).toBe(true);
    });
	test('rejects future versions and missing test files instead of silently restoring stale data', () => {
		const file = path.join(folder, 'old.prob');
		writeStoredProblem(file, problem);
		const manifestPath = `${file}.judger/problem.json`;
		const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
		fs.unlinkSync(path.join(`${file}.judger`, manifest.generation, '0.in'));
		expect(() => readStoredProblem(file)).toThrow();
		fs.writeFileSync(
			manifestPath,
			JSON.stringify({ ...manifest, version: 2 }),
		);
		expect(() => readStoredProblem(file)).toThrow('Unsupported');
	});
	test('deleting removes legacy and current data and repeated deletion is safe', () => {
		const file = path.join(folder, 'old.prob');
		fs.writeFileSync(file, JSON.stringify(problem));
		writeStoredProblem(file, problem);
		removeStoredProblem(file);
		removeStoredProblem(file);
		expect(readStoredProblem(file)).toBeNull();
	});
});

import { spawn } from 'child_process';
test('simultaneous extension hosts never publish a manifest pointing to reclaimed test files', async () => {
	const directory = fs.mkdtempSync(
		path.join(os.tmpdir(), 'judger-concurrent-'),
	);
	const file = path.join(directory, 'problem.prob');
	const modulePath = path.resolve(__dirname, '../problemStorage.js');
	try {
		await Promise.all(
			Array.from(
				{ length: 4 },
				(_, worker) =>
					new Promise<void>((resolve, reject) => {
						const program = `const {writeStoredProblem,readStoredProblem}=require(${JSON.stringify(
							modulePath,
						)}); for(let i=0;i<50;i++){ const value=${worker}+':'+i; writeStoredProblem(${JSON.stringify(
							file,
						)}, {name:value,tests:[{id:1,input:value,output:value}]}); const actual=readStoredProblem(${JSON.stringify(
							file,
						)}); if(actual.name!==actual.tests[0].input || actual.name!==actual.tests[0].output) throw Error('torn snapshot'); }`;
						const child = spawn(process.execPath, ['-e', program]);
						let errors = '';
						child.stderr.on('data', (data) => {
							errors += data;
						});
						child.on('error', reject);
						child.on('close', (code) =>
							code === 0 ? resolve() : reject(new Error(errors)),
						);
					}),
			),
		);
		expect(readStoredProblem(file)?.tests).toHaveLength(1);
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
}, 20000);

test('concurrent large-text migration publishes complete immutable files', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-large-concurrent-'));
    const file = path.join(directory, 'problem.prob');
    const modulePath = path.resolve(__dirname, '../problemStorage.js');
    try {
        await Promise.all(Array.from({ length: 4 }, () => new Promise<void>((resolve, reject) => {
            const program = `const fs=require('fs');const {writeStoredProblem,readStoredProblem}=require(${JSON.stringify(modulePath)});const text='a'.repeat(8*1024*1024);for(let i=0;i<4;i++){writeStoredProblem(${JSON.stringify(file)},{tests:[{id:1,input:text,output:''}]});const test=readStoredProblem(${JSON.stringify(file)}).tests[0];if(fs.readFileSync(test.inputPath,'utf8')!==text)throw Error('incomplete large file');}`;
            const child = spawn(process.execPath, ['-e', program]);
            let errors = '';
            child.stderr.on('data', data => { errors += data; });
            child.on('error', reject);
            child.on('close', code => code === 0 ? resolve() : reject(new Error(errors)));
        })));
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}, 20000);

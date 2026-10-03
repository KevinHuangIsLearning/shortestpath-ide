/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Problem } from './types';

type StoredProblem = {
	version: 1;
	generation: string;
	problem: Omit<Problem, 'tests'>;
	tests: { disabled?: boolean; id: number; input: string; output: string; inputPath?: string; outputPath?: string }[];
};

const MAX_INLINE_BYTES = 65536;

function storeLargeText(directory: string, text: string, suffix: string): string {
    const file = path.join(directory, 'files', `${crypto.createHash('sha256').update(text).digest('hex')}.${suffix}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) {
        const temporary = `${file}.${crypto.randomBytes(16).toString('hex')}.tmp`;
        try {
            fs.writeFileSync(temporary, text, 'utf8');
            fs.renameSync(temporary, file);
        } finally { fs.rmSync(temporary, { force: true }); }
    }
    return file;
}

/** The original .prob stays untouched as a migration backup. */
export function readStoredProblem(legacyPath: string): Problem | null {
	const directory = `${legacyPath}.judger`;
	const manifest = path.join(directory, 'problem.json');
	if (!fs.existsSync(manifest)) {
		if (!fs.existsSync(legacyPath)) {
			return null;
		}
		const legacy = JSON.parse(
			fs.readFileSync(legacyPath, 'utf8'),
		) as Problem;
		if (!Array.isArray(legacy.tests)) {
			throw new Error('Invalid legacy problem data');
		}
		return legacy;
	}
	for (;;) {
		const contents = fs.readFileSync(manifest, 'utf8');
		try {
			const stored = JSON.parse(contents) as StoredProblem;
			if (
				stored.version !== 1 ||
				!/^[a-f0-9]{32}$/.test(stored.generation) ||
				!Array.isArray(stored.tests)
			) {
				throw new Error('Unsupported or invalid Judger problem data');
			}
			const read = (file: string) => {
				if (!/^\d+\.(in|out)$/.test(file)) {
					throw new Error('Invalid testcase path');
				}
				return fs.readFileSync(
					path.join(directory, stored.generation, file),
					'utf8',
				);
			};
			return {
				...stored.problem,
				tests: stored.tests.map(test => {
                    const input = test.inputPath ? '' : read(test.input);
                    const output = test.outputPath ? '' : read(test.output);
                    const inputPath = test.inputPath || (Buffer.byteLength(input) > MAX_INLINE_BYTES ? storeLargeText(directory, input, 'in') : undefined);
                    const outputPath = test.outputPath || (Buffer.byteLength(output) > MAX_INLINE_BYTES ? storeLargeText(directory, output, 'out') : undefined);
                    return { id: test.id, ...(test.disabled !== undefined ? { disabled: test.disabled } : {}), input: inputPath ? '' : input, output: outputPath ? '' : output,
                        ...(inputPath ? { inputPath } : {}), ...(outputPath ? { outputPath } : {}) };
                }),
			};
		} catch (error) {
			if (fs.readFileSync(manifest, 'utf8') === contents) {
				throw error;
			}
			// Another window published and reclaimed the snapshot during this read.
		}
	}
}

/** Publish the manifest only after all files are written; an interrupted save keeps the old snapshot. */
export function writeStoredProblem(legacyPath: string, problem: Problem): void {
	const directory = `${legacyPath}.judger`;
	const manifestPath = path.join(directory, 'problem.json');
	const previous = fs.existsSync(manifestPath)
		? (JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as StoredProblem)
		: undefined;
	if (
		previous &&
		(previous.version !== 1 || !/^[a-f0-9]{32}$/.test(previous.generation))
	) {
		throw new Error('Unsupported or invalid Judger problem data');
	}
	const generation = crypto.randomBytes(16).toString('hex');
	const snapshot = path.join(directory, generation);
	fs.mkdirSync(snapshot, { recursive: true });
	const { tests, ...metadata } = problem;
	const manifest: StoredProblem = {
		version: 1,
		generation,
		problem: metadata,
		tests: [],
	};
	let published = false;
	const temporaryManifest = path.join(directory, `${generation}.json`);
	try {
		for (const [index, source] of tests.entries()) {
            const test = { ...source };
            if (!test.inputPath && Buffer.byteLength(test.input) > MAX_INLINE_BYTES) { test.inputPath = storeLargeText(directory, test.input, 'in'); }
            if (!test.outputPath && Buffer.byteLength(test.output) > MAX_INLINE_BYTES) { test.outputPath = storeLargeText(directory, test.output, 'out'); }
			const input = `${index}.in`,
				output = `${index}.out`;
			if (!test.inputPath) { fs.writeFileSync(path.join(snapshot, input), test.input, 'utf8'); }
			if (!test.outputPath) { fs.writeFileSync(path.join(snapshot, output), test.output, 'utf8'); }
			manifest.tests.push({ id: test.id, disabled: test.disabled, input, output, inputPath: test.inputPath, outputPath: test.outputPath });
		}
		fs.writeFileSync(
			temporaryManifest,
			JSON.stringify(manifest, null, '\t'),
			'utf8',
		);
		fs.renameSync(temporaryManifest, path.join(directory, 'problem.json'));
		published = true;
	} finally {
		if (!published) {
			fs.rmSync(snapshot, { recursive: true, force: true });
			fs.rmSync(temporaryManifest, { force: true });
		}
	}
	// Reclaim only the previously published snapshot. Other directories can belong
	// to another window's in-flight save and must never be swept here.
	if (previous) {
		try {
			fs.rmSync(path.join(directory, previous.generation), {
				recursive: true,
				force: true,
			});
		} catch {
			/* retained for recovery */
		}
	}
}

export function removeStoredProblem(legacyPath: string): void {
	fs.rmSync(`${legacyPath}.judger`, { recursive: true, force: true });
	fs.rmSync(legacyPath, { force: true });
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { randomUUID } from 'crypto';
import { getWorkspaceProblemRecordFileName } from './workspaceProblemCache';

export interface ProblemRecordFileSystem {
	readDirectory(directory: string): Promise<[string, number][]>;
	readFile(file: string): Promise<Uint8Array>;
	writeFile(file: string, contents: Uint8Array): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	delete(file: string): Promise<void>;
	isMissing(error: unknown): boolean;
}

export type ProblemRecordLocation = { name: string; file: string; legacy: boolean };
export type ProblemRecordIndexEntry = { problemRef: string; path: string };

export function getOwnedProblemRecordPath(root: string, problemRef: string, problemDirectory?: string): string {
	const name = getWorkspaceProblemRecordFileName(problemRef);
	return path.join(problemDirectory ?? path.join(root, name.slice(0, -5)), `oj-${name}`);
}

/** Discover old flat records, or follow the published index, including custom Judger directories. */
export async function listProblemRecords(root: string, fileSystem: ProblemRecordFileSystem): Promise<ProblemRecordLocation[]> {
	const entries = await fileSystem.readDirectory(root);
	const legacy = entries.filter(([name, type]) => type === 1 && name !== 'oj-problems.json' && name !== 'oj-index.json' && name.endsWith('.json'))
		.map(([name]) => ({ name, file: path.join(root, name), legacy: true }));
	try {
		const index: unknown = JSON.parse(new TextDecoder().decode(await fileSystem.readFile(path.join(root, 'oj-index.json'))));
		if (!Array.isArray(index) || !index.every(isIndexEntry)) { throw new Error('Invalid ShortestPath OJ record index'); }
		const migrated = new Set<string>();
		for (const entry of index) {
			try {
				const record = JSON.parse(new TextDecoder().decode(await fileSystem.readFile(path.resolve(root, entry.path))));
				if ((record.version === 1 || record.version === 2) && record.problem?.ref === entry.problemRef) { migrated.add(getWorkspaceProblemRecordFileName(entry.problemRef)); }
			} catch { /* Keep the flat source available when an indexed record cannot be read. */ }
		}
		return [...legacy.filter(record => !migrated.has(record.name)), ...index.map(entry => ({ name: path.basename(entry.path), file: path.resolve(root, entry.path), legacy: false }))];
	} catch (error) {
		if (!fileSystem.isMissing(error)) { throw error; }
	}
	// Recovery without an index: find every problem-owned record in the workspace.
	const owned: ProblemRecordLocation[] = [];
	for (const [name, type] of entries) {
		if (type !== 2) { continue; }
		const directory = path.join(root, name);
		for (const [file, fileType] of await fileSystem.readDirectory(directory)) {
			if (fileType === 1 && file.startsWith('oj-') && file.endsWith('.json')) {
				owned.push({ name: file, file: path.join(directory, file), legacy: false });
			}
		}
	}
	return [...legacy, ...owned];
}

function isIndexEntry(value: unknown): value is ProblemRecordIndexEntry {
	if (!value || typeof value !== 'object') { return false; }
	const entry = value as Partial<ProblemRecordIndexEntry>;
	return typeof entry.problemRef === 'string' && typeof entry.path === 'string'
		&& path.basename(entry.path) === `oj-${getWorkspaceProblemRecordFileName(entry.problemRef)}`;
}

/** Publish complete files before their index; a failed write keeps the migration source readable. */
export async function writeProblemRecordAtomically(fileSystem: ProblemRecordFileSystem, file: string, contents: string): Promise<void> {
	const temporary = `${file}.${randomUUID()}.tmp`;
	try {
		await fileSystem.writeFile(temporary, new TextEncoder().encode(contents));
		await fileSystem.rename(temporary, file);
	} catch (error) {
		try { await fileSystem.delete(temporary); }
		catch (cleanupError) { if (!fileSystem.isMissing(cleanupError)) { console.warn('Unable to remove incomplete OJ record.', cleanupError); } }
		throw error;
	}
}

export type LegacyRecordSnapshot = { file: string; problemRef: string; contents: Uint8Array };

/** Only recognized flat OJ records are eligible for cleanup. Unknown files remain untouched. */
export async function snapshotLegacyProblemRecords(root: string, fileSystem: ProblemRecordFileSystem): Promise<LegacyRecordSnapshot[]> {
	const snapshots: LegacyRecordSnapshot[] = [];
	try {
		for (const [name, type] of await fileSystem.readDirectory(root)) {
			if (type !== 1 || name === 'oj-index.json' || name === 'oj-problems.json' || !name.endsWith('.json')) { continue; }
			try {
				const file = path.join(root, name);
				const contents = await fileSystem.readFile(file);
				const record = JSON.parse(new TextDecoder().decode(contents));
				if ((record.version === 1 || record.version === 2) && typeof record.problem?.ref === 'string'
					&& name === getWorkspaceProblemRecordFileName(record.problem.ref)) {
					snapshots.push({ file, problemRef: record.problem.ref, contents });
				}
			} catch { /* Do not delete unreadable or invalid migration sources. */ }
		}
	} catch (error) { if (!fileSystem.isMissing(error)) { throw error; } }
	return snapshots;
}

/** Delete an unchanged source only after both its full replacement and index are verified. */
export async function cleanLegacyProblemRecords(
	root: string, fileSystem: ProblemRecordFileSystem, snapshots: LegacyRecordSnapshot[],
	index: ProblemRecordIndexEntry[], replacements: Map<string, string>,
): Promise<void> {
	const publishedIndex = JSON.stringify(index);
	for (const source of snapshots) {
		const entry = index.find(item => item.problemRef === source.problemRef);
		const replacement = replacements.get(source.problemRef);
		if (!entry || replacement === undefined) { continue; }
		try {
			const decode = (contents: Uint8Array) => new TextDecoder().decode(contents);
			if (decode(await fileSystem.readFile(path.join(root, 'oj-index.json'))) !== publishedIndex) { return; }
			if (decode(await fileSystem.readFile(path.resolve(root, entry.path))) !== replacement) { continue; }
			if (!Buffer.from(await fileSystem.readFile(source.file)).equals(Buffer.from(source.contents))) { continue; }
			await fileSystem.delete(source.file);
		} catch (error) { if (!fileSystem.isMissing(error)) { console.warn('Unable to clean migrated OJ record.', error); } }
	}
}

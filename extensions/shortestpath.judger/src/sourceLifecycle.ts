/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DashboardRecord } from './dashboardStats';
import { dashboardContains } from './dashboardRepository';
import { removeStoredProblem } from './problemStorage';

export type SourceRename = { oldPath: string; newPath: string };

/** Directory renames retain the suffix of each bound source. */
export function renamedSource(source: string, renames: SourceRename[]): string | undefined {
	let current = path.resolve(source), changed = false;
	for (const rename of renames) {
		if (current === path.resolve(rename.oldPath) || dashboardContains(rename.oldPath, current)) {
			current = path.resolve(rename.newPath, path.relative(rename.oldPath, current)); changed = true;
		}
	}
	return changed ? current : undefined;
}

function missing(source: string): boolean {
	try { fs.statSync(source); return false; }
	catch (error) { return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? ''); }
}

/** Resolve the nearest existing parent before trusting a missing filesystem path. */
function owned(file: string, roots: string[]): boolean {
	let parent = file;
	while (!fs.existsSync(parent) && path.dirname(parent) !== parent) { parent = path.dirname(parent); }
	try {
		const real = fs.realpathSync(parent);
		return roots.some(root => dashboardContains(root, file) && (real === fs.realpathSync(root) || dashboardContains(fs.realpathSync(root), real)));
	} catch { return false; }
}

/** Delete owned metadata and migration backups, or relocate them without resetting the timer. */
export function reconcileSourceRecords(records: DashboardRecord[], roots: string[], renames: SourceRename[], storagePath: (source: string) => string, saveLocation?: string): { deleted: string[]; renamed: SourceRename[] } {
	const deleted = new Set<string>(), moved = new Map<string, string>();
	const storageRoots = [...roots, ...(saveLocation ? [saveLocation] : [])];
	const rank = (record: DashboardRecord) => {
		if (!record.recordId || !record.srcPath) { return 0; }
		const versioned = path.basename(record.recordId) === 'problem.json';
		const base = versioned ? path.dirname(record.recordId).slice(0, -'.judger'.length) : record.recordId;
		return (base === storagePath(record.srcPath) ? 4 : 0) + (versioned ? 2 : 0);
	};
	const ordered = [...records].sort((a, b) => rank(b) - rank(a));
	// Reject stale batches before any deletion or relocation can escape notification.
	for (const record of ordered) {
		if (record.recordFingerprint && record.recordId && record.srcPath && owned(record.srcPath, roots) && owned(record.recordId, storageRoots) && fs.existsSync(record.recordId)) {
			const contents = fs.readFileSync(record.recordId, 'utf8');
			if (crypto.createHash('sha256').update(contents).digest('hex') !== record.recordFingerprint) { throw Object.assign(new Error('Source record changed during reconciliation'), { code: 'SOURCE_RECORD_CHANGED' }); }
		}
	}
	for (const record of ordered) {
		const source = record.srcPath, file = record.recordId;
		if (!source || !file || !owned(source, roots) || !owned(file, storageRoots) || !fs.existsSync(file)) { continue; }
		const stat = fs.lstatSync(file);
		if (!stat.isFile() || stat.isSymbolicLink()) { continue; }
		const versioned = path.basename(file) === 'problem.json';
		const base = versioned ? path.dirname(file).slice(0, -'.judger'.length) : file;
		if (!base.endsWith('.prob') || versioned && !path.dirname(file).endsWith('.prob.judger')) { continue; }
		const contents = fs.readFileSync(file, 'utf8');
		const next = renamedSource(source, renames);
		if (!next) {
			if (missing(source)) { removeStoredProblem(base); deleted.add(source); }
			continue;
		}
		if (next === source) { continue; }
		if (!owned(next, roots) || !fs.existsSync(next) || !fs.statSync(next).isFile()) { continue; }
		const stored = JSON.parse(contents);
		const metadata = versioned ? stored.problem : stored;
		if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) { continue; }
		const destination = storagePath(next), target = versioned ? path.join(`${destination}.judger`, 'problem.json') : destination;
		if (!owned(target, storageRoots)) { continue; }
		// An existing destination belongs to another record; never overwrite it.
		const relocate = !fs.existsSync(target) && (base === storagePath(source) || !fs.existsSync(path.join(`${destination}.judger`, 'problem.json')) && !fs.existsSync(destination));
		const owner = [...roots].sort((a, b) => b.length - a.length).find(root => dashboardContains(root, next))!;
		metadata.srcPath = next;
		metadata.workspaceRelativeSourcePath = path.relative(owner, next);
		metadata.storageRevision = crypto.randomUUID();
		if (versioned && relocate) {
			const oldDirectory = `${base}.judger`, newDirectory = `${destination}.judger`;
			const rebase = (value: unknown) => typeof value === 'string' && dashboardContains(oldDirectory, value) ? path.join(newDirectory, path.relative(oldDirectory, value)) : value;
			for (const test of Array.isArray(stored.tests) ? stored.tests : []) { if (test && typeof test === 'object') { for (const key of ['inputPath', 'outputPath']) { if (test[key]) { test[key] = rebase(test[key]); } } } }
			for (const key of ['customCheckerPath', 'interactorPath', 'stressGeneratorPath', 'stressStdPath']) { if (metadata[key]) { metadata[key] = rebase(metadata[key]); } }
		}
		const sourceEntry = versioned ? `${base}.judger` : base;
		const destinationEntry = versioned ? `${destination}.judger` : destination;
		if (relocate) { fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.renameSync(sourceEntry, destinationEntry); }
		const output = relocate ? target : file;
		const temporary = `${output}.${crypto.randomBytes(16).toString('hex')}.tmp`;
		try { fs.writeFileSync(temporary, JSON.stringify(stored), { mode: stat.mode }); fs.renameSync(temporary, output); }
		catch (error) { if (relocate) { fs.renameSync(destinationEntry, sourceEntry); } throw error; }
		finally { fs.rmSync(temporary, { force: true }); }
		moved.set(source, next);
	}
	return { deleted: [...deleted], renamed: [...moved].map(([oldPath, newPath]) => ({ oldPath, newPath })) };
}

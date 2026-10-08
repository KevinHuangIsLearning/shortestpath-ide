/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { DashboardRecord } from './dashboardStats';

/** Reject escape paths and symlinks; all editor actions must stay in the workspace. */
export function dashboardContains(root: string, file: string): boolean {
	const relative = path.relative(root, file);
	return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Read metadata only: never load samples, migrate files or rewrite legacy records. */
export async function readDashboard(roots: string[], saveLocation?: string): Promise<{ records: DashboardRecord[]; skipped: number }> {
	const selected = new Map<string, { record: DashboardRecord; rank: number; modified: number }>();
	let skipped = 0;
	for (const root of roots) {
		const manifests: string[] = [], sources = new Map<string, string>();
		const walk = async (directory: string): Promise<void> => {
			let entries;
			try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { skipped++; return; }
			for (const entry of entries) {
				const file = path.join(directory, entry.name);
				if (entry.isSymbolicLink()) { continue; }
				if (entry.isDirectory()) {
					if (entry.name.endsWith('.prob.judger')) { manifests.push(path.join(file, 'problem.json')); }
					else if (!['.git', 'node_modules', 'dist', 'out', '.vscode-test'].includes(entry.name)) { await walk(file); }
				} else if (entry.isFile()) {
					if (entry.name.endsWith('.prob')) { manifests.push(file); }
					else if (/\.(cpp|cc|cxx|c|py|java|rs|go|js|hs|rb|cs|cj)$/.test(entry.name)) {
						const hash = crypto.createHash('md5').update(path.relative(root, file)).digest('hex');
						sources.set(`.${entry.name}_${hash}.prob`, file);
					}
				}
			}
		};
		await walk(root);
		const modern = new Set(manifests.filter(file => path.basename(file) === 'problem.json').map(file => path.dirname(file).slice(0, -'.judger'.length)));
		const storageDirectory = saveLocation ? path.resolve(saveLocation) : path.join(root, '.shortestpath');
		const storageNames = [...new Set(manifests.filter(file => path.dirname(path.basename(file) === 'problem.json' ? path.dirname(file) : file) === storageDirectory).map(file => path.basename(file) === 'problem.json' ? path.basename(path.dirname(file)).slice(0, -'.judger'.length) : path.basename(file)))].filter(name => /^\..+_[a-f0-9]{32}\.prob$/.test(name));
		for (const manifest of manifests) {
			if (modern.has(manifest)) { continue; }
			try {
				const stat = await fs.lstat(manifest);
				if (!stat.isFile() || stat.isSymbolicLink()) { throw new Error('Invalid manifest'); }
				const contents = await fs.readFile(manifest, 'utf8');
				const stored = JSON.parse(contents);
				const versioned = path.basename(manifest) === 'problem.json';
				const metadata = versioned ? stored?.problem : stored;
				if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || !Object.keys(metadata).some(key => ['name', 'url', 'srcPath', 'workspaceRelativeSourcePath', 'timeAcceptedAtUnixMs', 'timePartialAcceptedAtUnixMs', 'timeSpentMs', 'timeStartedAtUnixMs', 'local', 'group', 'importedFrom', 'importedUrl', 'tests'].includes(key))) { throw new Error('Invalid metadata'); }
				const text = (key: string): string => typeof metadata[key] === 'string' ? metadata[key] : '';
				const legacyName = versioned ? path.basename(path.dirname(manifest)).slice(0, -'.judger'.length) : path.basename(manifest);
				const encodedName = /^\..+_[a-f0-9]{32}\.prob$/.test(legacyName);
				const candidate = sources.get(legacyName) ?? (text('workspaceRelativeSourcePath') ? path.resolve(root, text('workspaceRelativeSourcePath')) : text('srcPath') ? path.resolve(root, text('srcPath')) : '');
				let source = candidate;
				let sourceAvailable = false;
				if (source && dashboardContains(root, source)) {
					try {
						sourceAvailable = dashboardContains(await fs.realpath(root), await fs.realpath(source)) && (await fs.stat(source)).isFile();
						if (!sourceAvailable) { source = ''; }
					} catch { /* Missing source does not invalidate historical statistics. */ }
				} else { source = ''; }
				const birth = (versioned ? (await fs.stat(path.dirname(manifest))).birthtimeMs : stat.birthtimeMs) || stat.mtimeMs;
				const started = metadata.timeStartedAtUnixMs;
				const createdFallback = typeof started === 'number' && Number.isFinite(started) && started > 0 && !Number.isNaN(new Date(started).getTime()) ? Math.min(birth, started) : birth;
				const record: DashboardRecord = {
					name: text('name') || path.basename(source || legacyName).replace(/^\.(.+)_[a-f0-9]{32}\.prob$/, '$1').replace(/\.prob$/, ''),
					url: text('url'), group: text('group'), srcPath: source, recordId: manifest, recordFingerprint: crypto.createHash('sha256').update(contents).digest('hex'), sourceAvailable,
					interactive: false, timeLimit: 0, memoryLimit: 0,
					createdAtUnixMs: typeof metadata.dashboardCreatedAtUnixMs === 'number' && Number.isFinite(metadata.dashboardCreatedAtUnixMs) && metadata.dashboardCreatedAtUnixMs > 0 && !Number.isNaN(new Date(metadata.dashboardCreatedAtUnixMs).getTime()) ? metadata.dashboardCreatedAtUnixMs : createdFallback,
					dashboardTimeCapped: metadata.dashboardTimeCapped === true,
					dashboardCompletion: ['none', 'partial', 'accepted'].includes(metadata.dashboardCompletion) ? metadata.dashboardCompletion : undefined,
					local: typeof metadata.local === 'boolean' ? metadata.local : undefined,
					importedFrom: text('importedFrom') || undefined, importedUrl: text('importedUrl') || undefined,
				};
				for (const key of ['timeAcceptedAtUnixMs', 'timePartialAcceptedAtUnixMs', 'timeStartedAtUnixMs', 'timeSpentMs'] as const) {
					const value = metadata[key];
					if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && (key === 'timeSpentMs' || !Number.isNaN(new Date(value).getTime()))) { record[key] = value; }
				}
				const canonical = encodedName && path.dirname(versioned ? path.dirname(manifest) : manifest) === storageDirectory;
				const rank = (versioned ? 2 : 0) + (canonical ? 4 : 0);
				// Storage filenames retain the source identity after fields or source files disappear.
				let storageName = canonical ? legacyName : '';
				if (!storageName && candidate && dashboardContains(root, candidate)) {
					storageName = `.${path.basename(candidate)}_${crypto.createHash('md5').update(path.relative(root, candidate)).digest('hex')}.prob`;
				} else if (!storageName && candidate) {
					const matches = storageNames.filter(name => name.startsWith(`.${path.basename(candidate)}_`));
					if (matches.length === 1) { storageName = matches[0]; }
				}
				const key = storageName ? path.join(root, storageName) : source || manifest;
				const previous = selected.get(key);
				if (previous?.record.createdAtUnixMs !== undefined && metadata.dashboardCreatedAtUnixMs === undefined) { record.createdAtUnixMs = Math.min(record.createdAtUnixMs!, previous.record.createdAtUnixMs); }
				if (previous && rank < previous.rank && previous.record.createdAtUnixMs !== undefined) { previous.record.createdAtUnixMs = Math.min(previous.record.createdAtUnixMs, record.createdAtUnixMs!); }
				if (!previous || rank > previous.rank || rank === previous.rank && stat.mtimeMs > previous.modified) {
					selected.set(key, { record, rank, modified: stat.mtimeMs });
				}
			} catch { skipped++; }
		}
	}
	return { records: [...selected.values()].map(value => value.record), skipped };
}

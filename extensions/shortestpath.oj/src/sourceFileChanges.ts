/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';

export type SourceFileChanges = { deleted: string[]; renamed: { oldPath: string; newPath: string }[] };
type SourceCache = { sourcePaths: Record<string, string>; problems: Record<string, unknown>; submissions: Record<string, unknown>; editorials: Record<string, unknown>; previousStatements: Record<string, unknown>; lastUsedAt: Record<string, unknown>; recoveryContexts: Record<string, unknown> };

/** A deleted local source removes its local snapshot; renames retain all problem state. */
export function applySourceFileChanges(cache: SourceCache, changes: SourceFileChanges): string[] {
	const removed: string[] = [];
	for (const [ref, source] of Object.entries(cache.sourcePaths)) {
		const rename = changes.renamed.find(item => path.resolve(item.oldPath) === path.resolve(source));
		if (rename) { cache.sourcePaths[ref] = rename.newPath; continue; }
		if (!changes.deleted.some(item => path.resolve(item) === path.resolve(source))) { continue; }
		removed.push(ref);
		for (const key of ['sourcePaths', 'problems', 'submissions', 'editorials', 'previousStatements', 'lastUsedAt', 'recoveryContexts'] as const) { delete cache[key][ref]; }
	}
	return removed;
}

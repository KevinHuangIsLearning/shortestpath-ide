/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ImportedProblem } from './shortestpathOjProtocol';

export type WorkspaceProblemRecoveryContext = Pick<ImportedProblem, 'ref' | 'url' | 'accountId' | 'target'>;

/** Keep only the identity needed to fetch an evicted snapshot through the website. */
export function getWorkspaceProblemRecoveryContext(problem: WorkspaceProblemRecoveryContext): WorkspaceProblemRecoveryContext {
	return { ref: problem.ref, url: problem.url, accountId: problem.accountId, target: problem.target };
}

export function readWorkspaceProblemRecoveryContext(value: unknown): WorkspaceProblemRecoveryContext | undefined {
	if (!value || typeof value !== 'object') { return undefined; }
	const context = value as Partial<WorkspaceProblemRecoveryContext>;
	if (typeof context.ref !== 'string' || typeof context.url !== 'string' || typeof context.accountId !== 'string' || !context.target || !['training', 'standalone', 'contest'].includes(context.target.kind) || typeof context.target.problemId !== 'string') { return undefined; }
	if (context.target.kind === 'training' && context.target.problemRef !== context.ref) { return undefined; }
	try { if (!['http:', 'https:'].includes(new URL(context.url).protocol)) { return undefined; } } catch { return undefined; }
	if (context.target.kind === 'contest' && ![context.target.contestId, context.target.contestRef, context.target.contestProblemId, context.target.problemLabel].every(item => typeof item === 'string')) { return undefined; }
	return getWorkspaceProblemRecoveryContext(context as WorkspaceProblemRecoveryContext);
}

export const workspaceProblemCacheLimit = 30;

type ProblemCacheRecency = {
	problems: Record<string, object>;
	lastUsedAt: Record<string, number>;
};

/** Record actual use independently of background writes and wall-clock changes. */
export function touchWorkspaceProblemCache(cache: ProblemCacheRecency, problemRef: string, now = Date.now()): boolean {
	if (!Object.hasOwn(cache.problems, problemRef)) { return false; }
	cache.lastUsedAt[problemRef] = Math.max(now, Object.values(cache.lastUsedAt).reduce((latest, value) => Number.isFinite(value) ? Math.max(latest, value + 1) : latest, 0));
	return true;
}

/** Return the oldest snapshots exceeding the fixed per-workspace capacity. */
export function getWorkspaceProblemCacheEvictions(cache: ProblemCacheRecency): string[] {
	return Object.keys(cache.problems).sort((left, right) => (cache.lastUsedAt[left] ?? 0) - (cache.lastUsedAt[right] ?? 0) || left.localeCompare(right, 'en'))
		.slice(0, Math.max(0, Object.keys(cache.problems).length - workspaceProblemCacheLimit));
}

export function getWorkspaceProblemRecordFileName(problemRef: string): string {
	const fileName = problemRef.split('/').map(encodeWorkspaceProblemRefSegment).join('.');
	const result = `${fileName}.json`;
	if (new TextEncoder().encode(result).byteLength > 240) {
		throw new Error(`题目路径过长，无法生成跨平台安全的缓存文件名：${problemRef}。`);
	}
	return result;
}

function encodeWorkspaceProblemRefSegment(segment: string): string {
	const encoded = encodeURIComponent(segment).replace(/[.!'()*~]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
	return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(segment)
		? `%${segment.charCodeAt(0).toString(16).toUpperCase()}${encoded.slice(1)}`
		: encoded;
}

export function assertUniqueWorkspaceProblemRecordFileNames(problemRefs: Iterable<string>): void {
	const refsByCaseInsensitiveFileName = new Map<string, string>();
	for (const problemRef of problemRefs) {
		const fileName = getWorkspaceProblemRecordFileName(problemRef);
		const existingRef = refsByCaseInsensitiveFileName.get(fileName.toLocaleLowerCase('en-US'));
		if (existingRef && existingRef !== problemRef) {
			throw new Error(`题目缓存文件名冲突：${existingRef} 与 ${problemRef}。`);
		}
		refsByCaseInsensitiveFileName.set(fileName.toLocaleLowerCase('en-US'), problemRef);
	}
}

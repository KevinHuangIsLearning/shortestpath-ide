/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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

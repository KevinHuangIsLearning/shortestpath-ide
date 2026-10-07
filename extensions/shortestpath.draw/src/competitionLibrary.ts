/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LibraryItems } from '@excalidraw/excalidraw/types';
import competitionLibrary from './competitionLibrary.json';
import { getDrawStrings } from './strings';

// These JSON assets include legacy element records; the canvas restores them with Excalidraw.
const bundledItems = competitionLibrary.libraryItems as unknown as LibraryItems;
const libraryVersion = 1;

interface SavedLibrary {
	readonly libraryItems: LibraryItems;
	readonly shortestpathCompetitionLibraryVersion?: number;
}

/** Seed existing drafts once, keeping custom items and subsequent library removals. */
export function initializeCompetitionLibrary(serialized: string | undefined, language: string): LibraryItems {
	const saved: SavedLibrary | undefined = serialized ? JSON.parse(serialized) : undefined;
	let items = saved?.libraryItems ?? [];
	if ((saved?.shortestpathCompetitionLibraryVersion ?? 0) < libraryVersion) {
		const existingIds = new Set(items.map(item => item.id));
		items = [...items, ...structuredClone(bundledItems.filter(item => !existingIds.has(item.id)))];
	}
	const names: Readonly<Record<string, string>> = getDrawStrings(language).libraryNames;
	const englishNames: Readonly<Record<string, string>> = getDrawStrings('en').libraryNames;
	const chineseNames: Readonly<Record<string, string>> = getDrawStrings('zh-cn').libraryNames;
	return items.map(item => {
		const name = names[item.id];
		// Only translate our own template names; keep renamed items and drawing text verbatim.
		return name && (!item.name || item.name === englishNames[item.id] || item.name === chineseNames[item.id]) ? { ...item, name } : item;
	});
}

/** Persist the seed marker even after all templates are removed. */
export function serializeCompetitionLibrary(libraryItems: LibraryItems): string {
	return JSON.stringify({
		type: 'excalidrawlib', version: 2, source: 'ShortestPath IDE',
		shortestpathCompetitionLibraryVersion: libraryVersion, libraryItems,
	});
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const SHORTESTPATH_OJ_PRIMARY_GROUP_RATIO = 0.6;

export function getShortestPathOjPrimaryGroupWidth(primaryWidth: number, secondaryWidth: number): number | undefined {
	const totalWidth = primaryWidth + secondaryWidth;
	if (!Number.isFinite(totalWidth) || totalWidth <= 0) {
		return undefined;
	}

	return Math.round(totalWidth * SHORTESTPATH_OJ_PRIMARY_GROUP_RATIO);
}

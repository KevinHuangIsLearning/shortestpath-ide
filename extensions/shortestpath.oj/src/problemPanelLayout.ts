/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const defaultProblemSourceRatio = 60;

export type ProblemPanelLayout = {
	orientation: 0;
	groups: [{ size: number }, { size: number }];
};

export function normalizeProblemSourceRatio(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return defaultProblemSourceRatio;
	}
	return Math.min(90, Math.max(10, value));
}

export function getProblemPanelLayout(value: unknown): ProblemPanelLayout {
	const sourceRatio = normalizeProblemSourceRatio(value);
	return {
		orientation: 0,
		groups: [{ size: sourceRatio / 100 }, { size: (100 - sourceRatio) / 100 }],
	};
}

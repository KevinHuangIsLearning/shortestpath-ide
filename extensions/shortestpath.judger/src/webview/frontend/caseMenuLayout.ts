/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger. Licensed under GPL-3.0-or-later.
 *--------------------------------------------------------------------------------------------*/

export type MenuAnchor = { right: number; top: number; bottom: number };

/** Keep the entire menu inside the viewport, including when the button is near its left edge. */
export function caseMenuLayout(anchor: MenuAnchor, viewportWidth: number, viewportHeight: number) {
	const margin = Math.min(8, viewportWidth / 2, viewportHeight / 2);
	const width = Math.min(240, Math.max(0, viewportWidth - margin * 2));
	const left = Math.max(margin, Math.min(anchor.right - width, viewportWidth - width - margin));
	const opensUp = anchor.top > viewportHeight / 2;
	const edge = Math.max(margin, Math.min(opensUp ? viewportHeight - anchor.top + 4 : anchor.bottom + 4, viewportHeight - margin));
	return {
		left,
		width,
		maxHeight: Math.max(0, viewportHeight - edge - margin),
		...(opensUp ? { bottom: edge } : { top: edge }),
	};
}

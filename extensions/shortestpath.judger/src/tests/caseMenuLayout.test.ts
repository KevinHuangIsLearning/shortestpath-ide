/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger. Licensed under GPL-3.0-or-later.
 *--------------------------------------------------------------------------------------------*/
import { caseMenuLayout } from '../webview/frontend/caseMenuLayout';

test.each([160, 210, 320, 640])('menu stays within a %dpx viewport even with an anchor at either edge', width => {
	for (const right of [30, width - 10, width + 50]) {
		for (const top of [40, 560]) {
			const layout = caseMenuLayout({ right, top, bottom: top + 24 }, width, 600);
			expect(layout.left).toBeGreaterThanOrEqual(8);
			expect(layout.left + layout.width).toBeLessThanOrEqual(width - 8);
			expect(layout.maxHeight).toBeGreaterThanOrEqual(0);
			const edge = 'top' in layout ? layout.top! : layout.bottom!;
			expect(edge + layout.maxHeight).toBeLessThanOrEqual(592);
		}
	}
});

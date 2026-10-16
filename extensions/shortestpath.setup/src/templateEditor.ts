/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type TemplateEditorBounds = {
	left: number;
	top: number;
	width: number;
	height: number;
	clipTop: number;
	clipBottom: number;
};

/** Reserve the same native editor surface in settings and first-run setup. */
export function templateEditorLayoutScript(clippingContainer?: string): string {
	return `
let templateLayoutFrame;
function layoutTemplateEditor() {
	const slot = byId('cppTemplate');
	const rect = slot.getBoundingClientRect();
	const content = ${clippingContainer ? `byId(${JSON.stringify(clippingContainer)}).getBoundingClientRect()` : '{ top: 0, bottom: window.innerHeight }'};
	vscode.postMessage({ type: 'templateEditorLayout', bounds: {
		left: rect.left + slot.clientLeft, top: rect.top + slot.clientTop,
		width: slot.clientWidth, height: slot.clientHeight,
		clipTop: Math.max(0, content.top), clipBottom: Math.min(window.innerHeight, content.bottom)
	} });
}
function scheduleTemplateLayout() {
	cancelAnimationFrame(templateLayoutFrame);
	templateLayoutFrame = requestAnimationFrame(layoutTemplateEditor);
}
const templateResizeObserver = new ResizeObserver(scheduleTemplateLayout);
templateResizeObserver.observe(byId('cppTemplate'));
templateResizeObserver.observe(${clippingContainer ? `byId(${JSON.stringify(clippingContainer)})` : 'document.documentElement'});
document.addEventListener('scroll', scheduleTemplateLayout, true);
window.addEventListener('resize', scheduleTemplateLayout);
window.addEventListener('pagehide', () => {
	templateResizeObserver.disconnect();
	cancelAnimationFrame(templateLayoutFrame);
});
`;
}

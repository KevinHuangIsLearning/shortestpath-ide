/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getDomNodeZoomLevel, isHTMLElement } from '../../../../base/browser/dom.js';
import { IHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegate.js';
import { HoverPosition } from '../../../../base/browser/ui/hover/hoverWidget.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';

/** Anchors navigation tooltips beside the button in every workspace mode. */
export function createNavigationHoverDelegate(hoverService: IHoverService): IHoverDelegate {
	return {
		delay: 100,
		placement: 'element',
		showHover: (options, focus) => {
			const target = isHTMLElement(options.target) ? { targetElements: [options.target] } : options.target;
			const button = target.targetElements[0];
			const zoom = getDomNodeZoomLevel(options.container ?? button.closest<HTMLElement>('.monaco-workbench') ?? button);
			const bounds = button.getBoundingClientRect();
			return hoverService.showInstantHover({
				...options,
				// ContextView positions in container CSS coordinates; target bounds already include CSS zoom.
				target: { ...target, x: bounds.right / zoom, y: bounds.bottom / zoom },
				additionalClasses: ['shortestpath-navigation-hover'],
				position: { hoverPosition: HoverPosition.RIGHT },
				appearance: { compact: true, showPointer: false, skipFadeInAnimation: true },
				persistence: { hideOnKeyDown: true }
			}, focus);
		}
	};
}

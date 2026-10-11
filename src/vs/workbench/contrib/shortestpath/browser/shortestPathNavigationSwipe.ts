/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, EventType, getDomNodeZoomLevel, getWindow, isHTMLElement } from '../../../../base/browser/dom.js';
import { DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';

/** Move one shared highlight between page entries, following hover and horizontal gestures. */
export function registerNavigationSwipe(container: HTMLElement, switchPage: (direction: -1 | 1) => void, pageButtons: readonly HTMLButtonElement[]): IDisposable {
	const store = new DisposableStore();
	const targetWindow = getWindow(container);
	const selection = container.ownerDocument.createElement('span');
	selection.className = 'shortestpath-navigation-selection';
	selection.setAttribute('aria-hidden', 'true');
	container.append(selection);
	let lastEvent = 0;
	let distance = 0;
	let hovered: HTMLButtonElement | undefined;
	let settling: number | undefined;
	const buttons = () => pageButtons.filter(button => !button.disabled);
	const refresh = () => {
		const entries = buttons();
		const active = entries.find(button => button.getAttribute('aria-pressed') === 'true');
		const current = settling === undefined ? hovered ?? active : active;
		selection.hidden = !container.classList.contains('compact-navigation') || !current || current.getBoundingClientRect().width === 0;
		if (selection.hidden || !current) { return; }
		const zoom = getDomNodeZoomLevel(container);
		const bounds = container.getBoundingClientRect();
		const from = current.getBoundingClientRect();
		const adjacent = entries[entries.indexOf(current) + (distance > 0 ? 1 : -1)];
		const to = adjacent?.getBoundingClientRect();
		const progress = to && to.width > 0 ? Math.min(1, Math.abs(distance) / 40) : 0;
		const left = from.left + ((to?.left ?? from.left) - from.left) * progress;
		const width = from.width + ((to?.width ?? from.width) - from.width) * progress;
		selection.style.transform = `translate(${(left - bounds.left) / zoom - container.clientLeft + container.scrollLeft}px, ${(from.top - bounds.top) / zoom - container.clientTop}px)`;
		selection.style.width = `${width / zoom}px`;
		selection.style.height = `${from.height / zoom}px`;
	};
	store.add(addDisposableListener(container, 'pointerover', (event: PointerEvent) => {
		hovered = pageButtons.find(button => !button.disabled && event.target instanceof targetWindow.Node && button.contains(event.target));
		refresh();
	}));
	store.add(addDisposableListener(container, 'pointerleave', () => { hovered = undefined; refresh(); }));
	store.add(addDisposableListener(container, 'scroll', refresh));
	store.add(addDisposableListener(container, EventType.WHEEL, (event: WheelEvent) => {
		if (!container.classList.contains('compact-navigation') || event.ctrlKey || event.metaKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) { return; }
		event.preventDefault();
		event.stopPropagation();
		if (event.timeStamp - lastEvent > 200) { distance = 0; }
		lastEvent = event.timeStamp;
		const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientWidth : 1;
		distance += event.deltaX * scale;
		if (settling !== undefined) { targetWindow.clearTimeout(settling); }
		selection.style.transition = 'none';
		settling = targetWindow.setTimeout(() => {
			settling = undefined;
			if (Math.abs(distance) >= 20) { switchPage(distance > 0 ? 1 : -1); }
			distance = 0;
			hovered = undefined;
			selection.style.removeProperty('transition');
			refresh();
			queueMicrotask(() => { if (!store.isDisposed) { refresh(); } });
		}, 120);
		refresh();
		if (Math.abs(distance) >= 40) {
			const direction = distance > 0 ? 1 : -1;
			distance = 0;
			switchPage(direction);
			queueMicrotask(() => { if (!store.isDisposed) { refresh(); } });
		}
	}, { passive: false }));
	const observer = new MutationObserver(refresh);
	observer.observe(container, { subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-label', 'class', 'disabled'] });
	store.add(toDisposable(() => observer.disconnect()));
	const resizeObserver = new ResizeObserver(refresh);
	resizeObserver.observe(container);
	for (const button of buttons()) { resizeObserver.observe(button); }
	store.add(toDisposable(() => resizeObserver.disconnect()));
	store.add(toDisposable(() => {
		if (settling !== undefined) { targetWindow.clearTimeout(settling); }
		selection.remove();
	}));
	refresh();
	return store;
}

/** Animate the group between its active page and all entries for hover or keyboard focus. */
export function registerNavigationExpansion(container: HTMLElement): IDisposable {
	const store = new DisposableStore();
	const refresh = () => {
		if (!container.classList.contains('compact-navigation')) {
			container.style.removeProperty('width');
			return;
		}
		const targetWindow = getWindow(container);
		const children = [...container.children].filter(isHTMLElement).filter(child => { const style = targetWindow.getComputedStyle(child); return style.display !== 'none' && style.position !== 'absolute'; });
		const zoom = getDomNodeZoomLevel(container);
		const gap = parseFloat(targetWindow.getComputedStyle(container).columnGap) || 0;
		const width = children.reduce((sum, child) => sum + child.getBoundingClientRect().width / zoom, 0) + gap * Math.max(0, children.length - 1);
		container.style.width = `${width}px`;
	};
	for (const event of ['mouseenter', 'mouseleave', 'focusin']) {
		store.add(addDisposableListener(container, event, refresh));
	}
	store.add(addDisposableListener(container, 'focusout', () => queueMicrotask(() => { if (!store.isDisposed) { refresh(); } })));
	const observer = new MutationObserver(refresh);
	observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-label', 'hidden', 'class'] });
	store.add(toDisposable(() => observer.disconnect()));
	refresh();
	return store;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createRequire } from 'module';
import { FileAccess } from '../../../base/common/network.js';
import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';

export interface ITrackpadGesture {
	readonly phase: 'begin' | 'update' | 'end' | 'cancel';
	readonly amount: number;
	readonly x: number;
	readonly y: number;
}

export interface ITrackpadGestureSubscription extends IDisposable {
	start(canGoBack: boolean, canGoForward: boolean): void;
	cancel(): void;
}

export interface ITrackpadGestureMonitor {
	subscribe(callback: (phase: ITrackpadGesture['phase'], window: number, x: number, y: number, gesture: number, amount: number) => void): number;
	start(id: number, gesture: number, canGoBack: boolean, canGoForward: boolean): void;
	cancel(id: number): void;
	unsubscribe(id: number): void;
	pointForWindow(handle: Buffer, window: number, x: number, y: number): { x: number; y: number } | undefined;
}

let monitor: ITrackpadGestureMonitor | undefined;

/** Routes AppKit swipe tracking to the view under the pointer. */
export function registerBrowserViewTrackpadGesture(
	getWindow: () => Electron.BrowserWindow | undefined,
	getBounds: () => Electron.Rectangle,
	isAvailable: () => boolean,
	onGesture: (event: ITrackpadGesture) => void,
	native: ITrackpadGestureMonitor = monitor ??= createRequire(import.meta.url)(FileAccess.asFileUri('vs/platform/browserView/electron-main/trackpadGestureMonitor.node').fsPath) as ITrackpadGestureMonitor,
): ITrackpadGestureSubscription {
	let tracking: number | undefined;
	let disposed = false;
	const id = native.subscribe((phase, window, x, y, gesture, amount) => {
		if (disposed) {
			return;
		}
		const host = getWindow();
		const point = host && !host.isDestroyed() ? native.pointForWindow(host.getNativeWindowHandle(), window, x, y) : undefined;
		if (phase === 'begin') {
			const bounds = getBounds();
			const wasTracking = tracking !== undefined;
			tracking = point && isAvailable() && point.x >= bounds.x && point.x < bounds.x + bounds.width
				&& point.y >= bounds.y && point.y < bounds.y + bounds.height ? gesture : undefined;
			if (tracking !== undefined && point) {
				onGesture({ phase, amount, x: point.x - bounds.x, y: point.y - bounds.y });
			} else if (wasTracking) {
				onGesture({ phase: 'cancel', amount: 0, x: 0, y: 0 });
			}
		} else if (tracking === gesture) {
			if (!point || !isAvailable()) {
				tracking = undefined;
				native.cancel(id);
				onGesture({ phase: 'cancel', amount: 0, x: 0, y: 0 });
				return;
			}
			if (phase === 'end' || phase === 'cancel') { tracking = undefined; }
			onGesture({ phase, amount, x: 0, y: 0 });
		}
	});
	const disposable = toDisposable(() => {
		disposed = true;
		native.unsubscribe(id);
	});
	return Object.assign(disposable, {
		start: (canGoBack: boolean, canGoForward: boolean) => {
			if (!disposed && tracking !== undefined) { native.start(id, tracking, canGoBack, canGoForward); }
		},
		cancel: () => { tracking = undefined; if (!disposed) { native.cancel(id); } },
	});
}

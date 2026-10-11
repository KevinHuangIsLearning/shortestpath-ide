/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createRequire } from 'module';
import { FileAccess } from '../../../base/common/network.js';
import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';

export interface ITrackpadPhase {
	readonly phase: 'begin' | 'end' | 'cancel';
	readonly timestamp: number;
}

interface ITrackpadMonitor {
	subscribe(callback: (phase: ITrackpadPhase['phase'], window: number, x: number, y: number, timestamp: number) => void): number;
	unsubscribe(id: number): void;
	pointForWindow(handle: Buffer, window: number, x: number, y: number): { x: number; y: number } | undefined;
}

let monitor: ITrackpadMonitor | undefined;

/** Observes native finger phases for a view's current host and bounds. */
export function registerBrowserViewTrackpadGesture(
	getWindow: () => Electron.BrowserWindow | undefined,
	getBounds: () => Electron.Rectangle,
	isAvailable: () => boolean,
	onPhase: (event: ITrackpadPhase) => void,
): IDisposable {
	const native = monitor ??= createRequire(import.meta.url)(FileAccess.asFileUri('vs/platform/browserView/electron-main/trackpadGestureMonitor.node').fsPath) as ITrackpadMonitor;
	let tracking = false;
	let disposed = false;
	const id = native.subscribe((phase, window, x, y, timestamp) => {
		if (disposed) {
			return;
		}
		const host = getWindow();
		const point = host && !host.isDestroyed() ? native.pointForWindow(host.getNativeWindowHandle(), window, x, y) : undefined;
		if (phase === 'begin') {
			const bounds = getBounds();
			tracking = !!point && isAvailable() && point.x >= bounds.x && point.x < bounds.x + bounds.width
				&& point.y >= bounds.y && point.y < bounds.y + bounds.height;
			if (tracking) {
				onPhase({ phase, timestamp });
			}
		} else if (tracking) {
			tracking = false;
			onPhase({ phase: point ? phase : 'cancel', timestamp });
		}
	});
	return toDisposable(() => {
		disposed = true;
		native.unsubscribe(id);
	});
}

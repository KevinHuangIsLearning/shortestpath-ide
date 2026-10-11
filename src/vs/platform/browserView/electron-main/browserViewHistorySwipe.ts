/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import type { ITrackpadPhase } from './browserViewTrackpadGesture.js';

/** Confirms page swipes only after the native trackpad finger phase ends. */
export function registerBrowserViewHistorySwipe(
	contents: Electron.WebContents,
	isAvailable: () => boolean,
	navigate: (direction: 'back' | 'forward') => void,
	subscribe: (listener: (event: ITrackpadPhase) => void) => IDisposable,
): IDisposable {
	let beginTimestamp = Infinity;
	let token = 0;
	let active = false;
	let released = true;
	let handled = false;
	const sendState = () => contents.send('vscode:browserView:historySwipeState', {
		token,
		beginTimestamp,
		released,
		canGoBack: contents.navigationHistory.canGoBack(),
		canGoForward: contents.navigationHistory.canGoForward(),
	});
	const cancel = () => {
		token++;
		active = false;
		released = true;
		handled = false;
		beginTimestamp = Infinity;
		sendState();
	};
	const phaseSubscription = subscribe(({ phase, timestamp }) => {
		if (phase === 'begin') {
			if (!isAvailable()) {
				return;
			}
			token++;
			beginTimestamp = timestamp;
			active = true;
			released = false;
			handled = false;
			sendState();
		} else if (phase === 'cancel') {
			cancel();
		} else if (active) {
			active = false;
			released = true;
			contents.send('vscode:browserView:historySwipeEnd', { token, timestamp });
		}
	});
	const onReady = (event: Electron.IpcMainEvent) => {
		if (event.senderFrame === contents.mainFrame) {
			sendState();
		}
	};
	const onSwipe = (event: Electron.IpcMainEvent, direction: string, requestToken: number) => {
		if ((direction !== 'back' && direction !== 'forward') || !released || handled
			|| requestToken !== token || event.senderFrame !== contents.mainFrame || !isAvailable()
			|| !(direction === 'back' ? contents.navigationHistory.canGoBack() : contents.navigationHistory.canGoForward())) {
			return;
		}
		handled = true;
		navigate(direction);
	};
	const onNavigation = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
		if (details.isMainFrame) { cancel(); }
	};
	contents.on('blur', cancel);
	contents.on('did-start-navigation', onNavigation);
	contents.on('did-navigate', sendState);
	contents.on('did-navigate-in-page', sendState);
	contents.ipc.on('vscode:browserView:historySwipeReady', onReady);
	contents.ipc.on('vscode:browserView:historySwipe', onSwipe);
	return toDisposable(() => {
		phaseSubscription.dispose();
		contents.removeListener('blur', cancel);
		contents.removeListener('did-start-navigation', onNavigation);
		contents.removeListener('did-navigate', sendState);
		contents.removeListener('did-navigate-in-page', sendState);
		contents.ipc.removeListener('vscode:browserView:historySwipeReady', onReady);
		contents.ipc.removeListener('vscode:browserView:historySwipe', onSwipe);
	});
}

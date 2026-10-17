/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import type { ITrackpadGesture, ITrackpadGestureSubscription } from './browserViewTrackpadGesture.js';

/** Lets AppKit decide completion after the page permits history swiping. */
export function registerBrowserViewHistorySwipe(
	contents: Electron.WebContents,
	isAvailable: () => boolean,
	navigate: (action: 'back' | 'forward' | 'close') => void,
	subscribe: (listener: (event: ITrackpadGesture) => void) => ITrackpadGestureSubscription,
): IDisposable {
	let token = 0;
	let active = false;
	let approved = false;
	let allowedBack = false;
	let allowedForward = false;
	let closeTimer: ReturnType<typeof setTimeout> | undefined;
	const hide = () => contents.send('vscode:browserView:historySwipeProgress', { token, amount: 0 });
	const cancel = () => {
		active = false;
		approved = false;
		gestureSubscription.cancel();
		hide();
		token++;
	};
	const gestureSubscription = subscribe(({ phase, amount, x, y }) => {
		if (phase === 'begin') {
			active = false;
			approved = false;
			hide();
			token++;
			if (!isAvailable()) { gestureSubscription.cancel(); return; }
			active = true;
			const zoom = contents.getZoomFactor();
			contents.send('vscode:browserView:historySwipeStart', {
				token, x: x / zoom, y: y / zoom,
				canGoBack: contents.navigationHistory.canGoBack(),
				canGoForward: contents.navigationHistory.canGoForward(),
			});
			return;
		}
		if (!active) { return; }
		if (phase === 'cancel' || !isAvailable()) { cancel(); return; }
		if (phase === 'end' && !approved) { cancel(); return; }
		if (!approved || !Number.isFinite(amount)) { return; }
		const back = amount > 0;
		if (phase === 'update') {
			contents.send('vscode:browserView:historySwipeProgress', {
				token, amount: (back ? allowedBack : allowedForward) ? amount : 0,
			});
		} else if (phase === 'end') {
			active = false;
			hide();
			if (amount === 0) { return; }
			if (back) {
				if (!allowedBack) { return; }
				if (contents.navigationHistory.canGoBack()) {
					navigate('back');
				} else {
					// Closing tears down this subscription. Wait until the final native
					// callback has returned, then re-check that this gesture is current.
					const closing = token;
					clearTimeout(closeTimer);
					closeTimer = setTimeout(() => {
						closeTimer = undefined;
						if (closing === token) { navigate('close'); }
					}, 0);
				}
			} else if (allowedForward && contents.navigationHistory.canGoForward()) {
				navigate('forward');
			}
		}
	});
	const onAllow = (event: Electron.IpcMainEvent, requestToken: number, back: boolean, forward: boolean) => {
		if (event.senderFrame !== contents.mainFrame || requestToken !== token || !active || approved
			|| typeof back !== 'boolean' || typeof forward !== 'boolean') { return; }
		if (!isAvailable()) { cancel(); return; }
		allowedBack = back;
		allowedForward = forward && contents.navigationHistory.canGoForward();
		if (!allowedBack && !allowedForward) { cancel(); return; }
		approved = true;
		gestureSubscription.start(allowedBack, allowedForward, allowedBack && !contents.navigationHistory.canGoBack());
	};
	const onCancel = (event: Electron.IpcMainEvent, requestToken: number) => {
		if (event.senderFrame === contents.mainFrame && requestToken === token && active) { cancel(); }
	};
	const onNavigation = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
		if (details.isMainFrame) { cancel(); }
	};
	contents.on('blur', cancel);
	contents.on('did-start-navigation', onNavigation);
	contents.ipc.on('vscode:browserView:historySwipeAllow', onAllow);
	contents.ipc.on('vscode:browserView:historySwipeCancel', onCancel);
	return toDisposable(() => {
		clearTimeout(closeTimer);
		gestureSubscription.dispose();
		contents.removeListener('blur', cancel);
		contents.removeListener('did-start-navigation', onNavigation);
		contents.ipc.removeListener('vscode:browserView:historySwipeAllow', onAllow);
		contents.ipc.removeListener('vscode:browserView:historySwipeCancel', onCancel);
	});
}

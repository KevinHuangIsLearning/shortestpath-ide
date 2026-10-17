/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { EventEmitter } from 'events';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import type { ITrackpadGesture } from '../../electron-main/browserViewTrackpadGesture.js';
import { registerBrowserViewHistorySwipe } from '../../electron-main/browserViewHistorySwipe.js';

suite('BrowserView history swipe', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function setup() {
		let back = true;
		let forward = true;
		const messages: { channel: string; value: { token: number; amount?: number; x?: number; y?: number } }[] = [];
		const contents = Object.assign(new EventEmitter(), {
			ipc: new EventEmitter(), mainFrame: {}, getZoomFactor: () => 2,
			navigationHistory: { canGoBack: () => back, canGoForward: () => forward },
			send: (channel: string, value: typeof messages[number]['value']) => messages.push({ channel, value }),
		});
		let available = true;
		const navigations: string[] = [];
		const starts: boolean[][] = [];
		const gestures = new EventEmitter();
		store.add(registerBrowserViewHistorySwipe(contents as unknown as Electron.WebContents,
			() => available, direction => navigations.push(direction), listener => {
				gestures.on('gesture', listener);
				return {
					start: (back, forward) => { starts.push([back, forward]); }, cancel: () => { },
					dispose: () => { gestures.removeListener('gesture', listener); },
				};
			}));
		const token = () => messages.findLast(message => message.channel === 'vscode:browserView:historySwipeStart')!.value.token;
		return {
			contents, navigations, messages, starts, token,
			gesture: (phase: ITrackpadGesture['phase'], amount = 0) => gestures.emit('gesture', { phase, amount, x: 120, y: 80 } satisfies ITrackpadGesture),
			allow: (back = true, forward = true, mainFrame = true, requestToken = token()) => contents.ipc.emit('vscode:browserView:historySwipeAllow', { senderFrame: mainFrame ? contents.mainFrame : {} }, requestToken, back, forward),
			cancel: (mainFrame = true, requestToken = token()) => contents.ipc.emit('vscode:browserView:historySwipeCancel', { senderFrame: mainFrame ? contents.mainFrame : {} }, requestToken),
			setAvailable: (value: boolean) => { available = value; },
			setHistory: (canGoBack: boolean, canGoForward: boolean) => { back = canGoBack; forward = canGoForward; },
		};
	}

	test('uses CSS coordinates for the page eligibility check', () => {
		const view = setup();
		view.gesture('begin');
		assert.deepStrictEqual(view.messages.at(-1), { channel: 'vscode:browserView:historySwipeStart', value: { token: 1, x: 60, y: 40, canGoBack: true, canGoForward: true } });
	});

	test('navigation requires page approval and an AppKit successful release', () => {
		const view = setup();
		view.gesture('begin');
		view.gesture('update', 0.9);
		view.gesture('end', 0.9);
		view.allow();
		assert.deepStrictEqual([view.starts, view.navigations], [[], []]);
		view.gesture('begin');
		view.allow();
		view.gesture('update', 0.9);
		assert.deepStrictEqual(view.navigations, [], 'progress alone never navigates');
		view.gesture('end', 0.1);
		view.gesture('end', 0.1);
		assert.deepStrictEqual(view.navigations, ['back'], 'the system decides completion without a JS distance threshold');
	});

	test('system cancellation, reversal to zero and stale animation cannot navigate', () => {
		const view = setup();
		view.gesture('begin'); view.allow();
		view.gesture('update', 0.6); view.gesture('cancel'); view.gesture('end', 1);
		view.gesture('begin'); view.allow(); view.gesture('end', 0);
		assert.deepStrictEqual(view.navigations, []);
	});

	test('ignores subframes, stale and duplicate approvals', () => {
		const view = setup();
		view.gesture('begin');
		view.allow(true, true, false);
		view.allow(true, true, true, view.token() - 1);
		view.cancel(false);
		view.cancel(true, view.token() - 1);
		assert.deepStrictEqual(view.starts, []);
		view.allow(); view.allow();
		view.gesture('end', -0.4);
		assert.deepStrictEqual([view.starts, view.navigations], [[[true, true]], ['forward']]);
	});

	test('page can restrict each direction and cannot grant missing history', () => {
		const view = setup();
		view.gesture('begin'); view.allow(false, false); view.gesture('end', 0.5);
		view.setHistory(true, false);
		view.gesture('begin'); view.allow(); view.gesture('end', -0.5);
		view.gesture('begin'); view.allow(true, false); view.gesture('end', 0.5);
		assert.deepStrictEqual([view.starts, view.navigations], [[[true, false], [true, false]], ['back']]);
	});

	test('rechecks visibility at release and ignores backward swipes without history', () => {
		const view = setup();
		view.gesture('begin'); view.allow(); view.setAvailable(false); view.gesture('end', 0.5);
		assert.deepStrictEqual(view.navigations, [], 'an unavailable view never navigates');
		view.setAvailable(true);
		view.gesture('begin'); view.allow(); view.setHistory(false, false); view.gesture('end', 0.5);
		assert.deepStrictEqual(view.navigations, [], 'a backward swipe without history is ignored');
	});

	test('a page that rejects the backward swipe never navigates', () => {
		const view = setup();
		view.gesture('begin'); view.allow(false, false); view.gesture('end', 0.5);
		assert.deepStrictEqual(view.navigations, []);
	});

	test('a swipe without history never starts tracking', () => {
		const view = setup();
		view.setHistory(false, false);
		view.gesture('begin'); view.gesture('update', 0.5); view.gesture('end', 0.5);
		assert.deepStrictEqual([view.starts, view.navigations], [[], []], 'a page with no history ignores the gesture');
	});

	test('blur, main frame navigation and page cancellation invalidate the gesture', () => {
		for (const event of ['blur', 'did-start-navigation', 'page']) {
			const view = setup();
			view.gesture('begin'); view.allow();
			if (event === 'page') { view.cancel(); }
			else { view.contents.emit(event, { isMainFrame: true }); }
			view.gesture('end', 0.5);
			assert.deepStrictEqual(view.navigations, []);
		}
	});

	test('subframe navigation preserves the active swipe', () => {
		const view = setup();
		view.gesture('begin'); view.allow();
		view.contents.emit('did-start-navigation', { isMainFrame: false });
		view.gesture('end', 0.5);
		assert.deepStrictEqual(view.navigations, ['back']);
	});

	test('removes all listeners on disposal', () => {
		const contents = Object.assign(new EventEmitter(), { ipc: new EventEmitter(), mainFrame: {} });
		const listener = registerBrowserViewHistorySwipe(contents as unknown as Electron.WebContents, () => true, () => { }, () => ({ start() { }, cancel() { }, dispose() { } }));
		listener.dispose();
		assert.deepStrictEqual([contents.eventNames(), contents.ipc.eventNames()], [[], []]);
	});
});

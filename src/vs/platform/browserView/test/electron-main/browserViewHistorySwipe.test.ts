/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { EventEmitter } from 'events';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import type { ITrackpadPhase } from '../../electron-main/browserViewTrackpadGesture.js';
import { registerBrowserViewHistorySwipe } from '../../electron-main/browserViewHistorySwipe.js';

suite('BrowserView history swipe', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function setup() {
		let back = true;
		let forward = true;
		const messages: { channel: string; value: { token: number } | number }[] = [];
		const contents = Object.assign(new EventEmitter(), {
			ipc: new EventEmitter(), mainFrame: {},
			navigationHistory: { canGoBack: () => back, canGoForward: () => forward },
			send: (channel: string, value: { token: number } | number) => messages.push({ channel, value }),
		});
		let time = 0;
		let available = true;
		const navigations: string[] = [];
		const phases = new EventEmitter();
		store.add(registerBrowserViewHistorySwipe(contents as unknown as Electron.WebContents,
			() => available, direction => navigations.push(direction), listener => {
				phases.on('phase', listener);
				return toDisposable(() => phases.removeListener('phase', listener));
			}));
		const token = () => (messages.findLast(message => message.channel === 'vscode:browserView:historySwipeState')!.value as { token: number }).token;
		return {
			contents, navigations, messages, token,
			input: (type: string, gap = 10) => {
				time += gap;
				const phase = ({ gestureScrollBegin: 'begin', gestureScrollEnd: 'end', gestureFlingStart: 'end' } as Record<string, ITrackpadPhase['phase']>)[type];
				if (phase) { phases.emit('phase', { phase, timestamp: time }); }
			},
			swipe: (direction: string, mainFrame = true, requestToken = token()) => contents.ipc.emit('vscode:browserView:historySwipe', { senderFrame: mainFrame ? contents.mainFrame : {} }, direction, requestToken),
			setAvailable: (value: boolean) => { available = value; },
			setHistory: (canGoBack: boolean, canGoForward: boolean) => { back = canGoBack; forward = canGoForward; },
		};
	}

	test('requires native release even after a pause while fingers remain down', () => {
		const view = setup();
		view.input('mouseWheel');
		view.input('gestureScrollBegin');
		const token = view.token();
		view.swipe('back');
		view.input('mouseWheel', 2000);
		view.swipe('back');
		assert.deepStrictEqual([view.token(), view.navigations], [token, []]);
		view.input('gestureScrollEnd');
		assert.deepStrictEqual(view.navigations, []);
		view.swipe('back');
		view.swipe('back');
		assert.deepStrictEqual(view.navigations, ['back']);
	});

	test('suppresses momentum after release and permits the next gesture', () => {
		const view = setup();
		view.input('mouseWheel');
		view.input('gestureScrollBegin');
		view.input('gestureFlingStart');
		view.swipe('back');
		for (let i = 0; i < 20; i++) {
			view.input('mouseWheel', 100);
			view.swipe('back');
		}
		view.input('gestureScrollEnd');
		view.input('mouseWheel', 300);
		view.input('gestureScrollBegin');
		view.input('gestureScrollEnd');
		view.swipe('forward');
		assert.deepStrictEqual(view.navigations, ['back', 'forward']);
	});

	test('rejects invalid directions, stale tokens, subframes and unavailable history', () => {
		const view = setup();
		view.input('mouseWheel');
		view.input('gestureScrollBegin');
		view.input('gestureScrollEnd');
		view.swipe('invalid');
		view.swipe('back', false);
		view.swipe('back', true, view.token() - 1);
		view.setAvailable(false);
		view.swipe('back');
		view.setAvailable(true);
		view.setHistory(false, false);
		view.swipe('back');
		view.swipe('forward');
		assert.deepStrictEqual(view.navigations, []);
	});

	test('cancels release on blur or navigation', () => {
		for (const event of ['blur', 'did-start-navigation']) {
			const view = setup();
			view.input('mouseWheel');
			view.input('gestureScrollBegin');
			const token = view.token();
			view.contents.emit(event, { isMainFrame: true });
			view.input('gestureScrollEnd');
			view.swipe('back', true, token);
			assert.deepStrictEqual(view.navigations, []);
		}
	});

	test('subframe navigation preserves the active swipe', () => {
		const view = setup();
		view.input('gestureScrollBegin');
		const token = view.token();
		view.contents.emit('did-start-navigation', { isMainFrame: false });
		assert.strictEqual(view.token(), token);
		view.input('gestureScrollEnd');
		view.swipe('back');
		assert.deepStrictEqual(view.navigations, ['back']);
	});

	test('removes all listeners on disposal', () => {
		const contents = Object.assign(new EventEmitter(), { ipc: new EventEmitter(), mainFrame: {} });
		const listener = registerBrowserViewHistorySwipe(contents as unknown as Electron.WebContents, () => true, () => { }, () => toDisposable(() => { }));
		listener.dispose();
		assert.deepStrictEqual([contents.eventNames(), contents.ipc.eventNames()], [[], []]);
	});
});

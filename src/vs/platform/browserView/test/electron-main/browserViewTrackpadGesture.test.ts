/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ITrackpadGesture, ITrackpadGestureMonitor, registerBrowserViewTrackpadGesture } from '../../electron-main/browserViewTrackpadGesture.js';

suite('BrowserView AppKit gesture routing', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function setup() {
		let callback: Parameters<ITrackpadGestureMonitor['subscribe']>[0];
		let available = true;
		const events: ITrackpadGesture[] = [];
		const calls: (number | boolean | string)[][] = [];
		const host = { isDestroyed: () => false, getNativeWindowHandle: () => Buffer.alloc(8) };
		const native: ITrackpadGestureMonitor = {
			subscribe: listener => { callback = listener; return 7; },
			start: (...args) => { calls.push(['start', ...args]); },
			cancel: id => { calls.push(['cancel', id]); },
			unsubscribe: id => { calls.push(['unsubscribe', id]); },
			pointForWindow: (_handle, window, x, y) => window === 42 ? { x, y } : undefined,
		};
		const subscription = store.add(registerBrowserViewTrackpadGesture(
			() => host as unknown as Electron.BrowserWindow, () => ({ x: 10, y: 20, width: 100, height: 200 }),
			() => available, event => events.push(event), native));
		return {
			events, calls, subscription,
			input: (phase: ITrackpadGesture['phase'], gesture = 1, amount = 0, window = 42, x = 15, y = 25) => callback(phase, window, x, y, gesture, amount),
			setAvailable: (value: boolean) => { available = value; },
		};
	}

	test('routes local coordinates and starts only the matching native gesture', () => {
		const view = setup();
		view.input('begin');
		view.subscription.start(true, false);
		view.input('update', 0, 0.9);
		view.input('update', 1, 0.15);
		view.input('end', 1, 0.4);
		view.input('update', 1, 1);
		view.subscription.start(true, true);
		assert.deepStrictEqual([view.calls, view.events], [
			[['start', 7, 1, true, false]],
			[{ phase: 'begin', amount: 0, x: 5, y: 5 }, { phase: 'update', amount: 0.15, x: 0, y: 0 }, { phase: 'end', amount: 0.4, x: 0, y: 0 }],
		]);
	});

	test('ignores gestures in other windows and outside the view', () => {
		const view = setup();
		view.input('begin', 1, 0, 99);
		view.input('begin', 2, 0, 42, 110, 25);
		view.subscription.start(true, true);
		assert.deepStrictEqual([view.calls, view.events], [[], []]);
	});

	test('new gestures elsewhere cancel the old hint and reject its later callbacks', () => {
		const view = setup();
		view.input('begin');
		view.input('begin', 2, 0, 99);
		view.input('end', 1, 1);
		assert.deepStrictEqual(view.events, [{ phase: 'begin', amount: 0, x: 5, y: 5 }, { phase: 'cancel', amount: 0, x: 0, y: 0 }]);
	});

	test('hiding the view cancels native tracking', () => {
		const view = setup();
		view.input('begin');
		view.setAvailable(false);
		view.input('update', 1, 0.5);
		view.input('end', 1, 1);
		assert.deepStrictEqual([view.calls, view.events.at(-1)], [[['cancel', 7]], { phase: 'cancel', amount: 0, x: 0, y: 0 }]);
	});

	test('cancel and dispose reject further callbacks and starts', () => {
		const view = setup();
		view.input('begin'); view.subscription.cancel(); view.input('end', 1, 1);
		view.subscription.dispose(); view.subscription.dispose();
		view.input('begin', 2); view.subscription.start(true, true);
		assert.deepStrictEqual([view.calls, view.events.length], [[['cancel', 7], ['unsubscribe', 7]], 1]);
	});
});

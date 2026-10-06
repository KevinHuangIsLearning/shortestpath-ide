/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ShortestPathBrowserOverlay } from '../../browser/shortestPathBrowserOverlay.js';

suite('ShortestPath browser overlay', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function setup() {
		const page = $('.shortestpath-browser-page');
		const captured = new DeferredPromise<VSBuffer>();
		const painted = new DeferredPromise<void>();
		const events: string[] = [];
		const model = {
			visible: true,
			captureScreenshot: () => { events.push('capture'); return captured.p; },
			setVisible: async (visible: boolean) => { events.push(`visible:${visible}`); model.visible = visible; }
		};
		const overlay = store.add(new ShortestPathBrowserOverlay(page, async () => {
			assert.ok(page.style.backgroundImage.includes('base64'));
			events.push('paint');
			await painted.p;
		}));
		return { page, captured, painted, events, model, overlay };
	}

	test('keeps the live page until its replacement frame has painted, and coalesces repeated refreshes', async () => {
		const { page, captured, painted, events, model, overlay } = setup();
		const first = overlay.update(model, true);
		assert.strictEqual(overlay.update(model, true), first);
		assert.deepStrictEqual(events, ['capture']);
		await captured.complete(VSBuffer.fromString('page frame'));
		assert.deepStrictEqual({ events, visible: model.visible }, { events: ['capture', 'paint'], visible: true });
		await painted.complete();
		await first;
		assert.deepStrictEqual(events, ['capture', 'paint', 'visible:false']);
		await overlay.update(model, true);
		await overlay.update(model, false);
		assert.ok(page.style.backgroundImage.includes('base64'), 'retain the frame until the live page is restored');
		assert.deepStrictEqual(events, ['capture', 'paint', 'visible:false']);
	});

	for (const phase of ['capture', 'paint'] as const) {
		for (const change of ['leave', 'switch', 'dispose'] as const) {
			test(`${change} during ${phase} prevents a stale capture from hiding the page`, async () => {
				const { captured, painted, events, model, overlay } = setup();
				const task = overlay.update(model, true);
				if (phase === 'paint') { await captured.complete(VSBuffer.fromString('page frame')); }
				if (change === 'dispose') { overlay.dispose(); }
				else { await overlay.update(change === 'leave' ? model : undefined, false); }
				if (phase === 'capture') { await captured.complete(VSBuffer.fromString('page frame')); }
				await painted.complete();
				await task;
				assert.deepStrictEqual({ visible: model.visible, hidden: events.includes('visible:false') }, { visible: true, hidden: false });
			});
		}
	}

	test('capture failure retains the live page', async () => {
		const { captured, model, overlay } = setup();
		const task = overlay.update(model, true);
		await captured.error(new Error('No Chromium frame yet'));
		await task;
		assert.strictEqual(model.visible, true);
	});

	test('a failed image decode retains the live page', async () => {
		const { captured, painted, model, overlay } = setup();
		const task = overlay.update(model, true);
		await captured.complete(VSBuffer.fromString('page frame'));
		await painted.error(new Error('Invalid image'));
		await task;
		assert.strictEqual(model.visible, true);
	});
});

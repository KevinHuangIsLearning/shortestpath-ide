/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const source = (name: string) => fs.readFileSync(path.join(__dirname, `../${name}.js`), 'utf8');

test('section updates retain reader nodes, including duplicate content and an in-flight paint, but replace changed content', () => {
	class Reader {
		readonly dataset: { readerId: string };
		constructor(id: string, readonly surface = {}) { this.dataset = { readerId: id }; }
		replaceWith(previous: Reader): void { next.splice(next.indexOf(this), 1, previous); }
	}
	const first = new Reader('same');
	const duplicate = new Reader('same');
	const active = new Reader('painting', { stage: 'temporary paint' });
	let current = [first, duplicate, active, new Reader('old-content')];
	let next: Reader[] = [];
	const section = {
		querySelectorAll: () => current,
		replaceChildren: () => { current = next; },
	};
	const template = {
		set innerHTML(ids: string) { next = ids.split(',').map(id => new Reader(id)); },
		content: { querySelectorAll: () => next.slice() },
	};
	const compiled = source('problemView');
	const start = compiled.indexOf('const replaceSectionContent =');
	const end = compiled.indexOf('const snapshotSubmissionHeights', start);
	const replace = vm.runInNewContext(`${compiled.slice(start, end)}; replaceSectionContent`, {
		document: { createElement: () => template },
	}) as (target: typeof section, html: string) => void;
	replace(section, 'same,same,same,painting,new-content');
	assert.equal(current[0], first);
	assert.equal(current[1], duplicate);
	assert.notEqual(current[2], first);
	assert.notEqual(current[2], duplicate);
	assert.equal(current[3], active);
	const changed = current[4];
	replace(section, 'same,same,same,painting,new-content');
	assert.equal(current[4], changed);
	assert.equal(current[3].surface, active.surface);
});

function createQueue() {
	const frames: (() => Promise<void>)[] = [];
	const painted: Surface[] = [];
	const reader = { ready: false };
	const rendered = new WeakMap<Surface, string>();
	const pendingPaint = new Set<Surface>();
	let finishPaint = () => { };
	class Surface {
		dataset = { readerMode: 'canvas' };
		clientWidth = 600;
		isConnected = true;
		hidden = false;
		top = 0;
		getBoundingClientRect() { return { top: this.top, bottom: this.top + 100 }; }
		closest() { return this.hidden ? {} : null; }
	}
	const context = vm.createContext({
		reader, rendered, pendingPaint, painting: false, paintFrame: 0,
		themeRevision: 0, keyRevision: 0, devicePixelRatio: 1, innerHeight: 800,
		requestAnimationFrame: (callback: typeof frames[number]) => { frames.push(callback); return 1; },
		paint: (element: Surface) => {
			painted.push(element);
			return new Promise<void>(resolve => { finishPaint = resolve; });
		},
	});
	const compiled = source('protectedReaderView');
	const start = compiled.indexOf('function paintRevision(');
	const end = compiled.indexOf('function applyEditorTheme(', start);
	vm.runInContext(compiled.slice(start, end), context);
	return {
		Surface, reader, rendered, painted, frames, context,
		schedule: (element: Surface) => context.schedulePaint(element),
		frame: () => frames.shift()!(),
		finish: () => finishPaint(),
	};
}

test('reader waits for its key without reordering content and yields between deduplicated paints', async () => {
	const view = createQueue();
	const first = new view.Surface(); const second = new view.Surface();
	view.schedule(first); view.schedule(second); view.schedule(first);
	await view.frame();
	assert.deepEqual(view.painted, []);
	view.reader.ready = true; view.schedule(first);
	const firstFrame = view.frame();
	assert.deepEqual(view.painted, [first]);
	view.schedule(second);
	assert.equal(view.frames.length, 0);
	view.finish(); await firstFrame;
	assert.equal(view.frames.length, 1);
	const secondFrame = view.frame();
	assert.deepEqual(view.painted, [first, second]);
	view.finish(); await secondFrame;
	assert.equal(view.frames.length, 0);
});

test('reader skips distant, hidden and detached surfaces until they become readable', async () => {
	const view = createQueue(); view.reader.ready = true;
	const distant = new view.Surface(); distant.top = 1500;
	const hidden = new view.Surface(); hidden.hidden = true;
	const detached = new view.Surface(); detached.isConnected = false;
	for (const element of [distant, hidden, detached]) { view.schedule(element); }
	await view.frame();
	assert.deepEqual(view.painted, []);
	distant.top = 700; view.schedule(distant);
	const frame = view.frame();
	assert.deepEqual(view.painted, [distant]);
	view.finish(); await frame;
});

test('reader reuses an unchanged bitmap and invalidates width, theme, key and pixel ratio changes', async () => {
	const view = createQueue(); view.reader.ready = true;
	const element = new view.Surface();
	for (const change of [() => { element.clientWidth++; }, () => { view.context.themeRevision++; }, () => { view.context.keyRevision++; }, () => { view.context.devicePixelRatio++; }]) {
		view.rendered.set(element, view.context.paintRevision(element));
		view.schedule(element); await view.frame();
		const count = view.painted.length;
		change(); view.schedule(element);
		const frame = view.frame();
		assert.equal(view.painted.length, count + 1);
		view.finish(); await frame;
	}
});

test('ordinary DOM reflows without decrypting or rebuilding on resize', async () => {
	const view = createQueue(); view.reader.ready = true;
	const element = new view.Surface(); element.dataset.readerMode = 'dom';
	view.rendered.set(element, view.context.paintRevision(element));
	element.clientWidth = 300; view.context.devicePixelRatio = 2;
	view.schedule(element); await view.frame();
	assert.deepEqual(view.painted, []);
	view.context.themeRevision++;
	view.schedule(element); const frame = view.frame();
	assert.deepEqual(view.painted, [element]);
	view.finish(); await frame;
});

test('deferred highlighting preserves a user selection and discards stale theme results', async () => {
	const compiled = source('protectedReaderView');
	const start = compiled.indexOf('async function highlightNextCode(');
	const end = compiled.indexOf('const codeVisibility =', start);
	for (const scenario of ['normal', 'selected', 'theme-changed']) {
		let revision = 'current'; let replacements = 0;
		const pre = { isConnected: true, textContent: 'int n;', dataset: { readerLanguage: 'cpp' }, replaceWith() { replacements++; } };
		const owner = { element: {}, revision };
		const context = vm.createContext({
			pendingCode: new Set([pre]), codeOwners: new WeakMap([[pre, owner]]), highlighting: false,
			reader: { ready: true }, paintRevision: () => revision,
			requestAnimationFrame: (callback: () => void) => callback(), setTimeout,
			renderMarkdown: { highlight: async () => { if (scenario === 'theme-changed') { revision = 'new'; } return '<pre>highlighted</pre>'; } },
			window: { getSelection: () => ({ isCollapsed: scenario !== 'selected', rangeCount: 1, getRangeAt: () => ({ intersectsNode: () => true }) }) },
			document: { createElement: () => ({ content: { querySelector: () => ({ style: {} }) } }) },
			getComputedStyle: () => ({ margin: '14px 0' }),
		});
		vm.runInContext(compiled.slice(start, end), context);
		await context.highlightNextCode();
		assert.equal(replacements, scenario === 'normal' ? 1 : 0);
	}
});

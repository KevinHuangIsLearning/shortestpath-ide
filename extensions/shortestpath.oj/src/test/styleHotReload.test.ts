/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

function createView() {
	const links: Link[] = [];
	let message: (event: { data: object }) => void = () => {};
	class Link {
		id = 'oj-main-styles';
		href = 'https://resource.vscode-cdn.net/problemView.css?existing=1';
		private readonly listeners = new Map<string, () => void>();
		cloneNode(): Link { return Object.assign(new Link(), { id: this.id, href: this.href }); }
		removeAttribute(): void { this.id = ''; }
		addEventListener(name: string, callback: () => void): void { this.listeners.set(name, callback); }
		after(next: Link): void { links.splice(links.indexOf(this) + 1, 0, next); }
		remove(): void { const index = links.indexOf(this); if (index >= 0) { links.splice(index, 1); } }
		replaceWith(next: Link): void { next.remove(); links.splice(links.indexOf(this), 1, next); }
		emit(name: string): void { this.listeners.get(name)?.(); }
	}
	const original = new Link();
	links.push(original);
	vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../styleHotReload.js'), 'utf8'), {
		URL,
		window: { addEventListener: (_name: string, callback: typeof message) => { message = callback; } },
		document: { querySelector: () => links.find(link => link.id === 'oj-main-styles') },
	});
	return { links, original, reload: (version: number) => message({ data: { type: 'reloadStyles', version } }) };
}

test('style reload retains the current stylesheet until the new resource loads', () => {
	const view = createView();
	view.reload(1);
	assert.equal(view.links[0], view.original);
	const replacement = view.links[1];
	replacement.emit('load');
	assert.deepStrictEqual(view.links.map(link => ({ id: link.id, href: link.href })), [
		{ id: 'oj-main-styles', href: 'https://resource.vscode-cdn.net/problemView.css?existing=1&styleVersion=1' },
	]);
});

test('rapid saves discard superseded loads and a failed reload retains the current stylesheet', () => {
	const view = createView();
	view.reload(1);
	const superseded = view.links[1];
	view.reload(2);
	const latest = view.links[1];
	superseded.emit('load');
	assert.deepStrictEqual(view.links, [view.original, latest]);
	latest.emit('error');
	assert.deepStrictEqual(view.links, [view.original]);
	view.reload(3);
	view.links[1].emit('load');
	assert.equal(new URL(view.links[0].href).searchParams.get('styleVersion'), '3');
});

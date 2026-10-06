/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

test('rating updates retain keyboard focus and confirmation overlays preserve the original return focus', () => {
	let active: FakeElement | null = null;
	class FakeElement {
		hidden = true;
		isConnected = true;
		disabled = false;
		dataset: { command?: string; rating?: string } = {};
		children: FakeElement[] = [];
		classList = { toggle() { }, add() { }, remove() { }, contains: () => false };
		contains(element: FakeElement | null): boolean { return element !== null && (element === this || this.children.includes(element)); }
		querySelector(): FakeElement | undefined { return this.children[0]; }
		querySelectorAll(): FakeElement[] { return this.children.filter(child => !child.disabled); }
		focus(): void { active = this; }
		addEventListener() { }
		appendChild(element: FakeElement): void { this.children.push(element); }
		set innerHTML(_value: string) { this.children = []; }
	}
	const overlay = new FakeElement();
	const confirm = new FakeElement();
	const outside = new FakeElement();
	const button = (command: string, rating?: string) => {
		const element = new FakeElement(); element.dataset = { command, rating }; return element;
	};
	const queued: (() => void)[] = [];
	const keydowns: ((event: { key: string; shiftKey?: boolean; preventDefault(): void }) => void)[] = [];
	const document = {
		get activeElement() { return active; },
		getElementById: (id: string) => id === 'oj-modal-overlay' ? confirm : id === 'oj-rating-overlay' ? overlay : null,
		addEventListener: (type: string, listener: typeof keydowns[number]) => { if (type === 'keydown') { keydowns.push(listener); } },
	};
	const source = fs.readFileSync(path.resolve(__dirname, '../problemView.js'), 'utf8');
	const start = source.indexOf('/* ---- Modal infrastructure ---- */');
	const end = source.indexOf('/* ---- Submission collapse/expand animation ---- */', start);
	const context = vm.createContext({
		document, window: { addEventListener() { } }, HTMLElement: FakeElement, HTMLButtonElement: FakeElement,
		vscode: { postMessage() { } }, setTimeout: (callback: () => void) => { queued.push(callback); },
	});
	vm.runInContext(`${source.slice(start, end)}; globalThis.sync = syncRatingDialog; globalThis.remember = rememberRatingFocus; globalThis.show = showModal; globalThis.close = closeModal;`, context);
	outside.focus();
	overlay.children = [button('dismissRating'), button('rateProblem', 'good'), button('rateProblem', 'bad')];
	context.sync();
	overlay.children[1].focus();
	context.remember();
	// GET and failed PUT replace the whole dialog while it remains open.
	active!.isConnected = false;
	active = null;
	overlay.children = [button('dismissRating'), button('rateProblem', 'good'), button('rateProblem', 'bad')];
	context.sync();
	assert.equal(active, overlay.children[1]);
	// Saving disables the rating options; focus must still stay in the dialog.
	context.remember(); active = null;
	overlay.children[1].disabled = true; overlay.children[2].disabled = true;
	context.sync();
	assert.equal(active, overlay.children[0]);
	// A Tab from outside must enter the dialog, even after an unexpected focus loss.
	active = outside;
	keydowns[0]({ key: 'Tab', preventDefault() { } });
	assert.equal(active, overlay.children[0]);
	context.show(button('confirm'));
	confirm.children[0].focus();
	assert.equal(overlay.hidden, true);
	context.close(); queued.forEach(callback => callback());
	assert.equal(overlay.hidden, false);
	overlay.children = [];
	context.sync();
	assert.equal(active, outside);
});

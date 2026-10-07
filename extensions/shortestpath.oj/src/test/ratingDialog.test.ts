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

test('header rating refresh keeps keyboard focus inside the popover without stealing outside focus', () => {
	let active: Button | null = null;
	let visible = false;
	class Button {
		constructor(readonly dataset: { command?: string; rating?: string }, readonly disabled = false) { }
		focus(): void {
			if (this.dataset.command && !visible) { return; }
			active = this;
			visible = buttons.includes(this);
		}
	}
	const outside = new Button({});
	let buttons: Button[] = [];
	const anchor = {};
	const section = {
		contains: (element: Button | null) => buttons.includes(element!),
		querySelectorAll: () => buttons.filter(button => !button.disabled),
		querySelector: () => anchor,
		set innerHTML(html: string) {
			if (buttons.includes(active!)) { active = null; visible = false; }
			buttons = [new Button({}), new Button({ command: 'rateProblem', rating: 'good' }, html === 'saving'), new Button({ command: 'rateProblem', rating: 'bad' }, html === 'saving')];
		},
	};
	let positioned = 0;
	const source = fs.readFileSync(path.resolve(__dirname, '../problemView.js'), 'utf8');
	const start = source.indexOf('for (const [id, html] of Object.entries(message.sections))');
	const end = source.indexOf('const updatedLocalTests', start);
	const context = vm.createContext({
		document: { get activeElement() { return active; }, getElementById: () => section },
		HTMLButtonElement: Button,
		updateRatingSection: () => false,
		snapshotSection: () => ({}), restoreSection() { },
		updateTagPopoverDirection: (target: object) => { assert.equal(target, anchor); positioned++; },
		animateHeightChange: () => { throw new Error('Header updates must not animate their height'); },
	});
	const update = (html: string) => {
		context.message = { sections: { 'oj-rating': html } };
		vm.runInContext(source.slice(start, end), context);
	};
	section.innerHTML = 'ready';
	buttons[0].focus();
	buttons[2].focus();
	update('ready');
	assert.equal(active, buttons[2]);
	update('saving');
	assert.equal(active, buttons[0]);
	update('ready');
	assert.equal(active, buttons[0]);
	outside.focus();
	update('ready');
	assert.deepEqual({ active, positioned }, { active: outside, positioned: 4 });
});

test('saving, success and failure patch rating controls without replacing the focused button', () => {
	class Element {
		readonly values = new Map<string, string>();
		textContent = '';
		lastElementChild = { textContent: '3' };
		dataset = { rating: 'good' };
		get disabled(): boolean { return this.values.has('disabled'); }
		get attributes() { return [...this.values].map(([name, value]) => ({ name, value })); }
		getAttributeNames(): string[] { return [...this.values.keys()]; }
		hasAttribute(name: string): boolean { return this.values.has(name); }
		getAttribute(name: string): string | null { return this.values.get(name) ?? null; }
		setAttribute(name: string, value: string): void { this.values.set(name, value); }
		removeAttribute(name: string): void { this.values.delete(name); }
	}
	const button = new Element();
	const retry = new Element();
	const status = new Element();
	const options = new Element();
	const error = { outerHTML: '<p class="error">Failed</p>', contains: (element: Element | null) => element === retry, remove() { currentError = undefined; } };
	let currentError: typeof error | undefined;
	const summary: Element & { focus(): void } = Object.assign(new Element(), { focus() { document.activeElement = summary; } });
	const section = {
		querySelector: (selector: string) => selector === '.rating-options' ? options : selector === '.rating-status' ? status : selector === '.error' ? currentError : summary,
	};
	const current = Object.assign(options, { querySelectorAll: () => [button] });
	Object.assign(status, { after: (value: typeof error) => { currentError = value; } });
	const saving = new Element(); saving.setAttribute('aria-disabled', 'true');
	const success = new Element(); success.lastElementChild.textContent = '4'; success.setAttribute('aria-pressed', 'true');
	const failure = new Element(); failure.lastElementChild.textContent = '4'; failure.setAttribute('aria-pressed', 'true');
	const states = new Map([
		['saving', { button: saving, status: 'Saving', error: undefined, busy: 'true' }],
		['success', { button: success, status: 'Rated', error: undefined, busy: 'false' }],
		['failure', { button: failure, status: 'Rated', error, busy: 'false' }],
	]);
	let next = states.get('saving')!;
	const template = {
		set innerHTML(html: string) { next = states.get(html)!; },
		content: { querySelector: (selector: string) => {
			if (selector === '.rating-options') {
				const group = new Element(); group.setAttribute('aria-busy', next.busy);
				return Object.assign(group, { querySelectorAll: () => [next.button] });
			}
			return selector === '.rating-status' ? { textContent: next.status } : next.error;
		} },
	};
	const source = fs.readFileSync(path.resolve(__dirname, '../problemView.js'), 'utf8');
	const start = source.indexOf('/* ---- Rating updates ---- */');
	const end = source.indexOf('/* ---- Hint countdown ---- */', start);
	const document = { activeElement: button, createElement: () => template };
	const context = vm.createContext({ document });
	vm.runInContext(`${source.slice(start, end)}; globalThis.update = updateRatingSection;`, context);
	for (const state of ['saving', 'success', 'failure', 'success']) {
		assert.equal(context.update(section, state), true);
		assert.equal(current.querySelectorAll()[0], button);
		assert.equal(document.activeElement, button);
		assert.equal(button.disabled, false);
		assert.equal(button.getAttribute('aria-disabled'), state === 'saving' ? 'true' : null);
	}
	assert.deepEqual({ count: button.lastElementChild.textContent, selected: button.getAttribute('aria-pressed'), status: status.textContent, busy: options.getAttribute('aria-busy'), error: currentError }, {
		count: '4', selected: 'true', status: 'Rated', busy: 'false', error: undefined,
	});
	context.update(section, 'failure');
	document.activeElement = retry;
	context.update(section, 'saving');
	assert.deepEqual({ focus: document.activeElement, error: currentError }, { focus: summary, error: undefined });
});

test('header popovers stay inside both viewport edges after wrapping or resizing', () => {
	const source = fs.readFileSync(path.resolve(__dirname, '../problemView.js'), 'utf8');
	const start = source.indexOf('const updateTagPopoverDirection');
	const end = source.indexOf("document.addEventListener('pointerover'", start);
	let opensRight = false;
	let shift = '';
	let resize!: () => void;
	const bounds = { left: 176, right: 258 };
	const popover = { offsetWidth: 280 };
	const anchor = {
		querySelector: () => popover,
		getBoundingClientRect: () => bounds,
		classList: { toggle: (_name: string, value: boolean) => { opensRight = value; } },
		style: { getPropertyValue: () => shift, setProperty: (_name: string, value: string) => { shift = value; } },
	};
	const window = { innerWidth: 320, addEventListener: (_type: string, callback: () => void) => { resize = callback; } };
	const context = vm.createContext({ window, document: { querySelectorAll: () => [anchor] } });
	vm.runInContext(`${source.slice(start, end)}; globalThis.position = updateTagPopoverDirection;`, context);
	const position = () => {
		const left = (opensRight ? bounds.left : bounds.right - popover.offsetWidth) + parseFloat(shift);
		return { left, right: left + popover.offsetWidth };
	};
	context.position(anchor);
	assert.deepEqual(position(), { left: 28, right: 308 });
	window.innerWidth = 240;
	bounds.left = 4; bounds.right = 86; popover.offsetWidth = 216;
	resize();
	assert.deepEqual(position(), { left: 12, right: 228 });
	window.innerWidth = 800;
	bounds.left = 500; bounds.right = 582; popover.offsetWidth = 280;
	resize();
	assert.deepEqual(position(), { left: 302, right: 582 });
});

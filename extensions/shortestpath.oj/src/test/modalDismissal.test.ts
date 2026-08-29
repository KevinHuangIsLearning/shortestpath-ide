/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import * as vm from 'node:vm';

type Listener = (event: { data?: object; key?: string; target?: FakeElement }) => void;

class FakeClassList {
	private readonly values = new Set<string>();

	add(value: string): void {
		this.values.add(value);
	}

	remove(value: string): void {
		this.values.delete(value);
	}

	contains(value: string): boolean {
		return this.values.has(value);
	}
}

class FakeElement {
	readonly classList = new FakeClassList();
	readonly listeners = new Map<string, Listener[]>();
	readonly selectors = new Map<string, FakeElement>();
	className = '';
	hidden = true;
	textContent = '';

	set innerHTML(value: string) {
		this.selectors.clear();
		if (value.includes('confirm-actions')) {
			this.selectors.set('.confirm-message', new FakeElement());
			this.selectors.set('.cancel-btn', new FakeElement());
			this.selectors.set('.confirm-btn', new FakeElement());
		}
	}

	get offsetHeight(): number {
		return 0;
	}

	addEventListener(type: string, listener: Listener): void {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	appendChild(child: FakeElement): FakeElement {
		for (const [selector, element] of child.selectors) {
			this.selectors.set(selector, element);
		}
		return child;
	}

	querySelector(selector: string): FakeElement | null {
		return this.selectors.get(selector) ?? null;
	}

	focus(): void { }

	click(): void {
		this.dispatch('click');
	}

	dispatch(type: string, event: { data?: object; key?: string; target?: FakeElement } = {}): void {
		for (const listener of this.listeners.get(type) ?? []) {
			listener({ ...event, target: event.target ?? this });
		}
	}
}

type ConfirmResult = {
	command: string;
	confirmId: string;
	result: boolean;
};

function createModalHarness(): {
	document: { dispatch(type: string, event: { key: string }): void };
	overlay: FakeElement;
	postedMessages: ConfirmResult[];
	window: { dispatch(type: string, event: { data: object }): void };
} {
	const compiledSource = fs.readFileSync(path.resolve(__dirname, '../problemView.js'), 'utf8');
	const start = compiledSource.indexOf('/* ---- Modal infrastructure ---- */');
	const end = compiledSource.indexOf('/* ---- Hint modal ---- */', start);
	assert.notEqual(start, -1);
	assert.notEqual(end, -1);

	const overlay = new FakeElement();
	const documentListeners = new Map<string, Listener[]>();
	const windowListeners = new Map<string, Listener[]>();
	const postedMessages: ConfirmResult[] = [];
	const document = {
		getElementById: (id: string) => id === 'oj-modal-overlay' ? overlay : null,
		createElement: () => new FakeElement(),
		addEventListener: (type: string, listener: Listener) => {
			const listeners = documentListeners.get(type) ?? [];
			listeners.push(listener);
			documentListeners.set(type, listeners);
		},
		dispatch: (type: string, event: { key: string }) => {
			for (const listener of documentListeners.get(type) ?? []) {
				listener(event);
			}
		},
	};
	const window = {
		addEventListener: (type: string, listener: Listener) => {
			const listeners = windowListeners.get(type) ?? [];
			listeners.push(listener);
			windowListeners.set(type, listeners);
		},
		dispatch: (type: string, event: { data: object }) => {
			for (const listener of windowListeners.get(type) ?? []) {
				listener(event);
			}
		},
	};
	const context = vm.createContext({
		countdownRenderedAt: Date.now(),
		document,
		Element: FakeElement,
		HTMLElement: FakeElement,
		setTimeout: () => 0,
		vscode: { postMessage: (message: ConfirmResult) => postedMessages.push(message) },
		window,
	});
	vm.runInContext(compiledSource.slice(start, end), context);

	return { document, overlay, postedMessages, window };
}

async function flushPromises(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

test('modal dismissal resolves confirmation results exactly once', async () => {
	const cases: Array<{
		name: string;
		expected: boolean;
		dismiss(harness: ReturnType<typeof createModalHarness>): void;
	}> = [
		{ name: 'overlay', expected: false, dismiss: harness => harness.overlay.click() },
		{ name: 'Escape', expected: false, dismiss: harness => harness.document.dispatch('keydown', { key: 'Escape' }) },
		{ name: 'cancel button', expected: false, dismiss: harness => harness.overlay.querySelector('.cancel-btn')!.click() },
		{ name: 'confirm button', expected: true, dismiss: harness => harness.overlay.querySelector('.confirm-btn')!.click() },
	];

	for (const testCase of cases) {
		const harness = createModalHarness();
		harness.window.dispatch('message', {
			data: {
				type: 'confirm',
				id: testCase.name,
				message: 'Continue?',
				confirmLabel: 'Continue',
				cancelLabel: 'Cancel',
			},
		});
		testCase.dismiss(harness);
		await flushPromises();

		assert.equal(harness.postedMessages.length, 1);
		assert.equal(harness.postedMessages[0].command, 'confirmResult');
		assert.equal(harness.postedMessages[0].confirmId, testCase.name);
		assert.equal(harness.postedMessages[0].result, testCase.expected);
	}
});

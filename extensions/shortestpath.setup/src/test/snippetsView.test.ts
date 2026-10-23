/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as vm from 'node:vm';
import { test } from 'node:test';
import { getCppSnippetsHtml, type SnippetEntry, type SnippetsText } from '../snippetsView';

class Element {
	id = '';
	className = '';
	textContent = '';
	innerHTML = '';
	value = '';
	title = '';
	htmlFor = '';
	type = '';
	wrap = '';
	spellcheck = true;
	clientLeft = 1;
	clientTop = 1;
	clientWidth = 640;
	clientHeight = 360;
	getBoundingClientRect() { return this.id === 'snippetEditorContent' ? { left: 0, top: 80, bottom: 600 } : { left: 20, top: 100, bottom: 460 }; }
	scrollLeft = 0;
	children: Element[] = [];
	attributes = new Map<string, string>();
	style = { height: '', cssText: '', properties: new Map<string, string>(), setProperty(name: string, value: string) { this.properties.set(name, value); } };
	onclick?: () => void;
	oninput?: () => void;
	onscroll?: () => void;
	focused = false;
	constructor(readonly tagName = 'div') { }
	append(...elements: Element[]): void { this.children.push(...elements); }
	replaceChildren(): void { this.children = []; this.textContent = ''; }
	setAttribute(key: string, value: string): void { this.attributes.set(key, value); }
	focus(): void { this.focused = true; }
}

const ui: SnippetsText = {
	title: 'Templates', list: 'Templates', add: 'Add', delete: 'Delete', unnamed: 'Unnamed', newSnippet: 'New',
	prefixUnset: 'No prefix', prefixLabel: 'Prefix: ', name: 'Name', description: 'Description', prefix: 'Prefix', body: 'Body',
	intro: 'Saved automatically', empty: 'Empty', saving: 'Saving', saved: 'Saved'
};

const entry = (name: string, body = 'int main() {}'): SnippetEntry => ({ name, prefix: name.toLowerCase(), body, description: name, include: '**/*.cpp', exclude: '**/test.cpp' });

function createView(entries = [entry('A'), entry('B')]) {
	const html = getCppSnippetsHtml({ language: 'cpp', entries, tabSize: 2 }, ui);
	const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]; assert.ok(script);
	const roots = new Map(['title', 'intro', 'listTitle', 'snippetList', 'add', 'form', 'saved', 'snippetEditorContent'].map(id => { const element = new Element(); element.id = id; return [id, element]; }));
	const all = (): Element[] => [...roots.values()].flatMap(function walk(element): Element[] { return [element, ...element.children.flatMap(walk)]; });
	const get = (id: string) => roots.get(id) ?? all().find(element => element.id === id)!;
	const byClass = (name: string) => all().filter(element => element.className.split(' ').includes(name));
	const messages: Array<Record<string, any>> = [];
	const events = new Map<string, (event: { data: Record<string, unknown> }) => void>();
	const timers = new Map<number, { delay: number; callback: () => void }>();
	let timerId = 0;
	const window = { innerHeight: 800, addEventListener: (type: string, callback: (event: { data: Record<string, unknown> }) => void) => events.set(type, callback) };
	vm.runInNewContext(script, {
		acquireVsCodeApi: () => ({ postMessage: (message: unknown) => messages.push(JSON.parse(JSON.stringify(message))) }),
		document: { getElementById: get, createElement: (tag: string) => new Element(tag), createTextNode: (text: string) => { const node = new Element('#text'); node.textContent = text; return node; } },
		window,
		setTimeout: (callback: () => void, delay: number) => { timers.set(++timerId, { callback, delay }); return timerId; },
		clearTimeout: (id: number) => timers.delete(id)
	});
	return {
		html, get, byClass, messages,
		edit(id: string, value: string) { const control = get(id); control.value = value; control.oninput!(); },
		send(data: Record<string, unknown>) { events.get('message')!({ data }); },
		flush(delay: number) { for (const [id, timer] of timers) { if (timer.delay === delay) { timers.delete(id); timer.callback(); } } },
		resize(width: number, height: number, viewportHeight: number) { get('snippetBodyEditor').clientWidth = width; get('snippetBodyEditor').clientHeight = height; window.innerHeight = viewportHeight; events.get('resize')!({ data: {} }); }
	};
}

test('renders ordered metadata fields and lays out the native editor with viewport clipping', () => {
	const source = 'int value;\n'.repeat(29) + 'return 0;';
	const view = createView([entry('A', source)]);
	assert.deepEqual(view.get('form').children.map(field => field.children[0].textContent), ['Name', 'Description', 'Prefix', 'Body']);
	assert.deepEqual(view.messages.at(-1), { type: 'snippetEditorLayout', selectionRevision: 0, source, bounds: { left: 21, top: 101, width: 640, height: 360, clipTop: 80, clipBottom: 600 } });
	view.resize(520, 420, 480);
	assert.deepEqual(view.messages.at(-1), { type: 'snippetEditorLayout', selectionRevision: 0, bounds: { left: 21, top: 101, width: 520, height: 420, clipTop: 80, clipBottom: 480 } });
});

test('native editor changes reject obsolete revisions and preserve the final snapshot when switching templates', () => {
	const view = createView();
	view.send({ type: 'snippetBodyChanged', selectionRevision: 0, contentRevision: 2, source: 'return 2;' });
	view.send({ type: 'snippetBodyChanged', selectionRevision: 0, contentRevision: 1, source: 'obsolete' });
	view.flush(250);
	assert.equal(view.messages.at(-1)!.entries[0].body, 'return 2;');
	view.byClass('snippet-select')[1].onclick!();
	assert.equal(view.messages.at(-1)!.source, 'int main() {}');
	view.send({ type: 'snippetBodySnapshot', selectionRevision: 0, contentRevision: 3, source: 'final A' });
	view.send({ type: 'snippetBodyChanged', selectionRevision: 0, contentRevision: 4, source: 'retired editor' });
	view.send({ type: 'snippetBodyChanged', selectionRevision: 1, contentRevision: 1, source: 'updated B' });
	view.flush(250);
	assert.deepEqual(view.messages.at(-1)!.entries.map((item: SnippetEntry) => item.body), ['final A', 'updated B']);
});

test('editing visible fields preserves hidden snippet restrictions and ignores stale save acknowledgements', () => {
	const view = createView();
	view.edit('field-name', 'Renamed'); view.flush(250);
	const first = view.messages.at(-1)!;
	view.edit('field-prefix', 'new-prefix'); view.flush(250);
	const latest = view.messages.at(-1)!;
	assert.deepEqual(latest.entries[0], { ...entry('Renamed'), prefix: 'new-prefix', description: 'A' });
	view.send({ type: 'saved', revision: first.revision });
	assert.equal(view.get('saved').textContent, 'Saving');
	view.send({ type: 'saved', revision: latest.revision, error: 'Disk full' });
	assert.equal(view.get('saved').textContent, 'Disk full');
	assert.equal(view.get('saved').className, 'status error');
});

test('delete confirmation targets the clicked entry even after selecting another template', () => {
	const view = createView();
	view.byClass('snippet-delete')[0].onclick!();
	const request = view.messages.at(-1)!;
	view.byClass('snippet-select')[1].onclick!();
	view.send({ ...request, type: 'deleteConfirmed' });
	assert.equal(view.get('field-name').value, 'B');
	assert.equal(view.byClass('snippet-select').length, 1);
	view.send({ ...request, type: 'deleteConfirmed' });
	assert.equal(view.byClass('snippet-select').length, 1);
	view.byClass('snippet-delete')[0].onclick!();
	view.send({ ...view.messages.at(-1), type: 'deleteCancelled' });
	assert.equal(view.byClass('snippet-select').length, 1);
});

test('serialized native editor source stays literal and outside localization boundaries', () => {
	const source = '</script><img src=x onerror=alert(1)>\n${1:变量}';
	const view = createView([entry('模板名称', source)]);
	assert.equal((view.html.match(/<\/script>/g) ?? []).length, 1);
	assert.equal(view.byClass('snippet-name')[0].attributes.get('data-i18n-ignore'), '');
	assert.equal(view.get('snippetBodyEditor').attributes.get('data-i18n-ignore'), '');
	assert.equal(view.messages.at(-1)!.source, source);
	assert.equal(view.get('snippetBodyEditor').innerHTML, '');
	view.send({ type: 'snippetBodyChanged', selectionRevision: 0, contentRevision: 1, source });
	view.flush(250);
	assert.equal(view.messages.at(-1)!.entries[0].body, source);
});

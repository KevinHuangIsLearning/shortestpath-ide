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
	const roots = new Map(['title', 'intro', 'listTitle', 'snippetList', 'add', 'form', 'saved'].map(id => [id, new Element()]));
	const all = (): Element[] => [...roots.values()].flatMap(function walk(element): Element[] { return [element, ...element.children.flatMap(walk)]; });
	const get = (id: string) => roots.get(id) ?? all().find(element => element.id === id)!;
	const byClass = (name: string) => all().filter(element => element.className.split(' ').includes(name));
	const messages: Array<Record<string, any>> = [];
	const events = new Map<string, (event: { data: Record<string, unknown> }) => void>();
	const timers = new Map<number, { delay: number; callback: () => void }>();
	let timerId = 0, lineHeight = 22;
	vm.runInNewContext(script, {
		acquireVsCodeApi: () => ({ postMessage: (message: unknown) => messages.push(JSON.parse(JSON.stringify(message))) }),
		document: { getElementById: get, createElement: (tag: string) => new Element(tag), createTextNode: (text: string) => { const node = new Element('#text'); node.textContent = text; return node; } },
		window: { addEventListener: (type: string, callback: (event: { data: Record<string, unknown> }) => void) => events.set(type, callback), getComputedStyle: () => ({ lineHeight: String(lineHeight) }) },
		setTimeout: (callback: () => void, delay: number) => { timers.set(++timerId, { callback, delay }); return timerId; },
		clearTimeout: (id: number) => timers.delete(id)
	});
	return {
		html, get, byClass, messages,
		edit(id: string, value: string) { const control = get(id); control.value = value; control.oninput!(); },
		send(data: Record<string, unknown>) { events.get('message')!({ data }); },
		flush(delay: number) { for (const [id, timer] of timers) { if (timer.delay === delay) { timers.delete(id); timer.callback(); } } },
		setLineHeight(value: number) { lineHeight = value; events.get('resize')!({ data: {} }); }
	};
}

test('renders ordered fields and adjusts source height as lines and font metrics change', () => {
	const view = createView([entry('A', 'int value;\n'.repeat(29) + 'return 0;')]);
	assert.deepEqual(view.get('form').children.map(field => field.children[0].textContent), ['Name', 'Description', 'Prefix', 'Body']);
	assert.equal(view.get('field-body').style.height, '706px');
	view.edit('field-body', 'return 1;');
	assert.equal(view.get('field-body').style.height, '180px');
	view.edit('field-body', 'x\n'.repeat(9) + 'y');
	view.setLineHeight(30);
	assert.equal(view.get('field-body').style.height, '346px');
	assert.equal(view.byClass('line-numbers')[0].textContent, '1\n2\n3\n4\n5\n6\n7\n8\n9\n10');
});

test('rejects stale highlighting after edits or switching templates and keeps source editable on failure', () => {
	const view = createView(); view.flush(100);
	const initial = view.messages.at(-1)!;
	view.edit('field-body', 'return 2;'); view.flush(100);
	const updated = view.messages.at(-1)!;
	view.send({ ...initial, lines: [[{ text: 'old', style: 'color:red' }]] });
	assert.equal(view.byClass('code-highlight')[0].textContent, 'return 2;');
	view.send({ ...updated, lines: [[{ text: 'return 2;', style: 'color:green' }]] });
	assert.equal(view.byClass('code-highlight')[0].children[0].style.cssText, 'color:green');
	view.byClass('snippet-select')[1].onclick!();
	view.send({ ...updated, lines: [[{ text: 'wrong template', style: '' }]] });
	assert.equal(view.byClass('code-highlight')[0].textContent, 'int main() {}');
	view.flush(100);
	view.send({ ...view.messages.at(-1), error: 'Grammar unavailable' });
	assert.equal(view.get('field-body').value, 'int main() {}');
	assert.equal(view.byClass('code-highlight')[0].textContent, 'int main() {}');
	view.send({ type: 'refreshHighlight', tabSize: 4 }); view.flush(100);
	assert.equal(view.byClass('code-editor')[0].style.properties.get('--snippet-tab-size'), '4');
	assert.equal(view.messages.at(-1)!.type, 'highlight');
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

test('serialized and highlighted source stays literal and outside localization boundaries', () => {
	const source = '</script><img src=x onerror=alert(1)>\n${1:变量}';
	const view = createView([entry('模板名称', source)]);
	assert.equal((view.html.match(/<\/script>/g) ?? []).length, 1);
	assert.equal(view.byClass('snippet-name')[0].attributes.get('data-i18n-ignore'), '');
	assert.equal(view.byClass('code-highlight')[0].attributes.get('data-i18n-ignore'), '');
	assert.equal(view.get('field-body').value, source);
	view.flush(100);
	view.send({ ...view.messages.at(-1), lines: [[{ text: source, style: 'color:red' }]] });
	const span = view.byClass('code-highlight')[0].children[0];
	assert.equal(span.textContent, source);
	assert.equal(span.innerHTML, '');
});

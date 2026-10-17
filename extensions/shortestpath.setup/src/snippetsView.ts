/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type SnippetEntry = {
	name: string;
	prefix: string;
	body: string;
	description: string;
	include: string;
	exclude: string;
};

export type SnippetsState = {
	language: string;
	entries: readonly SnippetEntry[];
	tabSize?: number;
};

export type SnippetsText = Record<'title' | 'list' | 'add' | 'delete' | 'unnamed' | 'newSnippet' | 'prefixUnset' | 'prefixLabel' | 'name' | 'description' | 'prefix' | 'body' | 'intro' | 'empty' | 'saving' | 'saved', string>;

/** Reserve a native workbench editor for editing C++ snippet bodies. */
export function getCppSnippetsHtml(state: SnippetsState, text: SnippetsText): string {
	const serialize = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
	return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
* { box-sizing: border-box; }
body { margin: 0; height: 100vh; overflow: hidden; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
main { display: grid; grid-template-columns: 190px minmax(0, 760px); gap: 34px; height: 100vh; max-width: 1010px; margin: 0 auto; padding: 32px 28px; }
.sidebar { display: flex; flex-direction: column; min-height: 0; gap: 12px; }
.header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 4px; }
.header strong { font-size: 15px; }
#snippetList { display: grid; align-content: start; gap: 4px; overflow-y: auto; }
button { border: 0; font: inherit; color: inherit; background: transparent; cursor: pointer; }
button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.icon-button { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 28px; height: 28px; padding: 5px; border-radius: 7px; color: var(--vscode-descriptionForeground); }
.icon-button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.icon-button:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
#add { color: var(--vscode-foreground); }
.snippet { display: flex; align-items: center; min-width: 0; border-radius: 8px; padding-right: 4px; }
.snippet:hover { background: var(--vscode-list-hoverBackground); }
.snippet.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.snippet-select { flex: 1; min-width: 0; padding: 10px 8px; text-align: left; border-radius: 8px; }
.snippet-name, .snippet-prefix { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.snippet-name { font-weight: 500; }
.snippet-prefix { margin-top: 4px; font-size: 11px; color: var(--vscode-descriptionForeground); }
.snippet.active .snippet-prefix { color: inherit; opacity: .75; }
.snippet-delete { opacity: 0; color: inherit; }
.snippet:is(:hover, :focus-within, .active) .snippet-delete { opacity: 1; }
.snippet-delete:hover { color: var(--vscode-errorForeground); }
.editor { min-width: 0; overflow-y: auto; padding-right: 4px; }
h1 { font-size: 28px; margin: 0 0 8px; }
p { color: var(--vscode-descriptionForeground); line-height: 1.6; margin: 0 0 26px; }
.field { margin-top: 18px; }
label { display: block; font-weight: 600; margin-bottom: 7px; }
input { width: 100%; border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px; padding: 8px 10px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); font: inherit; }
input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.code-editor { height: 360px; min-width: 0; overflow: hidden; border: 1px solid var(--vscode-input-border, var(--vscode-editorWidget-border)); border-radius: 8px; background: var(--vscode-editor-background); }
.status { display: block; min-height: 18px; margin-top: 8px; font-size: 12px; color: var(--vscode-descriptionForeground); }
.status.error { color: var(--vscode-errorForeground); }
#saved { margin-top: 16px; color: var(--vscode-testing-iconPassed); }
#saved.error { color: var(--vscode-errorForeground); }
.empty { color: var(--vscode-descriptionForeground); padding: 44px 12px; text-align: center; }
@media (max-width: 720px) { body { height: auto; overflow: auto; } main { display: block; height: auto; padding: 24px 18px 48px; } .sidebar { margin-bottom: 24px; } #snippetList { max-height: 240px; } .editor { overflow: visible; padding-right: 0; } }
</style></head><body><main>
<aside class="sidebar"><div class="header"><strong id="listTitle"></strong><button id="add" class="icon-button" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div><div id="snippetList" role="tablist" aria-orientation="vertical"></div></aside>
<section class="editor" id="snippetEditorContent"><h1 id="title"></h1><p id="intro"></p><div id="form"></div><span id="saved" class="status" aria-live="polite"></span></section>
</main><script>
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
const ui = ${serialize(text)};
const state = ${serialize(state)};
const language = state.language;
let entries = state.entries;
let selected = entries.length ? 0 : -1;
let saveTimer, layoutFrame;
let revision = 0, deleteRequest = 0;
let selectionRevision = 0, lastLayoutRevision = -1;
const editorEntries = new Map();
const editorBodyRevisions = new Map();
const pendingDeletes = new Map();
if (selected >= 0) { editorEntries.set(selectionRevision, entries[selected]); editorBodyRevisions.set(selectionRevision, -1); }
byId('title').textContent = ui.title;
byId('intro').textContent = ui.intro;
byId('listTitle').textContent = ui.list;
byId('snippetList').setAttribute('aria-label', ui.list);
byId('add').title = ui.add;
byId('add').setAttribute('aria-label', ui.add);
function save() {
	clearTimeout(saveTimer);
	revision++;
	byId('saved').className = 'status';
	byId('saved').textContent = ui.saving;
	saveTimer = setTimeout(() => vscode.postMessage({ type: 'save', language, entries, revision }), 250);
}
function select(index) {
	if (selected === index) return;
	selected = index; selectionRevision++;
	if (selected >= 0) { editorEntries.set(selectionRevision, entries[selected]); editorBodyRevisions.set(selectionRevision, -1); }
	render();
}
function requestDelete(index) {
	const entry = entries[index];
	const requestId = ++deleteRequest;
	pendingDeletes.set(requestId, entry);
	vscode.postMessage({ type: 'confirmDelete', language, name: entry.name || ui.unnamed, requestId });
}
function renderList() {
	const list = byId('snippetList');
	list.replaceChildren();
	entries.forEach((entry, index) => {
		const row = document.createElement('div');
		row.className = 'snippet' + (index === selected ? ' active' : '');
		const button = document.createElement('button');
		button.type = 'button'; button.className = 'snippet-select';
		button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(index === selected));
		const name = document.createElement('span');
		name.className = 'snippet-name'; name.textContent = entry.name || ui.unnamed;
		name.setAttribute('data-i18n-ignore', '');
		const prefix = document.createElement('small');
		prefix.className = 'snippet-prefix'; prefix.textContent = entry.prefix ? ui.prefixLabel + entry.prefix : ui.prefixUnset;
		prefix.setAttribute('data-i18n-ignore', '');
		button.append(name, prefix); button.onclick = () => select(index);
		const remove = document.createElement('button');
		remove.type = 'button'; remove.className = 'icon-button snippet-delete';
		remove.title = ui.delete; remove.setAttribute('aria-label', ui.delete);
		remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7"/></svg>';
		remove.onclick = () => requestDelete(index);
		row.append(button, remove); list.append(row);
	});
}
function field(label, key) {
	const wrapper = document.createElement('div'); wrapper.className = 'field';
	const title = document.createElement('label'); title.textContent = label; title.htmlFor = 'field-' + key;
	const control = document.createElement('input'); control.id = title.htmlFor;
	control.value = entries[selected][key] || '';
	control.oninput = () => { entries[selected][key] = control.value; if (key === 'name' || key === 'prefix') renderList(); save(); };
	wrapper.append(title, control); return wrapper;
}
function editorField() {
	const wrapper = document.createElement('div'); wrapper.className = 'field';
	const title = document.createElement('label'); title.textContent = ui.body; title.id = 'field-body';
	const editor = document.createElement('div'); editor.id = 'snippetBodyEditor'; editor.className = 'code-editor';
	editor.setAttribute('role', 'group'); editor.setAttribute('aria-labelledby', title.id); editor.setAttribute('data-i18n-ignore', '');
	wrapper.append(title, editor); return wrapper;
}
function layoutSnippetEditor() {
	const slot = byId('snippetBodyEditor');
	const rect = slot?.getBoundingClientRect?.();
	const content = byId('snippetEditorContent')?.getBoundingClientRect?.() ?? { top: 0, bottom: window.innerHeight || 0 };
	const bounds = {
		left: rect ? rect.left + (slot?.clientLeft ?? 0) : 0, top: rect ? rect.top + (slot?.clientTop ?? 0) : 0,
		width: slot?.clientWidth ?? 0, height: slot?.clientHeight ?? 0,
		clipTop: Math.max(0, content.top), clipBottom: Math.min(window.innerHeight || 0, content.bottom)
	};
	const message = { type: 'snippetEditorLayout', bounds, selectionRevision };
	if (lastLayoutRevision !== selectionRevision) {
		lastLayoutRevision = selectionRevision;
		vscode.postMessage({ ...message, source: selected >= 0 ? entries[selected].body : '' });
	} else {
		vscode.postMessage(message);
	}
}
function scheduleSnippetEditorLayout() {
	if (typeof window.requestAnimationFrame !== 'function') { layoutSnippetEditor(); return; }
	if (layoutFrame !== undefined) window.cancelAnimationFrame(layoutFrame);
	layoutFrame = window.requestAnimationFrame(() => { layoutFrame = undefined; layoutSnippetEditor(); });
}
const snippetEditorResizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleSnippetEditorLayout) : undefined;
snippetEditorResizeObserver?.observe(byId('snippetEditorContent'));
function render() { renderList(); renderForm(); layoutSnippetEditor(); }
function renderForm() {
	const form = byId('form'); form.replaceChildren();
	if (selected < 0) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = ui.empty; form.append(empty); return; }
	form.append(field(ui.name, 'name'), field(ui.description, 'description'), field(ui.prefix, 'prefix'), editorField());
}
function updateEditorBody(message) {
	if (typeof message.selectionRevision !== 'number' || typeof message.source !== 'string') return;
	const entry = editorEntries.get(message.selectionRevision);
	if (!entry) return;
	const contentRevision = typeof message.contentRevision === 'number' ? message.contentRevision : 0;
	if (contentRevision < (editorBodyRevisions.get(message.selectionRevision) ?? -1)) return;
	editorBodyRevisions.set(message.selectionRevision, contentRevision);
	entry.body = message.source;
	save();
	if (message.type === 'snippetBodySnapshot' && message.selectionRevision !== selectionRevision) {
		editorEntries.delete(message.selectionRevision);
		editorBodyRevisions.delete(message.selectionRevision);
	}
}
window.addEventListener('resize', scheduleSnippetEditorLayout);
window.addEventListener('scroll', scheduleSnippetEditorLayout, true);
window.addEventListener('pagehide', () => { if (layoutFrame !== undefined) window.cancelAnimationFrame(layoutFrame); snippetEditorResizeObserver?.disconnect(); editorEntries.clear(); editorBodyRevisions.clear(); });
byId('add').onclick = () => {
	entries.push({ name: ui.newSnippet, prefix: '', body: '', description: '', include: '', exclude: '' });
	selected = entries.length - 1; selectionRevision++; editorEntries.set(selectionRevision, entries[selected]); editorBodyRevisions.set(selectionRevision, -1);
	render(); save(); byId('field-name').focus();
};
window.addEventListener('message', event => {
	const message = event.data;
	if (message?.type === 'deleteConfirmed' && message.language === language) {
		const entry = pendingDeletes.get(message.requestId); pendingDeletes.delete(message.requestId);
		const index = entries.indexOf(entry); if (index < 0) return;
		const active = entries[selected]; entries.splice(index, 1);
		selected = active === entry ? Math.min(index, entries.length - 1) : entries.indexOf(active);
		if (active === entry) {
			selectionRevision++;
			if (selected >= 0) { editorEntries.set(selectionRevision, entries[selected]); editorBodyRevisions.set(selectionRevision, -1); }
		}
		render(); save();
	} else if (message?.type === 'deleteCancelled') {
		pendingDeletes.delete(message.requestId);
	} else if (message?.type === 'snippetBodyChanged' || message?.type === 'snippetBodySnapshot') {
		updateEditorBody(message);
	} else if (message?.type === 'saved' && message.revision === revision) {
		byId('saved').className = 'status' + (message.error ? ' error' : '');
		byId('saved').textContent = message.error || ui.saved;
	}
});
render();
</script></body></html>`;
}

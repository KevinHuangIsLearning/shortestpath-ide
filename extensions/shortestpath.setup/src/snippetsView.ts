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
	tabSize: number;
};

export type SnippetsText = Record<'title' | 'list' | 'add' | 'delete' | 'unnamed' | 'newSnippet' | 'prefixUnset' | 'prefixLabel' | 'name' | 'description' | 'prefix' | 'body' | 'intro' | 'empty' | 'saving' | 'saved', string>;

/** Editable source and its highlighted layer share the IDE's font and token colors. */
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
.code-editor { position: relative; overflow: hidden; border: 1px solid var(--vscode-input-border, var(--vscode-editorWidget-border)); border-radius: 8px; background: var(--vscode-editor-background); }
.code-editor:focus-within { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.code-input, .code-highlight, .line-numbers { font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size, 14px); font-weight: var(--vscode-editor-font-weight, normal); font-variant-ligatures: none; line-height: 1.6; tab-size: var(--snippet-tab-size, 2); }
.code-input, .code-highlight { margin: 0; padding: 14px 16px 14px 52px; border: 0; border-radius: 0; white-space: pre; word-wrap: normal; overflow-wrap: normal; }
.code-input { position: relative; display: block; width: 100%; min-height: 180px; resize: none; overflow-x: auto; overflow-y: hidden; background: transparent; color: transparent; caret-color: var(--vscode-editor-foreground); outline: none; }
.code-input::selection { background: var(--vscode-editor-selectionBackground); color: var(--vscode-editor-selectionForeground, var(--vscode-editor-foreground)); }
.code-highlight { position: absolute; inset: 0; overflow: hidden; color: var(--vscode-editor-foreground); pointer-events: none; }
.line-numbers { position: absolute; inset: 0 auto 0 0; width: 42px; margin: 0; padding: 14px 8px; color: var(--vscode-editorLineNumber-foreground); background: var(--vscode-editor-background); text-align: right; pointer-events: none; }
.status { display: block; min-height: 18px; margin-top: 8px; font-size: 12px; color: var(--vscode-descriptionForeground); }
.status.error { color: var(--vscode-errorForeground); }
#saved { margin-top: 16px; color: var(--vscode-testing-iconPassed); }
#saved.error { color: var(--vscode-errorForeground); }
.empty { color: var(--vscode-descriptionForeground); padding: 44px 12px; text-align: center; }
@media (max-width: 720px) { body { height: auto; overflow: auto; } main { display: block; height: auto; padding: 24px 18px 48px; } .sidebar { margin-bottom: 24px; } #snippetList { max-height: 240px; } .editor { overflow: visible; padding-right: 0; } }
</style></head><body><main>
<aside class="sidebar"><div class="header"><strong id="listTitle"></strong><button id="add" class="icon-button" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div><div id="snippetList" role="tablist" aria-orientation="vertical"></div></aside>
<section class="editor"><h1 id="title"></h1><p id="intro"></p><div id="form"></div><span id="saved" class="status" aria-live="polite"></span></section>
</main><script>
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
const ui = ${serialize(text)};
const state = ${serialize(state)};
const language = state.language;
let entries = state.entries;
let selected = entries.length ? 0 : -1;
let saveTimer, highlightTimer;
let revision = 0, highlightRequest = 0, deleteRequest = 0;
let codeEditor;
const pendingDeletes = new Map();
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
function select(index) { selected = index; render(); }
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
function resizeCode() {
	if (!codeEditor) return;
	const style = window.getComputedStyle(codeEditor.input);
	const lineHeight = parseFloat(style.lineHeight) || 22.4;
	const lineCount = codeEditor.input.value.split('\\n').length;
	codeEditor.input.style.height = Math.max(180, lineHeight * lineCount + 46) + 'px';
	codeEditor.numbers.textContent = Array.from({ length: lineCount }, (_, index) => String(index + 1)).join('\\n');
}
function plainHighlight() { if (codeEditor) codeEditor.highlight.textContent = codeEditor.input.value; }
function queueHighlight() {
	clearTimeout(highlightTimer);
	const requestId = ++highlightRequest;
	if (!codeEditor) return;
	highlightTimer = setTimeout(() => vscode.postMessage({ type: 'highlight', source: codeEditor.input.value, requestId }), 100);
}
function codeField() {
	const wrapper = document.createElement('div'); wrapper.className = 'field';
	const title = document.createElement('label'); title.textContent = ui.body; title.htmlFor = 'field-body';
	const editor = document.createElement('div'); editor.className = 'code-editor';
	editor.style.setProperty('--snippet-tab-size', String(state.tabSize));
	const highlight = document.createElement('pre'); highlight.className = 'code-highlight';
	highlight.setAttribute('aria-hidden', 'true'); highlight.setAttribute('data-i18n-ignore', '');
	const input = document.createElement('textarea'); input.className = 'code-input'; input.id = title.htmlFor;
	input.wrap = 'off'; input.spellcheck = false; input.setAttribute('autocapitalize', 'off'); input.setAttribute('autocorrect', 'off');
	input.value = entries[selected].body;
	const numbers = document.createElement('pre'); numbers.className = 'line-numbers'; numbers.setAttribute('aria-hidden', 'true');
	const status = document.createElement('span'); status.className = 'status'; status.setAttribute('aria-live', 'polite');
	codeEditor = { input, highlight, numbers, status, editor };
	input.oninput = () => { entries[selected].body = input.value; plainHighlight(); resizeCode(); queueHighlight(); save(); };
	input.onscroll = () => { highlight.scrollLeft = input.scrollLeft; };
	editor.append(highlight, input, numbers); wrapper.append(title, editor, status);
	plainHighlight(); queueHighlight(); return wrapper;
}
function renderForm() {
	clearTimeout(highlightTimer); highlightRequest++; codeEditor = undefined;
	const form = byId('form'); form.replaceChildren();
	if (selected < 0) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = ui.empty; form.append(empty); return; }
	form.append(field(ui.name, 'name'), field(ui.description, 'description'), field(ui.prefix, 'prefix'), codeField());
}
function render() { renderList(); renderForm(); resizeCode(); }
byId('add').onclick = () => {
	entries.push({ name: ui.newSnippet, prefix: '', body: '', description: '', include: '', exclude: '' });
	selected = entries.length - 1; render(); save(); byId('field-name').focus();
};
window.addEventListener('resize', resizeCode);
window.addEventListener('message', event => {
	const message = event.data;
	if (message?.type === 'deleteConfirmed' && message.language === language) {
		const entry = pendingDeletes.get(message.requestId); pendingDeletes.delete(message.requestId);
		const index = entries.indexOf(entry); if (index < 0) return;
		const active = entries[selected]; entries.splice(index, 1);
		selected = active === entry ? Math.min(index, entries.length - 1) : entries.indexOf(active);
		render(); save();
	} else if (message?.type === 'deleteCancelled') {
		pendingDeletes.delete(message.requestId);
	} else if (message?.type === 'saved' && message.revision === revision) {
		byId('saved').className = 'status' + (message.error ? ' error' : '');
		byId('saved').textContent = message.error || ui.saved;
	} else if (message?.type === 'highlight' && codeEditor && message.requestId === highlightRequest && message.source === codeEditor.input.value) {
		codeEditor.highlight.replaceChildren();
		if (Array.isArray(message.lines)) {
			message.lines.forEach((line, index) => {
				if (index) codeEditor.highlight.append(document.createTextNode('\\n'));
				line.forEach(token => { const span = document.createElement('span'); span.textContent = token.text; span.style.cssText = token.style; codeEditor.highlight.append(span); });
			});
		} else plainHighlight();
		codeEditor.highlight.scrollLeft = codeEditor.input.scrollLeft;
		codeEditor.status.className = 'status' + (message.error ? ' error' : ''); codeEditor.status.textContent = message.error || '';
	} else if (message?.type === 'refreshHighlight') {
		if (typeof message.tabSize === 'number') { state.tabSize = message.tabSize; codeEditor?.editor.style.setProperty('--snippet-tab-size', String(state.tabSize)); }
		resizeCode(); queueHighlight();
	}
});
render();
</script></body></html>`;
}

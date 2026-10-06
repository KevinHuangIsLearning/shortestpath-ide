/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { test } from 'node:test';
import type { EditorPreview } from '../editorPreview';
import type * as vscode from 'vscode';

function createPreview(parametersOnly = false, noHints = false) {
	const files: string[] = [];
	let formats = 0;
	const dispatches: Array<{ kind: string; tabSize: number; range?: object }> = [];
	const provider = {
		async provideDocumentFormattingEdits(_document: object, options: { tabSize: number }) { dispatches.push({ kind: 'document', tabSize: options.tabSize }); return []; },
		async provideDocumentRangeFormattingEdits(_document: object, range: object, options: { tabSize: number }) { dispatches.push({ kind: 'range', tabSize: options.tabSize, range }); return []; },
		async provideDocumentRangesFormattingEdits(_document: object, range: object[], options: { tabSize: number }) { dispatches.push({ kind: 'ranges', tabSize: options.tabSize, range }); return []; }
	};
	let now = 0;
	const exports: { EditorPreview?: typeof EditorPreview } = {};
	const source = fs.readFileSync(path.resolve(__dirname, '../editorPreview.js'), 'utf8');
	vm.runInNewContext(source, { exports, console, Date: { now: () => { now += 1000; return now; } }, setTimeout: (callback: () => void) => callback(), require(id: string) {
		if (id === './firstRunPreview') { return require('../firstRunPreview'); }
		if (id === './localization') { return { localize: (text: string) => text }; }
		if (id === 'vscode') {
			return {
				InlayHintKind: { Type: 1 }, Range: class {}, CancellationTokenSource: class { token = {}; dispose() {} },
				extensions: { getExtension: () => ({ async activate() {}, exports: { getApi: () => ({ languageClient: { getFeature: () => ({ getProvider: () => ++formats < 3 ? undefined : provider }) } }) } }) },
				workspace: { async openTextDocument(file: string) { files.push(file); return { uri: file, lineCount: 16, offsetAt: () => 0 }; } },
				commands: { async executeCommand(command: string) {
					if (command === '_shortestpath.cppPreviewTokens') { return [[{ text: 'auto value;', style: 'color:red' }]]; }
					return noHints ? [] : [{ kind: parametersOnly ? 2 : 1, label: ': int', position: { line: 0, character: 10 } }];
				} }
			};
		}
		return require(id);
	} });
	return { preview: new exports.EditorPreview!(), files, dispatches, formatRequests: () => formats };
}

test('preview waits for formatting registration, uses actual type hints, and cleans temporary sources', async () => {
	const host = createPreview();
	const result = await host.preview.render(2, true, true);
	assert.equal(host.formatRequests(), 3);
	assert.equal(result.hints[0].label, ': int');
	assert.equal(result.hintError, undefined);
	assert.ok(host.files.some(file => file.endsWith('formatted-2.cpp')));
	host.preview.dispose();
	for (let i = 0; i < 20 && fs.existsSync(path.dirname(host.files[0])); i++) { await new Promise<void>(resolve => setTimeout(resolve, 5)); }
	assert.equal(fs.existsSync(path.dirname(host.files[0])), false);
});

test('parameter hints alone do not report type hint preview success', async () => {
	const host = createPreview(true);
	try {
		const result = await host.preview.render(2, true, false);
		assert.equal(result.hints.length, 0);
		assert.match(result.hintError ?? '', /clang 类型提示/);
	} finally { host.preview.dispose(); }
});

test('template previews use selected formatting widths and fresh documents after edits', async () => {
	const host = createPreview(false, true);
	try {
		const first = await host.preview.render(4, true, true, 'int main(){return 1;}');
		const second = await host.preview.render(8, true, true, 'int main(){return 2;}');
		assert.deepEqual([first.source, second.source, second.hints.length, second.hintError], ['int main(){return 1;}', 'int main(){return 2;}', 0, undefined]);
		assert.match(fs.readFileSync(path.join(path.dirname(host.files[0]), '.clang-format'), 'utf8'), /IndentWidth: 4, TabWidth: 4/);
		assert.match(fs.readFileSync(path.join(path.dirname(host.files[2]), '.clang-format'), 'utf8'), /IndentWidth: 8, TabWidth: 8/);
		assert.notEqual(path.dirname(host.files[0]), path.dirname(host.files[2]));
	} finally { host.preview.dispose(); }
});

test('unchanged single and multiple ranges use the matching clangd API and selected width', async () => {
	const host = createPreview();
	const range = { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } } as vscode.Range;
	try {
		assert.deepEqual(await host.preview.format('source', 4, range), []);
		assert.deepEqual(await host.preview.format('source', 8, [range, range]), []);
		assert.deepEqual(host.dispatches, [{ kind: 'range', tabSize: 4, range }, { kind: 'ranges', tabSize: 8, range: [range, range] }]);
	} finally { host.preview.dispose(); }
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { cppFallbackStyle, defaultCppTemplate, editorPreviewSource, previewLineSegments } from '../firstRunPreview';

test('preview hints split styled tokens at original UTF-16 positions, including boundaries', () => {
	assert.deepEqual(previewLineSegments([{ text: 'auto ', style: 'keyword' }, { text: '值 = 1;', style: 'variable' }], [
		{ line: 0, character: 6, label: ': int' }, { line: 0, character: 5, label: 'hint', paddingRight: true }
	]), [
		{ text: 'auto ', style: 'keyword' }, { text: 'hint ', style: '', hint: true }, { text: '值', style: 'variable' },
		{ text: ': int', style: '', hint: true }, { text: ' = 1;', style: 'variable' }
	]);
});

test('preview indentation follows the selected width without modifying strings', () => {
	const source = editorPreviewSource(4);
	assert.match(source, /^ {4}auto total=/gm);
	assert.match(source, /^ {8}auto passed/gm);
	assert.match(source, /"Alice", 85/);
	assert.match(source, /'\\n'/);
});

test('formatting the default template joins the short while loop and expands the empty solve function', t => {
	const available = spawnSync('clang-format', ['--version'], { encoding: 'utf8' });
	if ((available.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
		t.skip('clang-format is not installed');
		return;
	}
	const source = defaultCppTemplate.replace('while (T--) solve();', 'while (T--)\n    solve();').replace('void solve() {\n\n}', 'void solve() {}');
	for (const width of [2, 4, 8]) {
		const result = spawnSync('clang-format', [`--style=${cppFallbackStyle(width)}`], { input: source, encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr);
		assert.ok(result.stdout.includes(`\n${' '.repeat(width)}while (T--) solve();\n`));
		assert.match(result.stdout, /void solve\(\) \{\n\s*\}/);
	}
});

test('first-run defaults match the requested editor, submission, compiler and template settings', () => {
	const root = path.resolve(__dirname, '../..');
	const recommended = JSON.parse(fs.readFileSync(path.join(root, 'resources/recommended-settings.json'), 'utf8'));
	assert.deepEqual(Object.fromEntries(['editor.fontSize', 'editor.tabSize', 'editor.detectIndentation', 'editor.formatOnSave', 'editor.formatOnPaste', 'editor.inlayHints.enabled', 'workbench.colorTheme', 'shortestpath.oj.cppSubmissionLanguage'].map(key => [key, recommended[key]])), {
		'editor.fontSize': 14, 'editor.tabSize': 2, 'editor.detectIndentation': false, 'editor.formatOnSave': false,
		'editor.formatOnPaste': false, 'editor.inlayHints.enabled': 'off', 'workbench.colorTheme': 'One Monokai', 'shortestpath.oj.cppSubmissionLanguage': 'cpp20'
	});
	assert.equal(defaultCppTemplate, '#include <bits/stdc++.h>\nusing namespace std;\nusing i64 = long long;\n\nvoid solve() {\n\n}\n\nint main() {\n  cin.tie(0)->sync_with_stdio(0);\n  int T = 1;\n  cin >> T;\n  while (T--) solve();\n}\n');
	assert.equal(recommended['judger.language.cpp.Template'], defaultCppTemplate);
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ThemeRegistration } from 'shiki';
import { EditorCodeTheme } from '../editorCodeTheme';

const customTheme: ThemeRegistration = { name: 'shortestpath-editor', type: 'dark', settings: [] };

test('newer theme reads win and disposed sessions ignore pending reads', async () => {
	const pending: Array<(theme: ThemeRegistration) => void> = [];
	let changes = 0;
	const theme = new EditorCodeTheme(() => new Promise(resolve => pending.push(resolve)), () => 'github-dark', () => { changes++; });
	const first = theme.refresh();
	const second = theme.refresh();
	pending[1](customTheme);
	await second;
	pending[0]({ ...customTheme, type: 'light' });
	await first;
	assert.deepEqual({ theme: theme.value, changes }, { theme: customTheme, changes: 1 });
	const last = theme.refresh();
	theme.dispose();
	pending[2]({ ...customTheme, type: 'light' });
	await last;
	assert.deepEqual({ theme: theme.value, changes }, { theme: customTheme, changes: 1 });
});

test('an unavailable host command falls back to the current light/dark theme', async () => {
	let available = true;
	let fallback = 'github-dark';
	const theme = new EditorCodeTheme(async () => {
		if (!available) { throw new Error('Command not found'); }
		return customTheme;
	}, () => fallback, () => { });
	await theme.refresh();
	available = false;
	fallback = 'github-light';
	await theme.refresh();
	assert.equal(theme.value, 'github-light');
	theme.dispose();
});

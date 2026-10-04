/*---------------------------------------------------------------------------------------------
 * Copyright (c) 2026 ShortestPath IDE contributors. Licensed under GPL-3.0-or-later.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';

test('category filtering honors row categories and search finds settings across categories', () => {
    const makeRow = (category: string | undefined, text: string, home = false) => ({ dataset: { category }, textContent: text, hidden: false, hasAttribute: (attribute: string) => attribute === 'data-home' && home });
    const compiler = makeRow(undefined, 'compiler'), submission = makeRow('judger', 'submission'), font = makeRow(undefined, 'font', true);
    const card = (category: string, rows: ReturnType<typeof makeRow>[]) => ({ dataset: { category }, hidden: false, querySelectorAll: () => rows, querySelector: () => undefined });
    const cards = [card('cpp', [compiler, submission]), card('editor', [font])];
    const buttons = ['home', 'cpp', 'judger', 'editor'].map(category => ({ dataset: { category }, textContent: category, classList: { toggle() {} }, setAttribute() {} }));
    const search = { value: '' }, title = { textContent: '' }, noResults = { hidden: false };
    const compiled = fs.readFileSync(path.join(__dirname, '../simpleSettings.js'), 'utf8');
    const match = /function updateSettingsFilter\(\) \{[\s\S]*?\n\}/.exec(compiled);
    assert.ok(match);
    const context = vm.createContext({ selectedCategory: 'judger', categoryButtons: buttons, byId: (id: string) => ({ settingsSearch: search, categoryTitle: title, noResults })[id], document: { querySelectorAll: () => cards }, vscode: { setState() {} } });
    vm.runInContext(match[0], context); vm.runInContext('updateSettingsFilter()', context);
    assert.equal(compiler.hidden, true); assert.equal(submission.hidden, false); assert.equal(font.hidden, true);
    vm.runInContext("selectedCategory = 'home'; updateSettingsFilter()", context);
    assert.equal(compiler.hidden, true); assert.equal(submission.hidden, true); assert.equal(font.hidden, false);
    assert.equal(title.textContent, 'home');
    search.value = 'font'; vm.runInContext('updateSettingsFilter()', context);
    assert.equal(font.hidden, false); assert.equal(cards[0].hidden, true); assert.equal(noResults.hidden, true);
    search.value = 'nonexistent'; vm.runInContext('updateSettingsFilter()', context); assert.equal(noResults.hidden, false);
});

 test('home is the default and Marketplace belongs to Extensions with a Home shortcut', () => {
    const compiled = fs.readFileSync(path.join(__dirname, '../simpleSettings.js'), 'utf8');
    assert.match(compiled, /savedNavigation.category \|\| 'home'/);
    assert.match(compiled, /data-category="extensions"><div class="row" data-home><div><label for="useExtensionMarketplace"/);
    assert.match(compiled, /card documentation" data-category="about"><div class="row" data-home>/);
    assert.match(compiled, /<div class="row" data-home><div><label>请我喝杯咖啡/);
    assert.doesNotMatch(compiled, /data-category="tools"><div class="row"[^>]*><div><label for="useExtensionMarketplace"/);
});

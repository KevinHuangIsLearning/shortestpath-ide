/*---------------------------------------------------------------------------------------------
 * Copyright (c) 2026 ShortestPath IDE contributors. Licensed under GPL-3.0-or-later.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';

test('local settings categories switch their cards and keep the support action in the header', () => {
    const cards = ['cpp', 'editor'].map(category => ({ dataset: { category }, hidden: false }));
    const buttons = ['cpp', 'editor'].map(category => ({ dataset: { category }, textContent: category, classList: { toggle() {} }, setAttribute() {}, removeAttribute() {} }));
    const title = { textContent: '' }, content = { scrollTop: 10 };
    const compiled = fs.readFileSync(path.join(__dirname, '../simpleSettings.js'), 'utf8');
    const match = /function selectCategory\(category\) \{[\s\S]*?\n\}/.exec(compiled);
    assert.ok(match);
    const context = vm.createContext({ selectedCategory: 'editor', byId: (id: string) => id === 'categoryTitle' ? title : content, document: { querySelectorAll: (selector: string) => selector === '.category' ? buttons : cards } });
    vm.runInContext(match[0], context); vm.runInContext("selectCategory('cpp')", context);
    assert.deepEqual(cards.map(card => card.hidden), [false, true]);
    assert.equal(title.textContent, 'cpp'); assert.equal(content.scrollTop, 0);
    assert.match(compiled, /selectedCategory = 'editor'/);
    assert.match(compiled, /buyMeACoffee/);
});

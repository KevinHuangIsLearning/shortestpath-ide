/*---------------------------------------------------------------------------------------------
 * Copyright (c) 2026 ShortestPath IDE contributors. Licensed under GPL-3.0-or-later.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';

function createView() {
    class Button {
        dataset = { hintId: 'hint', target: 'question', liked: 'false', likeEnabled: 'true' };
        disabled = false;
        count = { textContent: '3' };
        attributes = new Map<string, string>();
        classList = { toggle() {} };
        querySelector() { return this.count; }
        setAttribute(key: string, value: string) { this.attributes.set(key, value); }
        removeAttribute(key: string) { this.attributes.delete(key); }
    }
    let button = new Button();
    const listeners: ((event: { data: unknown }) => void)[] = [];
    const requests: object[] = [];
    const compiled = fs.readFileSync(path.join(__dirname, '../problemView.js'), 'utf8');
    const helper = compiled.slice(compiled.indexOf('const pendingHintLikes ='), compiled.indexOf('const closeModal ='));
    const start = compiled.indexOf("else if (command === 'like') {");
    const action = compiled.slice(start + "else if (command === 'like') {".length, compiled.indexOf("else if (command === 'addStressCounterExample')", start)).replace(/\}\s*$/, '');
    const modalStart = compiled.indexOf('modal.querySelectorAll');
    const modalSync = compiled.slice(modalStart, compiled.indexOf('});', modalStart) + 3);
    const view = vm.runInNewContext(`${helper}\n({ click: (button) => { ${action} }, reopen: (modal) => { ${modalSync} } })`, {
        document: { querySelectorAll: () => [button] }, window: { addEventListener: (_: string, callback: typeof listeners[number]) => listeners.push(callback) },
        vscode: { postMessage: (value: object) => requests.push(value) }, command: 'like',
    }) as { click: (value: Button) => void; reopen: (modal: object) => void };
    return { get button() { return button; }, reopen: () => { button = new Button(); view.reopen({ querySelectorAll: () => [button] }); }, requests, click: view.click, receive: (data: object) => listeners.forEach(listener => listener({ data })) };
}

test('hint likes update immediately, reject duplicate requests and reconcile server counts', () => {
    const view = createView(); view.click(view.button); view.click(view.button);
    assert.equal(view.button.dataset.liked, 'true'); assert.equal(view.button.count.textContent, '4'); assert.equal(view.button.disabled, true);
    assert.equal(view.requests.length, 1); assert.equal((view.requests[0] as { liked: boolean }).liked, true);
    view.receive({ type: 'hintLike', hintId: 'hint', target: 'question', liked: true, count: 12 });
    assert.equal(view.button.count.textContent, '12'); assert.equal(view.button.disabled, false);
});

test('hint like failures restore the previous state and allow retry', () => {
    const view = createView(); view.click(view.button);
    view.receive({ type: 'hintLikeError', hintId: 'hint', target: 'question' });
    assert.equal(view.button.dataset.liked, 'false'); assert.equal(view.button.count.textContent, '3'); assert.equal(view.button.disabled, false);
    assert.equal(view.button.attributes.has('aria-busy'), false); view.click(view.button); assert.equal(view.requests.length, 2);
});


test('pending hint likes survive closing and reopening, including success and rollback', () => {
    const extension = fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8');
    const renderSource = /function renderLikeButton\(hintId, target, likes, enabled, loading = false\) \{[\s\S]*?\n\}/.exec(extension)?.[0];
    assert.ok(renderSource);
    const render = vm.runInNewContext(`${renderSource}\nrenderLikeButton`, { escapeAttribute: (text: string) => text, likeSvgOutlined: '<svg/>', likeSvgFilled: '<svg/>' }) as (...args: unknown[]) => string;
    const pendingHtml = render('hint', 'question', { liked: false, count: 3 }, true, true);
    assert.match(pendingHtml, /class="like-count"/); assert.match(pendingHtml, /<svg\/>/); assert.match(pendingHtml, /aria-busy="true"/);
    for (const type of ['hintLike', 'hintLikeError']) {
        const view = createView(); view.click(view.button); view.reopen();
        assert.equal(view.button.disabled, true); assert.equal(view.button.count.textContent, '4');
        view.receive({ type, hintId: 'hint', target: 'question', liked: true, count: 15 });
        assert.equal(view.button.count.textContent, type === 'hintLike' ? '15' : '3'); assert.equal(view.button.disabled, false);
    }
});

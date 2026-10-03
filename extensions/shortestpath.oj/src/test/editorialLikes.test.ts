/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { test } from 'node:test';

function createLikeView() {
	class Button {
		dataset: { hintId: string; target: string; liked: string };
		disabled = false;
		innerHTML = '<icons/><count/>';
		count = { textContent: '3' };
		classes = new Set<string>();
		attributes = new Map<string, string>();
		classList = { toggle: (name: string, enabled: boolean) => enabled ? this.classes.add(name) : this.classes.delete(name) };
		constructor(target: string) { this.dataset = { hintId: 'hint', target, liked: 'false' }; }
		querySelector() { return this.count; }
		closest() { return this; }
		setAttribute(name: string, value: string) { this.attributes.set(name, value); }
	}
	const question = new Button('question');
	const answer = new Button('answer');
	let click: (event: { target: Button }) => void = () => { throw new Error('Missing click handler'); };
	let receive: (event: { data: object }) => void = () => { throw new Error('Missing message handler'); };
	const requests: object[] = [];
	const source = fs.readFileSync(path.resolve(__dirname, '../../src/extension.ts'), 'utf8');
	const start = source.indexOf('const pendingEditorialLikes = new Map();');
	assert.ok(start >= 0);
	const script = source.slice(start, source.indexOf('</script>', start));
	vm.runInNewContext(script, {
		HTMLButtonElement: Button,
		document: {
			querySelectorAll: () => [question, answer],
			addEventListener: (_type: string, handler: typeof click) => { click = handler; },
		},
		window: { addEventListener: (_type: string, handler: typeof receive) => { receive = handler; } },
		vscode: { postMessage: (message: object) => requests.push(message) },
	});
	return {
		question, answer, requests,
		click: (button: Button) => click({ target: button }),
		receive: (data: object) => receive({ data }),
	};
}

test('editorial likes update before requesting and reconcile without replacing icons', () => {
	const view = createLikeView();
	view.click(view.question);
	view.click(view.question);
	assert.equal(view.question.dataset.liked, 'true');
	assert.equal(view.question.count.textContent, '4');
	assert.equal(view.question.classes.has('liked'), true);
	assert.equal(view.question.disabled, true);
	assert.equal(view.question.innerHTML, '<icons/><count/>');
	assert.equal(view.requests.length, 1);
	assert.equal((view.requests[0] as { liked: boolean }).liked, true);
	view.receive({ type: 'editorialLike', hintId: 'hint', target: 'question', questionLiked: true, questionLikeCount: 9, answerLiked: false, answerLikeCount: 3 });
	assert.equal(view.question.count.textContent, '9');
	assert.equal(view.question.disabled, false);
	view.click(view.question);
	assert.equal(view.question.count.textContent, '8');
	assert.equal(view.question.dataset.liked, 'false');
	view.receive({ type: 'editorialLikeError', hintId: 'hint', target: 'question' });
	assert.equal(view.question.count.textContent, '9');
	assert.equal(view.question.dataset.liked, 'true');
	assert.equal(view.question.disabled, false);
});

test('question and answer requests reconcile independently and errors restore the previous state', () => {
	const view = createLikeView();
	view.click(view.question);
	view.click(view.answer);
	view.receive({ type: 'editorialLike', hintId: 'hint', target: 'question', questionLiked: true, questionLikeCount: 5, answerLiked: false, answerLikeCount: 3 });
	assert.equal(view.question.disabled, false);
	assert.equal(view.answer.disabled, true);
	assert.equal(view.answer.dataset.liked, 'true');
	assert.equal(view.answer.count.textContent, '4');
	view.receive({ type: 'editorialLikeError', hintId: 'hint', target: 'answer' });
	assert.equal(view.answer.dataset.liked, 'false');
	assert.equal(view.answer.count.textContent, '3');
	assert.equal(view.answer.disabled, false);
	assert.equal(view.question.count.textContent, '5');
	assert.equal(view.answer.innerHTML, '<icons/><count/>');
});

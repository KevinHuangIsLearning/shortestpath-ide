// ==UserScript==
// @name ShortestPath atcoder submission
// @match https://atcoder.jp/contests/*
// @run-at document-start
// @grant none
// ==/UserScript==
const wait = async (selector, ready = element => !element.disabled) => {
	const until = Date.now() + 25000;
	while (Date.now() < until) {
		const element = document.querySelector(selector);
		if (element && ready(element)) return element;
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error('Submission control unavailable: ' + selector + '. Check login and complete any challenge.');
};
const fill = (element, value) => {
	const setter = Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')?.set;
	if (setter) setter.call(element, value); else element.value = value;
	element.dispatchEvent(new Event('input', { bubbles: true }));
	element.dispatchEvent(new Event('change', { bubbles: true }));
};
const selectLanguage = async selector => {
	if (!Judger.languageValue) return;
	const select = await wait(selector, element => !element.disabled && Array.from(element.options).some(option => option.value === Judger.languageValue));
	select.value = Judger.languageValue;
	select.dispatchEvent(new Event('change', { bubbles: true }));
};
const toggle = await wait('.editor-buttons > button:nth-child(3)');
if (toggle.getAttribute('aria-pressed') !== 'true') toggle.click();
const editor = await wait('#plain-textarea');
const deadline = Date.now() + 25000;
while (editor.style.display === 'none' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
if (editor.style.display === 'none') throw new Error('Plain text editor unavailable');
fill(editor, Judger.code);
toggle.click();
await selectLanguage('#select-lang > div > select');
if (Judger.autoSubmit === 'true') {
	const challenge = document.querySelector('.cf-challenge');
	if (challenge) {
		const deadline = Date.now() + 25000;
		while (!challenge.querySelector('div > input')?.value && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
		if (!challenge.querySelector('div > input')?.value) throw new Error('Complete the browser challenge, then submit manually.');
	}
	(await wait('#submit')).click();
}

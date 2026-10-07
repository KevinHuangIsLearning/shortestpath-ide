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
// contest.js stores the initialized Ace instance on its backing textarea.
// Set both editors so the site's saved plain/Ace preference remains consistent.
const editor = await wait('#plain-textarea', element => !!window.jQuery?.(element).data('editor'));
window.jQuery(editor).data('editor').setValue(Judger.code, -1);
fill(editor, Judger.code);
await selectLanguage('#select-lang select.current');
const submit = async () => {
	const challenge = document.querySelector('.cf-challenge');
	if (challenge) {
		const deadline = Date.now() + 25000;
		while (!challenge.querySelector('div > input')?.value && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
		if (!challenge.querySelector('div > input')?.value) throw new Error('Complete the browser challenge, then submit manually.');
	}
	(await wait('#submit')).click();
};
if (Judger.confirmBeforeSubmit === 'true') {
	Judger.registerSubmit(submit);
} else if (Judger.autoSubmit === 'true') {
	await submit();
}

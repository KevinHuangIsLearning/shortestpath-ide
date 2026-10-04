// ==UserScript==
// @name ShortestPath luogu submission
// @match https://www.luogu.com.cn/problem/*
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
(await wait('#app > div.main-container > div > header > div > div > div > div.bottom-row > div.left > div > ul > li:nth-child(2)')).click();
const editor = await wait('.cm-content');
editor.innerText = Judger.code;
editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: Judger.code }));
if (Judger.autoSubmit === 'true') (await wait('#app > div.main-container > div > main > div > div > div.main > div > div.body > button')).click();

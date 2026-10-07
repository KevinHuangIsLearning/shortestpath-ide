// ==UserScript==
// @name ShortestPath hydro submission
// @match https://hydro.ac/*
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
const selectLanguage = async () => {
	if (!Judger.languageValue) { return; }
	// React owns the visible selectors and writes the complete ID into the hidden field.
	const [main, ...parts] = Judger.languageValue.split('.');
	const sub = parts.join('.');
	const container = await wait('#codelang-selector', element => !!element.querySelector('select'));
	const hasOption = (select, value) => !!select && !select.disabled && Array.from(select.options).some(option => option.value === value);
	const change = (select, value) => {
		Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value);
		select.dispatchEvent(new Event('change', { bubbles: true }));
	};
	const mainSelect = Array.from(container.querySelectorAll('select')).find(select => hasOption(select, main));
	if (mainSelect) { change(mainSelect, main); }
	// A single main language has no main selector; a single version has no sub selector.
	await wait('select[name="lang"]', element => element.value === main || element.value.startsWith(main + '.'));
	if (sub) {
		const ready = await wait('#codelang-selector', element =>
			document.querySelector('select[name="lang"]')?.value === Judger.languageValue ||
			hasOption(Array.from(element.querySelectorAll('select')).slice(-1)[0], sub));
		const subSelect = Array.from(ready.querySelectorAll('select')).slice(-1)[0];
		if (hasOption(subSelect, sub)) { change(subSelect, sub); }
	}
	await wait('select[name="lang"]', element => element.value === Judger.languageValue);
};
// Wait for the initial React effect, including when no language override is configured.
const languages = await wait('#codelang-selector', element => !!element.querySelector('select'));
await wait('select[name="lang"]', hidden => {
	const selected = Array.from(languages.querySelectorAll('select')).map(select => select.value);
	if (selected.some(value => !value)) { return false; }
	const matches = Array.from(hidden.options).filter(option => selected.length === 2
		? option.value === selected.join('.')
		: option.value === selected[0] || option.value.startsWith(selected[0] + '.') || option.value.endsWith('.' + selected[0]));
	const versions = matches.filter(option => option.value.includes('.'));
	const choices = versions.length ? versions : matches;
	return choices.length === 1 && hidden.value === choices[0].value;
});
fill(await wait('textarea[name="code"]'), Judger.code);
await selectLanguage();
const submit = async () => {
	(await wait('input[type="submit"]')).click();
};
if (Judger.confirmBeforeSubmit === 'true') {
	Judger.registerSubmit(submit);
} else if (Judger.autoSubmit === 'true') {
	await submit();
}

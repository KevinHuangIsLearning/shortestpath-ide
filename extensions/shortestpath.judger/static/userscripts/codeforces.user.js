// ==UserScript==
// @name ShortestPath codeforces submission
// @match https://*.codeforces.com/*
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
fill(await wait('#sourceCodeTextarea'), Judger.code);
if (/^\/(contest|gym)\//.test(location.pathname)) {
	const contest = await wait('select[name="submittedProblemIndex"]', element => !element.disabled && Array.from(element.options).some(option => option.value === Judger.problemId));
	contest.value = Judger.problemId;
	contest.dispatchEvent(new Event('change', { bubbles: true }));
} else {
	fill(await wait('input[name="submittedProblemCode"]'), Judger.contestId + Judger.problemId);
}
await selectLanguage('select[name="programTypeId"]');
if (Judger.autoSubmit === 'true') (await wait('.submit')).click();

// ==UserScript==
// @name ShortestPath vjudge submission
// @match https://vjudge.net/*
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
const selectLanguage = async selector => {
	if (!Judger.languageValue) return;
	const select = await wait(selector, element => !element.disabled && Array.from(element.options).some(option => option.value === Judger.languageValue));
	select.value = Judger.languageValue;
	select.dispatchEvent(new Event('change', { bubbles: true }));
};
(await wait('#btn-submit')).click();
const mirror = (await wait('#submitModal .CodeMirror', element => !!element.CodeMirror)).CodeMirror;
const method = document.querySelector('#submitModal input[name="submitterType"]:checked');
if (method?.value === '2') {
	throw new Error('VJudge is set to archive an existing submission. Choose a code submission method, then submit manually.');
}
mirror.setValue(Judger.code);
mirror.save();
await selectLanguage('#submitModal select[name="language"]');
const submit = async () => {
	(await wait('#submitModal #btn-submit')).click();
};
if (Judger.confirmBeforeSubmit === 'true') {
	Judger.registerSubmit(submit);
} else if (Judger.autoSubmit === 'true') {
	await submit();
}

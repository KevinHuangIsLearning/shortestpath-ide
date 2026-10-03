// ==UserScript==
// @name ShortestPath codeforces submission
// @match https://*.codeforces.com/*
// @run-at document-idle
// @grant none
// ==/UserScript==
const wait = async selector => {
    const until = Date.now() + 25000;
    while (Date.now() < until) {
        const element = document.querySelector(selector);
        if (element) return element;
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
const selectLanguage = selector => {
    if (!Judger.languageValue) return;
    const select = document.querySelector(selector);
    if (!select || !Array.from(select.options).some(option => option.value === Judger.languageValue)) throw new Error('Configured language is unavailable.');
    select.value = Judger.languageValue;
    select.dispatchEvent(new Event('change', { bubbles: true }));
};
fill(await wait('#sourceCodeTextarea'), Judger.code);
const contest = document.querySelector('select[name="submittedProblemIndex"]');
const problem = document.querySelector('input[name="submittedProblemCode"]');
if (contest) { contest.value = Judger.problemId; contest.dispatchEvent(new Event('change', { bubbles: true })); }
if (problem) fill(problem, Judger.contestId + Judger.problemId);
selectLanguage('select[name="programTypeId"]');
if (Judger.autoSubmit === 'true') (await wait('.submit')).click();

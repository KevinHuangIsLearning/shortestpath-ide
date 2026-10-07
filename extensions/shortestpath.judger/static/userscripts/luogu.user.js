// ==UserScript==
// @name ShortestPath luogu submission
// @match https://www.luogu.com.cn/problem/*
// @run-at document-start
// @grant none
// ==/UserScript==
const trace = message => console.info('[Judger submission] Luogu: ' + message);
trace('script started; readyState=' + document.readyState + '; hash=' + location.hash);
const wait = async (selector, ready = element => !element.disabled) => {
	trace('waiting for ' + selector);
	const until = Date.now() + 25000;
	while (Date.now() < until) {
		const element = document.querySelector(selector);
		if (element && ready(element)) { trace('found ' + selector); return element; }
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error('Submission control unavailable: ' + selector + '. Check login and complete any challenge.');
};
// Luogu's submission tab is a hash route; avoid depending on its header layout.
location.hash = '#submit';
trace('hash set to ' + location.hash);
const editor = await wait('.cm-content[contenteditable="true"]');
editor.focus();
trace('editor focused=' + (document.activeElement === editor));
// Let CodeMirror replace its document through its own select-all and paste handlers.
// Mutating innerText bypasses editor state and the site's submission model.
const mac = /Mac/.test(navigator.platform);
const selectAll = new KeyboardEvent('keydown', {
	key: 'a', code: 'KeyA', metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true,
});
editor.dispatchEvent(selectAll);
trace('select-all handled=' + selectAll.defaultPrevented);
if (!selectAll.defaultPrevented) {
	throw new Error('Luogu code editor could not select the existing code.');
}
const clipboard = new DataTransfer();
clipboard.setData('text/plain', Judger.code);
const paste = new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true });
editor.dispatchEvent(paste);
trace('paste handled=' + paste.defaultPrevented);
if (!paste.defaultPrevented) {
	throw new Error('Luogu code editor did not accept the code.');
}
trace('code paste completed; autoSubmit=' + Judger.autoSubmit);
const submit = async () => {
	const button = await wait('main', main => Array.from(main.querySelectorAll('button')).some(button =>
		!button.disabled && /^(提交评测|Submit to Judge)$/.test(button.textContent.trim())));
	Array.from(button.querySelectorAll('button')).find(button =>
		!button.disabled && /^(提交评测|Submit to Judge)$/.test(button.textContent.trim())).click();
};
if (Judger.confirmBeforeSubmit === 'true') {
	Judger.registerSubmit(submit);
} else if (Judger.autoSubmit === 'true') {
	await submit();
}

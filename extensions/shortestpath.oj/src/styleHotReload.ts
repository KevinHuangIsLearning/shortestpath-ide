/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

(() => {
	let pending: HTMLLinkElement | undefined;
	window.addEventListener('message', event => {
		const message = event.data;
		if (message?.type !== 'reloadStyles' || !Number.isSafeInteger(message.version)) {
			return;
		}
		const current = document.querySelector<HTMLLinkElement>('#oj-main-styles');
		if (!current) {
			return;
		}
		pending?.remove();
		const next = current.cloneNode() as HTMLLinkElement;
		next.removeAttribute('id');
		const url = new URL(current.href);
		url.searchParams.set('styleVersion', String(message.version));
		next.href = url.toString();
		pending = next;
		next.addEventListener('load', () => {
			if (pending !== next) {
				return;
			}
			current.replaceWith(next);
			next.id = 'oj-main-styles';
			pending = undefined;
		});
		next.addEventListener('error', () => {
			next.remove();
			if (pending === next) {
				pending = undefined;
			}
		});
		current.after(next);
	});
})();

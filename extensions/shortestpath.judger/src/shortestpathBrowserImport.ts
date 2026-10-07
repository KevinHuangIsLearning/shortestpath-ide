/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Keep the injected helpers in one self-contained closure so production minification
// can rename local functions without breaking references in the generated script.
function createShortestPathBrowserHelpers() {
	function isShortestPathBrowserUrl(value: string): boolean {
		try {
			const url = new URL(value);
			return /^https?:$/.test(url.protocol) && ['shortestpath.cn', 'www.shortestpath.cn'].includes(url.hostname);
		} catch { return false; }
	}

	/** Match detail routes, excluding editorials, contest overviews and ranking/document views. */
	function isShortestPathProblemPage(value: string): boolean {
		if (!isShortestPathBrowserUrl(value)) { return false; }
		try {
			const url = new URL(value);
			const parts = url.pathname.replace(/\/$/, '').split('/').slice(1).map(decodeURIComponent);
			if (parts.some(part => !part.trim() || part.includes('/'))) { return false; }
			if (parts[0] === 'problem') {
				return parts.length === 4 && ['found', 'adv', 'chal', 'past'].includes(parts[2]);
			}
			if (parts[0] === 'upsolving' && parts[1] === 'id') {
				return parts.length === 3 && /^[1-9]\d*$/.test(parts[2]);
			}
			const view = decodeURIComponent(url.hash.slice(1)).trim().toLowerCase();
			if (['rank', 'document'].includes(view)) { return false; }
			return parts[0] === 'upsolving' && parts.length === 4 && ['at', 'cf'].includes(parts[1].toLowerCase())
				|| parts[0] === 'replay' && (parts.length === 3 || parts.length === 2 && view !== '');
		} catch { return false; }
	}

	/** The website's accessible labels identify the same control in every bridge state. */
	function findShortestPathStartButton(): HTMLButtonElement | undefined {
		const labels = ['开始做题', '继续做题', '正在连接 IDE…', '正在发送题目…', 'IDE 已连接其他题目，点击重新连接', '连接失败，点击重试'];
		return Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label]'))
			.find(button => labels.includes(button.getAttribute('aria-label') ?? ''));
	}
	return { isShortestPathBrowserUrl, isShortestPathProblemPage, findShortestPathStartButton };
}

export function isShortestPathBrowserUrl(value: string): boolean {
	return createShortestPathBrowserHelpers().isShortestPathBrowserUrl(value);
}

export function isShortestPathProblemPage(value: string): boolean {
	return createShortestPathBrowserHelpers().isShortestPathProblemPage(value);
}

/** These helpers run in the isolated world but operate on the website's shared DOM. */
export function shortestPathBrowserHelpers(): string {
	return `const { isShortestPathBrowserUrl, isShortestPathProblemPage, findShortestPathStartButton } = (${createShortestPathBrowserHelpers.toString()})();`;
}

export function shortestPathStartProblemScript(): string {
	return `(() => {
		${shortestPathBrowserHelpers()}
		if (!isShortestPathProblemPage(location.href)) return false;
		const button = findShortestPathStartButton();
		if (!button) return false;
		if (!button.disabled) button.click();
		return true;
	})()`;
}

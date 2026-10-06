/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
/** Serialize settings as data so quotes, Windows paths and HTML cannot break the script. */
export function webviewBootstrap(values: Record<string, unknown>): string {
	return `window.vscodeApi = acquireVsCodeApi(); Object.assign(window, ${JSON.stringify(values).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')});`;
}

/** Register first: the host may answer the initial request immediately. */
export function connectJudgeMessages(target: Pick<Window, 'addEventListener' | 'removeEventListener'>, receive: (event: MessageEvent) => void, api: { postMessage: (message: { command: 'get-initial-problem' }) => void }): () => void {
	target.addEventListener('message', receive);
	api.postMessage({ command: 'get-initial-problem' });
	return () => target.removeEventListener('message', receive);
}

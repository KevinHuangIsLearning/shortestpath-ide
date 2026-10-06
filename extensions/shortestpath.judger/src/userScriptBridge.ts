/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

export type ScriptRequest = {
	id: number;
	operation: string;
	args: Record<string, unknown>;
};
export async function handleScriptRequest(
	request: ScriptRequest,
	storageKey: string,
	storage: Record<string, unknown>,
): Promise<unknown> {
	const args = request.args;
	if (
		request.operation === 'setValue' ||
		request.operation === 'deleteValue'
	) {
		if (typeof args.name !== 'string') {
			throw new Error('Invalid storage key');
		}
		if (request.operation === 'deleteValue') {
			delete storage[args.name];
		} else {
			Object.defineProperty(storage, args.name, {
				value: args.value,
				writable: true,
				configurable: true,
				enumerable: true,
			});
		}
		await globalThis.extensionContext.globalState.update(
			storageKey,
			storage,
		);
		return null;
	}
	if (request.operation === 'clipboard') {
		await vscode.env.clipboard.writeText(String(args.text));
		return null;
	}
	if (request.operation === 'notification') {
		void vscode.window.showInformationMessage(String(args.text));
		return null;
	}
	if (
		request.operation !== 'request' ||
		typeof args.url !== 'string' ||
		!/^https?:\/\//i.test(args.url)
	) {
		throw new Error('Unsupported userscript request');
	}
	if (
		args.responseType &&
		!['text', 'json'].includes(String(args.responseType))
	) {
		throw new Error(
			'Only text and JSON userscript responses are supported',
		);
	}
	const response = await fetch(args.url, {
		method: typeof args.method === 'string' ? args.method : 'GET',
		headers: args.headers as Record<string, string> | undefined,
		body: typeof args.data === 'string' ? args.data : undefined,
		credentials: 'omit',
		redirect: 'error',
		signal: AbortSignal.timeout(
			Math.max(
				1,
				Math.min(
					typeof args.timeout === 'number' ? args.timeout : 15000,
					30000,
				),
			),
		),
	});
	const reader = response.body?.getReader();
	let size = 0;
	const chunks: Uint8Array[] = [];
	try {
		while (reader) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			size += value.length;
			if (size > 8 * 1024 * 1024) {
				throw new Error('Userscript response exceeds 8 MiB');
			}
			chunks.push(value);
		}
	} finally {
		await reader?.cancel();
	}
	const responseText = Buffer.concat(chunks).toString('utf8');
	const headers: string[] = [];
	response.headers.forEach((value, name) =>
		headers.push(`${name}: ${value}`),
	);
	return {
		status: response.status,
		statusText: response.statusText,
		responseText,
		response:
			args.responseType === 'json'
				? JSON.parse(responseText)
				: responseText,
		finalUrl: response.url,
		responseHeaders: headers.join('\r\n'),
	};
}

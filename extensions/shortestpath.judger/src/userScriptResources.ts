/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import { UserScript } from './userScripts';

export type ScriptResource = { text: string; dataUrl: string };
export async function fetchScriptResource(
	url: string,
): Promise<ScriptResource> {
	if (!/^https?:\/\//i.test(url)) {
		throw new Error('Userscript resources require HTTP or HTTPS URLs');
	}
	const response = await fetch(url, {
		signal: AbortSignal.timeout(15000),
		credentials: 'omit',
	});
	if (!response.ok || !response.body) {
		throw new Error(`Resource request failed: ${response.status}`);
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			length += value.byteLength;
			if (length > 4 * 1024 * 1024) {
				throw new Error('Userscript resource exceeds 4 MiB');
			}
			chunks.push(value);
		}
	} finally {
		await reader.cancel();
	}
	const bytes = Buffer.concat(chunks);
	return {
		text: bytes.toString('utf8'),
		dataUrl: `data:${
			response.headers.get('content-type') ?? 'application/octet-stream'
		};base64,${bytes.toString('base64')}`,
	};
}

export async function loadScriptResources(script: UserScript): Promise<{
	requirements: string;
	resources: Record<string, ScriptResource>;
}> {
	let requirements = '';
	const resources: Record<string, ScriptResource> = Object.create(null);
	for (const url of script.requires) {
		requirements += (await fetchScriptResource(url)).text + '\n;\n';
	}
	for (const [name, url] of Object.entries(script.resources)) {
		resources[name] = await fetchScriptResource(url);
	}
	return { requirements, resources };
}

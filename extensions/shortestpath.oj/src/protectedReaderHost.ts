/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash, generateKeyPairSync } from 'crypto';
import { isIdeProtectedReadingField } from './generated/ide-bridge-contract';
export { assertIdeProtectedContent as assertProtectedContent } from './generated/ide-bridge-contract';

export const readerPrefix = 'spide1:';

// Ephemeral delivery keys scoped by origin, account and problem. Never stored in
// settings, workspace records, logs or sent over the website bridge. Reader
// windows import it as non-exportable; the host never decrypts content.
function createReaderKeys() {
	const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
	const publicJwk = pair.publicKey.export({ format: 'jwk' });
	return {
		publicKey: Buffer.concat([Buffer.from([4]), Buffer.from(publicJwk.x!, 'base64url'), Buffer.from(publicJwk.y!, 'base64url')]).toString('base64url'),
		privateJwk: pair.privateKey.export({ format: 'jwk' }),
	};
}
const contexts = new Map<string, ReturnType<typeof createReaderKeys>>();
export function getReaderKeys(origin: string, accountId: string, problemRef: string) {
	const context = JSON.stringify([origin, accountId, problemRef]);
	let keys = contexts.get(context);
	if (!keys) {
		keys = createReaderKeys();
		if (contexts.size >= 30) { contexts.delete(contexts.keys().next().value!); }
		contexts.set(context, keys);
	}
	contexts.delete(context); contexts.set(context, keys);
	return keys;
}

/** Turn a ciphertext-containing Markdown template into an inert reader slot. */
export function protectedMarkdownSlot(content: string, baseUrl: string, mode: 'canvas' | 'dom' = 'canvas'): string | undefined {
	if (!content.includes(readerPrefix)) { return undefined; }
	const template = Buffer.from(JSON.stringify({ content, baseUrl, mode }), 'utf8').toString('base64url');
	const id = createHash('sha256').update(template).digest('hex');
	return `<div class="${mode === 'canvas' ? 'protected-reader' : 'reader-content'}" data-reader-mode="${mode}" data-reader-id="${id}" data-reader-template="${template}" data-i18n-ignore aria-label="内容阅读区"></div>`;
}

/** Remove historical plaintext on migration, while preserving code and tests. */
export function discardLegacyReadingText<T>(value: T, path = ''): T {
	if (Array.isArray(value)) { return value.map((item, index) => discardLegacyReadingText(item, `${path}/${index}`)) as T; }
	if (!value || typeof value !== 'object') { return value; }
	return Object.fromEntries(Object.entries(value).map(([key, item]) => {
		const next = `${path}/${key}`;
		if (key === 'samples' && typeof item === 'string') {
			try { return [key, JSON.stringify(discardLegacyReadingText(JSON.parse(item), next))]; } catch { return [key, '[]']; }
		}
		if (typeof item === 'string' && isIdeProtectedReadingField(key, item, next) && !/^spide1:[A-Za-z0-9_-]+$/.test(item)) { return [key, '']; }
		return [key, discardLegacyReadingText(item, next)];
	})) as T;
}

/** Randomized encryption must not make an unchanged statement look like an edit. */
export function readingFingerprint(value: unknown): unknown {
	if (typeof value === 'string') {
		return value.replace(/spide1:([A-Za-z0-9_-]+)/g, (_match, encoded: string) => {
			try { const box = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); return Array.isArray(box) && box.length === 8 ? `reader-hash:${box[7]}` : 'invalid-reader-content'; }
			catch { return 'invalid-reader-content'; }
		});
	}
	if (Array.isArray(value)) { return value.map(readingFingerprint); }
	if (value && typeof value === 'object') { return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, readingFingerprint(child)])); }
	return value;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const domain = 'spide.reader.v1';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const bytes = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

export class ProtectedReaderCrypto {
	private privateKey: CryptoKey | undefined;
	private recipient = '';
	private generation = 0;
	private readonly aesKeys = new Map<string, Promise<CryptoKey>>();
	private readonly plaintext = new Map<string, Promise<string>>();
	private plaintextSize = 0;
	async initialize(privateJwk: JsonWebKey, publicKey: string): Promise<boolean> {
		this.clear();
		const generation = this.generation;
		const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
		if (generation !== this.generation) { return false; }
		this.privateKey = key;
		this.recipient = publicKey;
		return true;
	}
	get ready(): boolean { return this.privateKey !== undefined; }
	clear(): void { this.generation++; this.privateKey = undefined; this.recipient = ''; this.aesKeys.clear(); this.plaintext.clear(); this.plaintextSize = 0; }
	decrypt(encoded: string): Promise<string> {
		if (!this.ready) { return Promise.reject(new Error('Reader key unavailable')); }
		const cached = this.plaintext.get(encoded);
		if (cached) { this.plaintext.delete(encoded); this.plaintext.set(encoded, cached); return cached; }
		const generation = this.generation;
		const pending = this.decryptUncached(encoded).then(text => {
			if (generation !== this.generation) { throw new Error('Reader key changed'); }
			return text;
		}).catch(error => {
			if (this.plaintext.get(encoded) === pending) { this.plaintext.delete(encoded); this.plaintextSize -= encoded.length * 2; }
			throw error;
		});
		this.plaintext.set(encoded, pending);
		// The encoded envelope is larger than its plaintext. Budget both strings
		// conservatively, and share in-flight decryptions without persisting them.
		this.plaintextSize += encoded.length * 2;
		while (this.plaintext.size > 128 || this.plaintextSize > 4 * 1024 * 1024) {
			const oldest = this.plaintext.keys().next().value!;
			this.plaintext.delete(oldest); this.plaintextSize -= oldest.length * 2;
		}
		return pending;
	}
	private async decryptUncached(encoded: string): Promise<string> {
		const box: unknown = JSON.parse(decoder.decode(bytes(encoded)));
		if (!this.privateKey || !Array.isArray(box) || box.length !== 8 || !box.every(value => typeof value === 'string')) { throw new Error('Invalid reader box'); }
		const [to, from, salt, iv, uri, field, ciphertext, fingerprint] = box as string[];
		if (to !== this.recipient || bytes(from).length !== 65 || bytes(salt).length !== 16 || bytes(iv).length !== 12 || !/^(GET|POST) \/api\//.test(uri) || !field.startsWith('/data/')) { throw new Error('Invalid reader context'); }
		const keyId = `${from}:${salt}`;
		let key = this.aesKeys.get(keyId);
		if (!key) {
			const localKey = this.privateKey;
			key = (async () => {
				const peer = await crypto.subtle.importKey('raw', bytes(from), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
				const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, localKey, 256);
				const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
				return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: bytes(salt), info: encoder.encode(domain) }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
			})();
			// Bound memory even when the panel stays open across many requests.
			if (this.aesKeys.size >= 64) { this.aesKeys.delete(this.aesKeys.keys().next().value!); }
			this.aesKeys.set(keyId, key);
		}
		return decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv), additionalData: encoder.encode([domain, to, from, salt, iv, uri, field, fingerprint].join('\n')) }, await key, bytes(ciphertext)));
	}
}

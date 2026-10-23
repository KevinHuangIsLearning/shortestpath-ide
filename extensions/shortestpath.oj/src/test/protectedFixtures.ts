/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createECDH, createCipheriv, hkdfSync, randomBytes, createHash } from 'node:crypto';
import { getReaderKeys, readerPrefix } from '../protectedReaderHost';

export const readerKeys = getReaderKeys('https://shortestpath.cn', '1', 'DSU/found/A');

/** Independent OpenSSL sender matching the Go reader envelope. */
export function sealFixture(text: string, field = '/data/content', recipient = readerKeys.publicKey): string {
	const server = createECDH('prime256v1'); server.generateKeys();
	const salt = randomBytes(16); const nonce = randomBytes(12);
	const key = hkdfSync('sha256', server.computeSecret(Buffer.from(recipient, 'base64url')), salt, 'spide.reader.v1', 32);
	const box = [recipient, server.getPublicKey().toString('base64url'), salt.toString('base64url'), nonce.toString('base64url'), 'GET /api/problem-ref/DSU/found/A', field, '', createHash('sha256').update(text).digest('base64url')];
	const cipher = createCipheriv('aes-256-gcm', Buffer.from(key), nonce);
	cipher.setAAD(Buffer.from(['spide.reader.v1', ...box.slice(0, 6), box[7]].join('\n')));
	box[6] = Buffer.concat([cipher.update(text), cipher.final(), cipher.getAuthTag()]).toString('base64url');
	return readerPrefix + Buffer.from(JSON.stringify(box)).toString('base64url');
}

export function protectFixture<T>(value: T): T {
	return JSON.parse(JSON.stringify(value, (key, child) => {
		if (typeof child === 'string' && child && ['content', 'description', 'question', 'answer', 'input_format', 'output_format', 'constraints', 'solutionCode', 'solution', 'acCode', 'explanation'].includes(key) && !child.startsWith(readerPrefix)) { return sealFixture(child); }
		return child;
	}));
}

export function protectedWire(value: object): string {
	const message = structuredClone(value) as { data?: { problem?: { target?: object; ref: string;[key: string]: unknown } } };
	const problem = message.data?.problem;
	if (problem && !problem.target) {
		problem.target = { kind: 'training', problemId: '1', problemRef: problem.ref };
		problem.accountId = '1'; problem.publicContent = { title: problem.title }; problem.localTest = { enabled: true, reason: '' };
	}
	return JSON.stringify(protectFixture(message));
}

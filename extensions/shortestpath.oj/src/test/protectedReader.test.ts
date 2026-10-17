/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { ProtectedReaderCrypto } from '../protectedReaderCrypto';
import { assertProtectedContent, discardLegacyReadingText, getReaderKeys, protectedMarkdownSlot, readingFingerprint } from '../protectedReaderHost';
import { readerKeys, sealFixture } from './protectedFixtures';

const encoded = (sealed: string) => sealed.slice('spide1:'.length);

test('reader decrypts authenticated content, rejects tampering and clears its key', async () => {
	const reader = new ProtectedReaderCrypto();
	const text = '# 中文题目\n\n$n \\le 10$\n\n```cpp\nint main() {}\n```';
	const sealed = sealFixture(text);
	await assert.rejects(reader.decrypt(encoded(sealed)));
	await reader.initialize(readerKeys.privateJwk as JsonWebKey, readerKeys.publicKey);
	assert.equal(await reader.decrypt(encoded(sealed)), text);
	for (const index of [0, 1, 2, 3, 4, 5, 6, 7]) {
		const box = JSON.parse(Buffer.from(encoded(sealed), 'base64url').toString()) as string[];
		box[index] += 'x';
		await assert.rejects(reader.decrypt(Buffer.from(JSON.stringify(box)).toString('base64url')));
	}
	reader.clear();
	assert.equal(reader.ready, false);
	await assert.rejects(reader.decrypt(encoded(sealed)));
});

test('reading keys isolate accounts, origins and problems without writing keys to the payload', async () => {
	for (const keys of [getReaderKeys('https://shortestpath.cn', '2', 'DSU/found/A'), getReaderKeys('https://shortestpath.cn', '1', 'DSU/found/B'), getReaderKeys('http://localhost:3000', '1', 'DSU/found/A')]) {
		assert.notEqual(keys.publicKey, readerKeys.publicKey);
		const reader = new ProtectedReaderCrypto();
		await reader.initialize(keys.privateJwk as JsonWebKey, keys.publicKey);
		await assert.rejects(reader.decrypt(encoded(sealFixture('private'))));
	}
	assert.equal(getReaderKeys('https://shortestpath.cn', '1', 'DSU/found/A'), readerKeys);
	const slot = protectedMarkdownSlot(sealFixture('sentinel'), 'https://shortestpath.cn/problem/A')!;
	assert.ok(slot.includes('data-reader-template'));
	assert.ok(!slot.includes('sentinel'));
	assert.ok(!slot.includes(readerKeys.privateJwk.d!));
});

test('legacy migration removes reading text while preserving user source, samples, public headers and ciphertext', () => {
	const sealed = sealFixture('new statement');
	const before = { statement: { description: { format: 'markdown', content: 'old statement' } }, solutionCode: 'secret code', sourceCode: 'user code', samples: JSON.stringify([{ input: '1', output: '2', explanation: 'secret explanation' }]), publicContent: { content: sealed, judge_runtime: { public_headers: [{ content: 'void solve();' }] } } };
	const after = discardLegacyReadingText(before);
	assert.equal(after.statement.description.content, '');
	assert.equal(after.statement.description.format, 'markdown');
	assert.equal(after.solutionCode, '');
	assert.equal(after.sourceCode, 'user code');
	assert.deepEqual(JSON.parse(after.samples), [{ input: '1', output: '2', explanation: '' }]);
	assert.equal(after.publicContent.content, sealed);
	assert.equal(after.publicContent.judge_runtime.public_headers[0].content, 'void solve();');
	assert.equal(before.statement.description.content, 'old statement');
	assert.throws(() => assertProtectedContent(before));
	assert.doesNotThrow(() => assertProtectedContent(after));
	assert.throws(() => assertProtectedContent({ content: 'spide1:fake plaintext' }));
});

test('random encryption does not create false statement revisions', () => {
	const first = sealFixture('same statement'); const second = sealFixture('same statement');
	assert.notEqual(first, second);
	assert.deepEqual(readingFingerprint({ content: first }), readingFingerprint({ content: second }));
	assert.notDeepEqual(readingFingerprint(first), readingFingerprint(sealFixture('changed statement')));
});


test('late key imports cannot overwrite a newly selected account', async () => {
	const reader = new ProtectedReaderCrypto();
	const other = getReaderKeys('https://shortestpath.cn', '9', 'DSU/found/A');
	const stale = reader.initialize(other.privateJwk as JsonWebKey, other.publicKey);
	const current = reader.initialize(readerKeys.privateJwk as JsonWebKey, readerKeys.publicKey);
	assert.deepEqual(await Promise.all([stale, current]), [false, true]);
	assert.equal(await reader.decrypt(encoded(sealFixture('current account'))), 'current account');
	const pending = reader.initialize(readerKeys.privateJwk as JsonWebKey, readerKeys.publicKey);
	reader.clear();
	assert.equal(await pending, false);
	assert.equal(reader.ready, false);
});

test('browser highlighter follows editor token colors, including same-name theme updates', async () => {
	const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, { createMarkdownRendererWithHighlighter }] = await Promise.all([
		import('shiki/core'), import('shiki/engine/javascript'), import('../markdownRenderer'),
	]);
	const makeTheme = (foreground: string) => ({
		name: 'shortestpath-editor', type: 'dark' as const, settings: [
			{ settings: { foreground: '#abcdef', background: '#123456' } },
			{ scope: 'keyword.control', settings: { foreground, fontStyle: 'italic' } },
		]
	});
	let theme = makeTheme('#ff1234');
	const highlighter = await createHighlighterCore({ langs: [import('shiki/langs/cpp.mjs')], engine: createJavaScriptRegexEngine() });
	try {
		const render = createMarkdownRendererWithHighlighter(highlighter, () => theme);
		const code = '```cpp\nif (x < 2) return 0;\n```';
		assert.match(render(code, 'https://shortestpath.cn/'), /color:#FF1234/);
		theme = makeTheme('#12ff34');
		const changed = render(code, 'https://shortestpath.cn/');
		assert.match(changed, /color:#12FF34/);
		assert.match(changed, /font-style:italic/);
		assert.match(changed, /background-color:#123456/);
		assert.doesNotMatch(changed, /color:#FF1234/);
	} finally { highlighter.dispose(); }
});

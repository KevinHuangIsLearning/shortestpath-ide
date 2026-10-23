/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { ProtectedReaderCrypto } from '../protectedReaderCrypto';
import { assertProtectedContent, discardLegacyReadingText, getReaderKeys, hasCurrentReaderContent, protectedMarkdownSlot, readingFingerprint } from '../protectedReaderHost';
import { readerKeys, sealFixture } from './protectedFixtures';
import { createProtectedMarkdownRenderer } from '../protectedReaderMarkdown';
import { createMarkdownRendererWithHighlighter } from '../markdownRenderer';

const encoded = (sealed: string) => sealed.slice('spide1:'.length);

test('restarting the host requires fresh ciphertext even after creating a key for the same problem', () => {
	const problem = { url: 'https://shortestpath.cn/problem/DSU/found/A', accountId: '1', ref: 'DSU/found/A', statement: { content: sealFixture('plain statement without images') } };
	assert.equal(hasCurrentReaderContent(problem), true);
	const result = execFileSync(process.execPath, ['-e', `
		const fs = require('node:fs');
		const host = require(process.argv[1]);
		const problem = JSON.parse(fs.readFileSync(0, 'utf8'));
		const beforeHello = host.hasCurrentReaderContent(problem);
		host.getReaderKeys(new URL(problem.url).origin, problem.accountId, problem.ref);
		const afterHello = host.hasCurrentReaderContent(problem);
		const fixture = require(process.argv[2]);
		problem.statement.content = fixture.sealFixture('plain statement without images');
		console.log(JSON.stringify({ beforeHello, afterHello, afterSync: host.hasCurrentReaderContent(problem) }));
	`, require.resolve('../protectedReaderHost'), require.resolve('./protectedFixtures')], { input: JSON.stringify(problem), encoding: 'utf8' });
	assert.deepEqual(JSON.parse(result), { beforeHello: false, afterHello: false, afterSync: true });
});

test('cached reading checks cover serialized samples and reject mixed, malformed or foreign-context envelopes', () => {
	const problem = { url: 'https://shortestpath.cn/problem/DSU/found/A', accountId: '1', ref: 'DSU/found/A' };
	const content = sealFixture('current content');
	assert.equal(hasCurrentReaderContent({ ...problem, samples: JSON.stringify([{ explanation: content }]) }), true);
	for (const value of [
		{ ...problem, accountId: '2', content },
		{ ...problem, ref: 'DSU/found/B', content },
		{ ...problem, url: 'http://localhost:3000/problem/DSU/found/A', content },
		{ ...problem, content: 'spide1:invalid' },
		{ ...problem, content, samples: JSON.stringify([{ explanation: sealFixture('stale sample', '/data/samples/0/explanation', getReaderKeys('https://shortestpath.cn', '2', problem.ref).publicKey) }]) },
	]) { assert.equal(hasCurrentReaderContent(value), false); }
});

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

test('reader surface identity includes the exact ciphertext and link base', () => {
	const sealed = sealFixture('same text');
	const id = (content: string, base = 'https://shortestpath.cn/problem/A') => /data-reader-id="([^"]+)"/.exec(protectedMarkdownSlot(content, base)!)![1];
	assert.equal(id(sealed), id(sealed));
	assert.notEqual(id(sealed), id(sealed, 'https://shortestpath.cn/problem/B'));
	assert.notEqual(id(sealed), id(sealFixture('different text')));
	assert.notEqual(id(sealed), id(sealFixture('same text')));
	assert.notEqual(protectedMarkdownSlot(sealed, 'https://shortestpath.cn', 'canvas'), protectedMarkdownSlot(sealed, 'https://shortestpath.cn', 'dom'));
	assert.match(protectedMarkdownSlot(sealed, 'https://shortestpath.cn', 'dom')!, /class="reader-content" data-reader-mode="dom"/);
});

test('reader shares pending and completed plaintext only within its active key context', async () => {
	const reader = new ProtectedReaderCrypto();
	await reader.initialize(readerKeys.privateJwk as JsonWebKey, readerKeys.publicKey);
	const sealed = encoded(sealFixture('cached content'));
	const first = reader.decrypt(sealed);
	assert.equal(reader.decrypt(sealed), first);
	assert.equal(await first, 'cached content');
	assert.equal(reader.decrypt(sealed), first);
	reader.clear();
	await assert.rejects(reader.decrypt(sealed));
	await reader.initialize(readerKeys.privateJwk as JsonWebKey, readerKeys.publicKey);
	const reinitialized = reader.decrypt(sealed);
	assert.notEqual(reinitialized, first); await reinitialized;
	const pending = reader.decrypt(encoded(sealFixture('old account')));
	reader.clear();
	await assert.rejects(pending, /Reader key changed/);
});

test('reader evicts old plaintext and does not retain failed decryptions', async () => {
	const reader = new ProtectedReaderCrypto();
	await reader.initialize(readerKeys.privateJwk as JsonWebKey, readerKeys.publicKey);
	const sealed = encoded(sealFixture('oldest'));
	const first = reader.decrypt(sealed); await first;
	for (let index = 0; index < 128; index++) { await reader.decrypt(encoded(sealFixture(String(index)))); }
	const reloaded = reader.decrypt(sealed);
	assert.notEqual(reloaded, first); await reloaded;
	const bad = reader.decrypt('invalid'); await assert.rejects(bad);
	const retry = reader.decrypt('invalid'); assert.notEqual(retry, bad); await assert.rejects(retry);
});

test('on-demand grammars preserve aliases, nested fences and unknown-language fallback', async () => {
	const prepare = createProtectedMarkdownRenderer(() => 'github-dark');
	const prose = '# Explanation\n\n$x^2$';
	assert.match((await prepare(prose))(prose, 'https://shortestpath.cn'), /class="katex"/);
	for (const [language, code] of [['c++', 'int main() { return 0; }'], ['py', 'print(42)'], ['js', 'const n = 42;'], ['ts', 'const n: number = 42;'], ['sh', 'echo hello'], ['java', 'class Main {}'], ['json', '{"n":42}'], ['sql', 'SELECT 1']]) {
		const markdown = `> ~~~${language}\n> ${code}\n> ~~~`;
		assert.match((await prepare(markdown))(markdown, 'https://shortestpath.cn'), /class="shiki/);
	}
	const unknown = '```constructor\n<script>unsafe</script>\n```';
	assert.match((await prepare(unknown))(unknown, 'https://shortestpath.cn'), /&lt;script&gt;/);
	prepare.dispose();
});

test('report text and escaped code are available before deferred syntax highlighting', async () => {
	const render = createMarkdownRendererWithHighlighter(undefined, () => 'github-dark');
	const markdown = '# Explanation\n\n```cpp\nif (x < 2) return 0;\n```';
	const plain = render(markdown, 'https://shortestpath.cn');
	assert.match(plain, /<h1>Explanation<\/h1>/);
	assert.match(plain, /<pre data-reader-language="cpp"><code>if \(x &lt; 2\)/);
	const prepare = createProtectedMarkdownRenderer(() => 'github-dark');
	try {
		assert.match((await prepare.highlight('if (x < 2) return 0;', 'cpp'))!, /class="shiki/);
		assert.equal(await prepare.highlight('<script>plain</script>', 'unsupported'), undefined);
	} finally { prepare.dispose(); }
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

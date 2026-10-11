/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deduplicateLicenseNotices } from '../deduplicateLicenseNotices.ts';

test('every project retains its exact notice directly or through a local link', () => {
	const notices = ['\nCopyright Example &lt;authors&gt;\n\n' + 'License terms.\n'.repeat(30), 'Copyright Another\nDifferent license.\n', '\nCopyright Example &lt;authors&gt;\n\n' + 'License terms.\n'.repeat(30)];
	const source = Buffer.from(notices.map((notice, i) => `<div class="product"><span class="title">Project ${i}</span><div class="license"><pre>${notice}</pre></div></div>`).join('\n'));
	const output = deduplicateLicenseNotices(source).toString();
	const originals = new Map([...output.matchAll(/<pre id="(?<id>[^"]+)">(?<notice>[\s\S]*?)<\/pre>/g)].map(match => [match.groups!.id, match.groups!.notice]));
	const restored = [...output.matchAll(/<div class="product">(?<body>[\s\S]*?)<\/div><\/div>/g)].map(match => {
		const body = match.groups!.body;
		const link = /href="#(?<id>[^"]+)"/.exec(body);
		return link ? originals.get(link.groups!.id) : /<pre id="[^"]+">(?<notice>[\s\S]*?)<\/pre>/.exec(body)?.groups!.notice;
	});
	assert.deepStrictEqual(restored, notices);
	assert.ok(Buffer.byteLength(output) < source.length);
	assert.deepStrictEqual([...output.matchAll(/class="title">(?<title>[^<]+)/g)].map(match => match.groups!.title), ['Project 0', 'Project 1', 'Project 2']);
	assert.strictEqual(deduplicateLicenseNotices(Buffer.from(output)).toString(), output);
});

test('unrecognized credits and distinct notices remain byte-identical when rewriting has no benefit', () => {
	for (const source of ['<html>Upstream notice</html>', '<pre>One license</pre><pre>Another license</pre>', '<pre id="upstream-id">License</pre>']) {
		const input = Buffer.from(source);
		assert.strictEqual(deduplicateLicenseNotices(input), input);
	}
});

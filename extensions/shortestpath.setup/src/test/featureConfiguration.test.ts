/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchFeatureConfiguration } from '../featureConfiguration';

test('only remote boolean true enables Home; valid disabled flags do not consult a mirror', async t => {
	let value: unknown;
	const requests: string[] = [];
	t.mock.method(globalThis, 'fetch', async (url: string) => {
		requests.push(url);
		return Response.json(value);
	});
	for (const homepage of [true, false, 'true', 1, null, undefined]) {
		value = { homepage };
		requests.length = 0;
		assert.deepEqual(await fetchFeatureConfiguration(['https://github.example/features.json', 'https://gitcode.example/features.json']), { homepage: homepage === true });
		assert.deepEqual(requests, ['https://github.example/features.json']);
	}
});

test('failed or malformed GitHub flags try GitCode; failure of both disables Home', async t => {
	let githubFailure: 'network' | 'http' | 'json' | 'shape' = 'network';
	let mirrorAvailable = true;
	const requests: string[] = [];
	t.mock.method(globalThis, 'fetch', async (url: string) => {
		requests.push(url);
		if (url.includes('github')) {
			if (githubFailure === 'network') { throw new Error('Offline'); }
			if (githubFailure === 'http') { return new Response('', { status: 404 }); }
			if (githubFailure === 'json') { return new Response('<html>Not JSON</html>'); }
			return Response.json([]);
		}
		if (!mirrorAvailable) { throw new Error('Offline'); }
		return Response.json({ homepage: true });
	});
	const urls = ['https://github.example/features.json', 'https://gitcode.example/features.json'];
	for (githubFailure of ['network', 'http', 'json', 'shape'] as const) {
		requests.length = 0;
		assert.deepEqual(await fetchFeatureConfiguration(urls), { homepage: true });
		assert.deepEqual(requests, urls);
	}
	mirrorAvailable = false;
	assert.deepEqual(await fetchFeatureConfiguration(urls), { homepage: false });
});

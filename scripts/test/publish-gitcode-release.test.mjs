/*---------------------------------------------------------------------------------------------
 *  Copyright (c) ShortestPath IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('../publish-gitcode-release.mjs', import.meta.url));

async function createFixture(t, assets, existingAssets = []) {
	const testDirectory = await mkdtemp(join(tmpdir(), 'publish-gitcode-release-'));
	t.after(() => rm(testDirectory, { recursive: true, force: true }));
	const assetDirectory = join(testDirectory, 'assets');
	const binDirectory = join(testDirectory, 'bin');
	const curlEventLog = join(testDirectory, 'curl-events.jsonl');
	const fetchEventLog = join(testDirectory, 'fetch-events.jsonl');
	await mkdir(assetDirectory);
	await mkdir(binDirectory);

	for (const [name, size] of assets) {
		await writeFile(join(assetDirectory, name), Buffer.alloc(size));
	}
	const titleFile = join(testDirectory, 'title.txt');
	const notesFile = join(testDirectory, 'notes.md');
	const commitFile = join(testDirectory, 'commit.txt');
	await writeFile(titleFile, 'Test release\n');
	await writeFile(notesFile, 'Test notes\n');
	await writeFile(commitFile, '1234567890abcdef1234567890abcdef12345678\n');

	const fetchMock = join(testDirectory, 'fetch-mock.mjs');
	await writeFile(fetchMock, `
import { appendFileSync } from 'node:fs';
globalThis.fetch = async (input, options = {}) => {
	const url = new URL(input);
	if (url.pathname.endsWith('/tags')) {
		return Response.json([{ name: 'Release-v1.0.0', commit: { sha: process.env.GITCODE_TAG_SHA } }]);
	}
	if (url.pathname.endsWith('/upload_url')) {
		const assetName = url.searchParams.get('file_name');
		appendFileSync(process.env.FETCH_EVENT_LOG, JSON.stringify({ type: 'upload-url', assetName }) + '\\n');
		return Response.json({ url: 'https://upload.invalid/' + assetName, headers: {} });
	}
	if (options.method === 'DELETE') {
		appendFileSync(process.env.FETCH_EVENT_LOG, JSON.stringify({ type: 'delete', assetId: url.pathname.split('/').at(-1) }) + '\\n');
		return new Response(null, { status: 204 });
	}
	if (options.method === 'POST') {
		appendFileSync(process.env.FETCH_EVENT_LOG, JSON.stringify({ type: 'create', body: JSON.parse(options.body) }) + '\\n');
		return Response.json({ assets: [] });
	}
	if (options.method === 'PATCH') {
		return Response.json({});
	}
	if (url.pathname.endsWith('/releases/tags/Release-v1.0.0')) {
		if (process.env.RELEASE_MISSING === '1') {
			return new Response(null, { status: 404 });
		}
		return Response.json({ assets: JSON.parse(process.env.EXISTING_ASSETS) });
	}
	throw new Error('Unexpected fetch: ' + options.method + ' ' + url);
};
`);

	const fakeCurl = join(binDirectory, 'curl');
	await writeFile(fakeCurl, `#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
const assetPath = process.argv[process.argv.indexOf('--upload-file') + 1];
const assetName = basename(assetPath);
const hasMaxTime = process.argv.includes('--max-time');
let previousEvents = '';
try { previousEvents = readFileSync(process.env.CURL_EVENT_LOG, 'utf8'); } catch {}
const attempt = previousEvents.split('\\n')
	.filter(Boolean)
	.map(line => JSON.parse(line))
	.filter(event => event.event === 'start' && event.assetName === assetName).length + 1;
appendFileSync(process.env.CURL_EVENT_LOG, JSON.stringify({ event: 'start', assetName, attempt, hasMaxTime }) + '\\n');
process.stderr.write(' 50 0 0 0\\r');
const shouldFail = assetName === process.env.FAIL_ASSET && attempt <= Number(process.env.FAIL_ATTEMPTS ?? 0);
const delay = shouldFail ? 50 : Number(process.env.CURL_DELAY_MS ?? 250);
setTimeout(() => {
	const code = shouldFail ? 1 : 0;
	appendFileSync(process.env.CURL_EVENT_LOG, JSON.stringify({ event: 'end', assetName, attempt, code }) + '\\n');
	process.exit(code);
}, delay);
`);
	await chmod(fakeCurl, 0o755);

	return {
		curlEventLog,
		fetchEventLog,
		async run(extraEnvironment = {}) {
			return execFileAsync(process.execPath, [scriptPath,
				'--tag', 'Release-v1.0.0',
				'--title-file', titleFile,
				'--notes-file', notesFile,
				'--commit-file', commitFile,
				'--asset-directory', assetDirectory,
			], {
				env: {
					...process.env,
					CURL_EVENT_LOG: curlEventLog,
					EXISTING_ASSETS: JSON.stringify(existingAssets),
					FETCH_EVENT_LOG: fetchEventLog,
					GITHUB_REPOSITORY: 'owner/repository',
					GITCODE_OWNER: 'owner',
					GITCODE_REPOSITORY: 'repository',
					GITCODE_TAG_SHA: '1234567890abcdef1234567890abcdef12345678',
					ATOMGIT_TOKEN: 'token',
					NODE_OPTIONS: `--import=${fetchMock}`,
					PATH: `${binDirectory}:${process.env.PATH}`,
					...extraEnvironment,
				},
			});
		},
	};
}

async function readEvents(path) {
	return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

test('replaces existing assets and uploads all current assets largest first', async t => {
	const fixture = await createFixture(t, [
		['existing.bin', 50],
		['small.bin', 10],
		['largest.bin', 40],
		['medium.bin', 20],
		['large.bin', 30],
		['SHA256SUMS', 5],
	], [
		{ id: 'old-asset-id', name: 'existing.bin' },
		{ id: 'old-checksum-id', name: 'SHA256SUMS' },
	]);
	const { stdout } = await fixture.run();

	const events = await readEvents(fixture.curlEventLog);
	assert.ok(events.slice(0, 3).every(event => event.event === 'start'));
	assert.deepStrictEqual(events.slice(0, 3).map(event => event.assetName).sort(), ['existing.bin', 'large.bin', 'largest.bin']);
	assert.ok(events.filter(event => event.event === 'start').every(event => event.hasMaxTime === false));
	assert.equal(events.filter(event => event.event === 'start').length, 6);
	assert.equal(events.filter(event => event.event === 'end').length, 6);
	const fetchEvents = await readEvents(fixture.fetchEventLog);
	assert.deepStrictEqual(fetchEvents.filter(event => event.type === 'delete'), [
		{ type: 'delete', assetId: 'old-asset-id' },
		{ type: 'delete', assetId: 'old-checksum-id' },
	]);
	assert.match(stdout, /largest\.bin \[██████████░░░░░░░░░░\] 50%/);
});

test('gets a fresh upload URL on retry', async t => {
	const fixture = await createFixture(t, [['flaky.bin', 10]]);
	await fixture.run({ FAIL_ASSET: 'flaky.bin', FAIL_ATTEMPTS: '1' });

	const events = await readEvents(fixture.curlEventLog);
	assert.deepStrictEqual(events.filter(event => event.event === 'end').map(event => event.code), [1, 0]);
	const fetchEvents = await readEvents(fixture.fetchEventLog);
	assert.deepStrictEqual(fetchEvents, [
		{ type: 'upload-url', assetName: 'flaky.bin' },
		{ type: 'upload-url', assetName: 'flaky.bin' },
	]);
});

test('creates a release at the verified GitHub tag commit', async t => {
	const fixture = await createFixture(t, [['asset.bin', 10]]);
	await fixture.run({ RELEASE_MISSING: '1' });

	const fetchEvents = await readEvents(fixture.fetchEventLog);
	const create = fetchEvents.find(event => event.type === 'create');
	assert.equal(create.body.target_commitish, '1234567890abcdef1234567890abcdef12345678');
});

test('refuses to publish when the GitCode tag points to another commit', async t => {
	const fixture = await createFixture(t, [['asset.bin', 10]]);
	await assert.rejects(fixture.run({ GITCODE_TAG_SHA: 'abcdef1234567890abcdef1234567890abcdef12' }), /points to .* expected/);
	await assert.rejects(readFile(fixture.curlEventLog, 'utf8'), error => error.code === 'ENOENT');
});

test('waits for in-flight uploads and stops assigning work after a terminal failure', async t => {
	const fixture = await createFixture(t, [
		['failure.bin', 40],
		['slow-one.bin', 30],
		['slow-two.bin', 20],
		['queued.bin', 10],
	]);
	await assert.rejects(fixture.run({
		CURL_DELAY_MS: '2000',
		FAIL_ASSET: 'failure.bin',
		FAIL_ATTEMPTS: '2',
	}));

	const events = await readEvents(fixture.curlEventLog);
	assert.equal(events.filter(event => event.assetName === 'failure.bin' && event.event === 'end').length, 2);
	assert.ok(events.some(event => event.assetName === 'slow-one.bin' && event.event === 'end'));
	assert.ok(events.some(event => event.assetName === 'slow-two.bin' && event.event === 'end'));
	assert.ok(events.every(event => event.assetName !== 'queued.bin'));
});

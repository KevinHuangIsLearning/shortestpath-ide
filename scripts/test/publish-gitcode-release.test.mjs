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
	await writeFile(titleFile, 'Test release\n');
	await writeFile(notesFile, 'Test notes\n');

	const fetchMock = join(testDirectory, 'fetch-mock.mjs');
	await writeFile(fetchMock, `
import { appendFileSync } from 'node:fs';
globalThis.fetch = async (input, options = {}) => {
	const url = new URL(input);
	if (url.pathname.endsWith('/upload_url')) {
		const assetName = url.searchParams.get('file_name');
		appendFileSync(process.env.FETCH_EVENT_LOG, JSON.stringify({ assetName }) + '\\n');
		return Response.json({ url: 'https://upload.invalid/' + assetName, headers: {} });
	}
	if (options.method === 'PATCH') {
		return Response.json({});
	}
	if (url.pathname.endsWith('/releases/tags/Release-v1.0.0')) {
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
const maxTime = process.argv[process.argv.indexOf('--max-time') + 1];
let previousEvents = '';
try { previousEvents = readFileSync(process.env.CURL_EVENT_LOG, 'utf8'); } catch {}
const attempt = previousEvents.split('\\n')
	.filter(Boolean)
	.map(line => JSON.parse(line))
	.filter(event => event.event === 'start' && event.assetName === assetName).length + 1;
appendFileSync(process.env.CURL_EVENT_LOG, JSON.stringify({ event: 'start', assetName, attempt, maxTime }) + '\\n');
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
					GITCODE_TOKEN: 'token',
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

test('uploads the largest missing assets concurrently and skips existing assets', async t => {
	const fixture = await createFixture(t, [
		['existing.bin', 50],
		['small.bin', 10],
		['largest.bin', 40],
		['medium.bin', 20],
		['large.bin', 30],
	], [{ name: 'existing.bin' }]);
	const { stdout } = await fixture.run();

	const events = await readEvents(fixture.curlEventLog);
	assert.ok(events.slice(0, 3).every(event => event.event === 'start'));
	assert.deepStrictEqual(events.slice(0, 3).map(event => event.assetName).sort(), ['large.bin', 'largest.bin', 'medium.bin']);
	assert.ok(events.filter(event => event.event === 'start').every(event => event.maxTime === '1800'));
	assert.equal(events.filter(event => event.event === 'start').length, 4);
	assert.equal(events.filter(event => event.event === 'end').length, 4);
	assert.ok(events.every(event => event.assetName !== 'existing.bin'));
	assert.match(stdout, /largest\.bin \[██████████░░░░░░░░░░\] 50%/);
});

test('gets a fresh upload URL on retry', async t => {
	const fixture = await createFixture(t, [['flaky.bin', 10]]);
	await fixture.run({ FAIL_ASSET: 'flaky.bin', FAIL_ATTEMPTS: '1' });

	const events = await readEvents(fixture.curlEventLog);
	assert.deepStrictEqual(events.filter(event => event.event === 'end').map(event => event.code), [1, 0]);
	const fetchEvents = await readEvents(fixture.fetchEventLog);
	assert.deepStrictEqual(fetchEvents, [{ assetName: 'flaky.bin' }, { assetName: 'flaky.bin' }]);
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

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) ShortestPath IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('../download-github-release.mjs', import.meta.url));

async function createFixture(t, assets) {
	const testDirectory = await mkdtemp(join(tmpdir(), 'download-github-release-'));
	t.after(() => rm(testDirectory, { recursive: true, force: true }));
	const assetDirectory = join(testDirectory, 'assets');
	const binDirectory = join(testDirectory, 'bin');
	const eventLog = join(testDirectory, 'curl-events.jsonl');
	const titleFile = join(testDirectory, 'title.txt');
	const notesFile = join(testDirectory, 'notes.md');
	const commitFile = join(testDirectory, 'commit.txt');
	await mkdir(binDirectory);

	const fetchMock = join(testDirectory, 'fetch-mock.mjs');
	await writeFile(fetchMock, `
globalThis.fetch = async input => {
	if (new URL(input).pathname.includes('/commits/')) {
		return Response.json({ sha: '1234567890abcdef1234567890abcdef12345678' });
	}
	return Response.json({
		name: 'GitHub release title',
		body: 'GitHub release notes',
		draft: false,
		assets: JSON.parse(process.env.GITHUB_RELEASE_ASSETS),
	});
};
`);

	const fakeCurl = join(binDirectory, 'curl');
	await writeFile(fakeCurl, `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
const destination = process.argv[process.argv.indexOf('--output') + 1];
const url = new URL(process.argv.at(-1));
const assetName = basename(destination);
const size = Number(url.searchParams.get('size'));
appendFileSync(process.env.CURL_EVENT_LOG, JSON.stringify({ event: 'start', assetName }) + '\\n');
process.stderr.write(' 50 0 0 0\\r');
setTimeout(() => {
	writeFileSync(destination, Buffer.alloc(size));
	appendFileSync(process.env.CURL_EVENT_LOG, JSON.stringify({ event: 'end', assetName }) + '\\n');
}, 200);
`);
	await chmod(fakeCurl, 0o755);

	return {
		assetDirectory,
		commitFile,
		eventLog,
		notesFile,
		titleFile,
		async run() {
			return execFileAsync(process.execPath, [scriptPath,
				'--tag', 'Release-v1.0.0',
				'--title-file', titleFile,
				'--notes-file', notesFile,
				'--commit-file', commitFile,
				'--asset-directory', assetDirectory,
			], {
				env: {
					...process.env,
					CURL_EVENT_LOG: eventLog,
					GITHUB_RELEASE_ASSETS: JSON.stringify(assets),
					GITHUB_REPOSITORY: 'owner/repository',
					NODE_OPTIONS: `--import=${fetchMock}`,
					PATH: `${binDirectory}:${process.env.PATH}`,
				},
			});
		},
	};
}

function asset(name, size) {
	return { name, size, browser_download_url: `https://downloads.invalid/${name}?size=${size}` };
}

test('downloads four GitHub assets concurrently with named progress', async t => {
	const assets = [asset('one.bin', 10), asset('two.bin', 20), asset('three.bin', 30), asset('four.bin', 40)];
	const fixture = await createFixture(t, assets);
	const { stdout } = await fixture.run();

	const events = (await readFile(fixture.eventLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
	assert.ok(events.slice(0, 4).every(event => event.event === 'start'));
	assert.equal(events.filter(event => event.event === 'end').length, 4);
	assert.match(stdout, /four\.bin \[██████████░░░░░░░░░░\] 50%/);
	assert.equal(await readFile(fixture.titleFile, 'utf8'), 'GitHub release title\n');
	assert.equal(await readFile(fixture.notesFile, 'utf8'), 'GitHub release notes');
	assert.equal(await readFile(fixture.commitFile, 'utf8'), '1234567890abcdef1234567890abcdef12345678\n');
	for (const entry of assets) {
		assert.equal((await stat(join(fixture.assetDirectory, entry.name))).size, entry.size);
	}
});

test('rejects unsafe GitHub asset names before starting curl', async t => {
	const fixture = await createFixture(t, [asset('../escape.bin', 10)]);
	await assert.rejects(fixture.run(), /Unsafe GitHub Release asset name/);
	await assert.rejects(readFile(fixture.eventLog, 'utf8'), error => error.code === 'ENOENT');
});

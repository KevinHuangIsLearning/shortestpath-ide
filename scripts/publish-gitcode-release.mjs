/*---------------------------------------------------------------------------------------------
 *  Copyright (c) ShortestPath IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const apiBaseUrl = 'https://api.gitcode.com/api/v5';

function readArgument(name) {
	const index = process.argv.indexOf(name);
	if (index === -1 || !process.argv[index + 1]) {
		throw new Error(`Missing required argument: ${name}`);
	}
	return process.argv[index + 1];
}

function requiredEnvironment(name) {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

async function request(path, options = {}) {
	const response = await fetch(`${apiBaseUrl}${path}`, {
		...options,
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${token}`,
			...options.headers,
		},
	});
	return response;
}

const tag = readArgument('--tag');
const titleFile = readArgument('--title-file');
const notesFile = readArgument('--notes-file');
const assetDirectory = readArgument('--asset-directory');
const owner = requiredEnvironment('GITCODE_OWNER');
const repository = requiredEnvironment('GITCODE_REPOSITORY');
const token = requiredEnvironment('GITCODE_TOKEN');
const releasePath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/releases`;
const releaseTagPath = `${releasePath}/tags/${encodeURIComponent(tag)}`;
const title = (await readFile(titleFile, 'utf8')).trim();
const notes = await readFile(notesFile, 'utf8');
const releaseStatus = tag.startsWith('Beta-v') ? 'pre' : 'latest';

if (!title) {
	throw new Error('GitHub Release title is empty.');
}

let releaseResponse = await request(releaseTagPath);
let release;
if (releaseResponse.status === 404) {
	releaseResponse = await request(releasePath, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({
			tag_name: tag,
			name: title,
			body: notes,
			release_status: releaseStatus,
		}),
	});
	if (!releaseResponse.ok) {
		if (releaseResponse.status !== 409) {
			throw new Error(`GitCode Release creation failed with HTTP ${releaseResponse.status}.`);
		}
		releaseResponse = await request(releaseTagPath);
		if (!releaseResponse.ok) {
			throw new Error(`GitCode Release lookup after a creation conflict failed with HTTP ${releaseResponse.status}.`);
		}
		release = await releaseResponse.json();
		console.log(`GitCode Release ${tag} was created by another run; uploading only missing assets.`);
	} else {
		release = await releaseResponse.json();
		console.log(`Created GitCode Release ${tag}.`);
	}
} else if (releaseResponse.ok) {
	release = await releaseResponse.json();
	console.log(`GitCode Release ${tag} already exists; uploading only missing assets.`);
} else {
	throw new Error(`GitCode Release lookup failed with HTTP ${releaseResponse.status}.`);
}

const existingAssets = new Set((release.assets ?? []).map(asset => asset.name));
const assetNames = (await readdir(assetDirectory, { withFileTypes: true }))
	.filter(entry => entry.isFile())
	.map(entry => entry.name)
	.sort();
if (assetNames.length === 0) {
	throw new Error('No release assets were found.');
}

for (const assetName of assetNames) {
	if (existingAssets.has(assetName)) {
		console.log(`Keeping existing asset ${assetName}.`);
		continue;
	}

	const uploadUrlPath = `${releasePath}/${encodeURIComponent(tag)}/upload_url?file_name=${encodeURIComponent(assetName)}`;
	const uploadUrlResponse = await request(uploadUrlPath);
	if (!uploadUrlResponse.ok) {
		throw new Error(`GitCode upload URL request for ${assetName} failed with HTTP ${uploadUrlResponse.status}.`);
	}
	const upload = await uploadUrlResponse.json();
	const contents = await readFile(join(assetDirectory, assetName));
	const uploadResponse = await fetch(upload.url, {
		method: 'PUT',
		headers: upload.headers,
		body: contents,
	});
	if (!uploadResponse.ok) {
		throw new Error(`GitCode upload for ${assetName} failed with HTTP ${uploadResponse.status}.`);
	}
	console.log(`Uploaded ${assetName}.`);
}

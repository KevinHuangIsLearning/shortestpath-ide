/*---------------------------------------------------------------------------------------------
 *  Copyright (c) ShortestPath IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';

const apiBaseUrl = 'https://api.gitcode.com/api/v5';
const apiRequestTimeoutMs = 30_000;
const assetUploadTimeoutMs = 10 * 60_000;
const maxAttempts = 3;

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

function shouldRetry(response) {
	return response.status === 429 || response.status >= 500;
}

function delay(attempt) {
	return new Promise(resolve => setTimeout(resolve, attempt * 1_000));
}

function formatBytes(bytes) {
	const units = ['B', 'KiB', 'MiB', 'GiB'];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function rewriteReleaseNotes(notes, githubRepository, gitcodeOwner, gitcodeRepository, releaseTag) {
	const githubRepositoryUrl = `https://github.com/${githubRepository}`;
	const gitcodeRepositoryUrl = `https://gitcode.com/${gitcodeOwner}/${gitcodeRepository}`;
	const gitcodeDownloadUrl = `${gitcodeRepositoryUrl}/releases/download/${encodeURIComponent(releaseTag)}`;
	return notes
		.replaceAll(`${githubRepositoryUrl}/releases/latest/download`, gitcodeDownloadUrl)
		.replaceAll(`${githubRepositoryUrl}/releases/download/${encodeURIComponent(releaseTag)}`, gitcodeDownloadUrl)
		.replaceAll(githubRepositoryUrl, gitcodeRepositoryUrl);
}

function formatProgressBar(percent) {
	const width = 20;
	const complete = Math.floor(percent / 100 * width);
	return `[${'█'.repeat(complete)}${'░'.repeat(width - complete)}] ${percent}%`;
}

function createUploadBody(assetPath, assetName, totalBytes) {
	let sentBytes = 0;
	let lastReportedPercent = -1;
	const reportProgress = force => {
		const percent = Math.min(100, Math.floor(sentBytes / totalBytes * 100));
		const reportedPercent = Math.floor(percent / 5) * 5;
		if (force || reportedPercent > lastReportedPercent || sentBytes === totalBytes) {
			lastReportedPercent = reportedPercent;
			console.log(`${assetName} ${formatProgressBar(percent)} (${formatBytes(sentBytes)} / ${formatBytes(totalBytes)})`);
		}
	};
	const progress = new Transform({
		transform(chunk, encoding, callback) {
			sentBytes += chunk.length;
			reportProgress(false);
			callback(null, chunk);
		},
	});
	const progressInterval = setInterval(() => reportProgress(true), 30_000);
	return {
		body: Readable.toWeb(createReadStream(assetPath).pipe(progress)),
		stop: () => clearInterval(progressInterval),
	};
}

async function fetchWithTimeout(url, options, description, timeoutMs) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	const startedAt = Date.now();
	const heartbeat = setInterval(() => {
		console.log(`${description} is still in progress (${Math.floor((Date.now() - startedAt) / 1_000)} seconds elapsed).`);
	}, 30_000);
	try {
		return await fetch(url, { ...options, signal: controller.signal });
	} catch (error) {
		if (controller.signal.aborted) {
			throw new Error(`${description} timed out after ${Math.round(timeoutMs / 1_000)} seconds.`, { cause: error });
		}
		throw error;
	} finally {
		clearTimeout(timeout);
		clearInterval(heartbeat);
	}
}

async function request(path, options = {}) {
	const url = `${apiBaseUrl}${path}`;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const response = await fetchWithTimeout(url, {
				...options,
				headers: {
					Accept: 'application/json',
					Authorization: `Bearer ${token}`,
					...options.headers,
				},
			}, `GitCode API request to ${path}`, apiRequestTimeoutMs);
			if (!shouldRetry(response) || attempt === maxAttempts) {
				return response;
			}
			console.warn(`GitCode API request to ${path} returned HTTP ${response.status}; retrying (${attempt}/${maxAttempts}).`);
		} catch (error) {
			if (attempt === maxAttempts) {
				throw error;
			}
			console.warn(`${error.message} Retrying (${attempt}/${maxAttempts}).`);
		}
		await delay(attempt);
	}

	throw new Error(`GitCode API request to ${path} exhausted its retries.`);
}

const tag = readArgument('--tag');
const titleFile = readArgument('--title-file');
const notesFile = readArgument('--notes-file');
const assetDirectory = readArgument('--asset-directory');
const owner = requiredEnvironment('GITCODE_OWNER');
const repository = requiredEnvironment('GITCODE_REPOSITORY');
const token = requiredEnvironment('GITCODE_TOKEN');
const githubRepository = requiredEnvironment('GITHUB_REPOSITORY');
const releasePath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/releases`;
const releaseTagPath = `${releasePath}/tags/${encodeURIComponent(tag)}`;
const title = (await readFile(titleFile, 'utf8')).trim();
const notes = await readFile(notesFile, 'utf8');
const releaseNotes = rewriteReleaseNotes(notes, githubRepository, owner, repository, tag);
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
			body: releaseNotes,
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
	const updateResponse = await request(`${releasePath}/${encodeURIComponent(tag)}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			tag_name: tag,
			name: title,
			body: releaseNotes,
		}),
	});
	if (!updateResponse.ok) {
		throw new Error(`GitCode Release update failed with HTTP ${updateResponse.status}.`);
	}
	console.log(`Updated GitCode Release ${tag}; uploading only missing assets.`);
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

	const assetPath = join(assetDirectory, assetName);
	const assetSize = (await stat(assetPath)).size;
	const uploadUrlPath = `${releasePath}/${encodeURIComponent(tag)}/upload_url?file_name=${encodeURIComponent(assetName)}`;
	let uploaded = false;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		console.log(`Preparing upload for ${assetName} (${formatBytes(assetSize)}), attempt ${attempt}/${maxAttempts}.`);
		const uploadUrlResponse = await request(uploadUrlPath);
		if (!uploadUrlResponse.ok) {
			throw new Error(`GitCode upload URL request for ${assetName} failed with HTTP ${uploadUrlResponse.status}.`);
		}
		const upload = await uploadUrlResponse.json();
		try {
			console.log(`Uploading ${assetName} (${formatBytes(assetSize)}).`);
			const headers = { ...upload.headers };
			if (!Object.keys(headers).some(header => header.toLowerCase() === 'content-length')) {
				headers['Content-Length'] = String(assetSize);
			}
			const uploadProgress = createUploadBody(assetPath, assetName, assetSize);
			let uploadResponse;
			try {
				uploadResponse = await fetchWithTimeout(upload.url, {
					method: 'PUT',
					headers,
					body: uploadProgress.body,
					duplex: 'half',
				}, `GitCode upload for ${assetName}`, assetUploadTimeoutMs);
			} finally {
				uploadProgress.stop();
			}
			if (uploadResponse.ok) {
				uploaded = true;
				break;
			}
			if (!shouldRetry(uploadResponse) || attempt === maxAttempts) {
				throw new Error(`GitCode upload for ${assetName} failed with HTTP ${uploadResponse.status}.`);
			}
			console.warn(`GitCode upload for ${assetName} returned HTTP ${uploadResponse.status}; retrying (${attempt}/${maxAttempts}).`);
		} catch (error) {
			if (attempt === maxAttempts) {
				throw error;
			}
			console.warn(`${error.message} Retrying (${attempt}/${maxAttempts}).`);
		}
		await delay(attempt);
	}
	if (!uploaded) {
		throw new Error(`GitCode upload for ${assetName} exhausted its retries.`);
	}
	console.log(`Uploaded ${assetName}.`);
}

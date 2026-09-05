/*---------------------------------------------------------------------------------------------
 *  Copyright (c) ShortestPath IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const apiBaseUrl = 'https://api.gitcode.com/api/v5';
const apiRequestTimeoutMs = 30_000;
const maxAttempts = 3;
const maxUploadAttempts = 2;
const maxConcurrentUploads = 3;

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

async function uploadAsset(url, headers, assetPath, assetName, totalBytes) {
	const curlArguments = [
		'--fail',
		'--progress-meter',
		'--request', 'PUT',
		'--upload-file', assetPath,
		'--connect-timeout', '30',
		'--speed-limit', '1024',
		'--speed-time', '90',
		'--max-time', '1800',
	];
	for (const [header, value] of Object.entries(headers)) {
		curlArguments.push('--header', `${header}: ${value}`);
	}
	curlArguments.push(url);

	console.log(`Uploading ${assetName} (${formatBytes(totalBytes)}) with curl.`);
	await new Promise((resolve, reject) => {
		const curl = spawn('curl', curlArguments, { stdio: ['ignore', 'ignore', 'pipe'] });
		let lastPercent = 0;
		let lastReportedPercent = -1;
		let progressRemainder = '';
		let errorOutput = '';
		const reportProgress = force => {
			if (force || lastPercent >= lastReportedPercent + 5 || lastPercent === 100) {
				lastReportedPercent = lastPercent;
				console.log(`${assetName} ${formatProgressBar(lastPercent)} (${formatBytes(Math.floor(totalBytes * lastPercent / 100))} / ${formatBytes(totalBytes)})`);
			}
		};
		const progressInterval = setInterval(() => reportProgress(true), 30_000);
		const finish = callback => {
			clearInterval(progressInterval);
			callback();
		};
		curl.stderr.on('data', data => {
			const output = progressRemainder + data.toString();
			const lines = output.split(/\r|\n/);
			progressRemainder = lines.pop();
			for (const line of lines) {
				const percent = /^\s*(\d{1,3})\s+/.exec(line)?.[1];
				if (percent !== undefined) {
					lastPercent = Number(percent);
					reportProgress(false);
				} else if (line.trim()) {
					errorOutput += `${line}\n`;
				}
			}
		});
		curl.on('error', error => finish(() => reject(error)));
		curl.on('close', code => finish(() => {
			if (code === 0) {
				lastPercent = 100;
				reportProgress(true);
				resolve();
			} else {
				reject(new Error(`curl upload for ${assetName} exited with code ${code}.${errorOutput ? ` ${errorOutput.trim()}` : ''}`));
			}
		}));
	});
}

async function uploadReleaseAsset(releasePath, tag, asset) {
	const uploadUrlPath = `${releasePath}/${encodeURIComponent(tag)}/upload_url?file_name=${encodeURIComponent(asset.name)}`;
	for (let attempt = 1; attempt <= maxUploadAttempts; attempt++) {
		console.log(`Preparing upload for ${asset.name} (${formatBytes(asset.size)}), attempt ${attempt}/${maxUploadAttempts}.`);
		const uploadUrlResponse = await request(uploadUrlPath);
		if (!uploadUrlResponse.ok) {
			throw new Error(`GitCode upload URL request for ${asset.name} failed with HTTP ${uploadUrlResponse.status}.`);
		}
		const upload = await uploadUrlResponse.json();
		try {
			await uploadAsset(upload.url, upload.headers, asset.path, asset.name, asset.size);
			console.log(`Uploaded ${asset.name}.`);
			return;
		} catch (error) {
			if (attempt === maxUploadAttempts) {
				throw error;
			}
			console.warn(`${error.message} Retrying (${attempt}/${maxUploadAttempts}).`);
		}
		await delay(attempt);
	}

	throw new Error(`GitCode upload for ${asset.name} exhausted its retries.`);
}

async function uploadConcurrently(assets, concurrency, upload) {
	let nextAssetIndex = 0;
	let failure;
	async function worker() {
		while (!failure && nextAssetIndex < assets.length) {
			const asset = assets[nextAssetIndex++];
			try {
				await upload(asset);
			} catch (error) {
				failure ??= error;
			}
		}
	}

	const workerCount = Math.min(concurrency, assets.length);
	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	if (failure) {
		throw failure;
	}
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

const assetsToUpload = [];
for (const assetName of assetNames) {
	if (existingAssets.has(assetName)) {
		console.log(`Keeping existing asset ${assetName}.`);
		continue;
	}

	const assetPath = join(assetDirectory, assetName);
	const assetSize = (await stat(assetPath)).size;
	assetsToUpload.push({ name: assetName, path: assetPath, size: assetSize });
}

assetsToUpload.sort((first, second) => second.size - first.size || first.name.localeCompare(second.name));
console.log(`Uploading ${assetsToUpload.length} missing asset(s) with up to ${maxConcurrentUploads} concurrent uploads.`);
await uploadConcurrently(assetsToUpload, maxConcurrentUploads, asset => uploadReleaseAsset(releasePath, tag, asset));

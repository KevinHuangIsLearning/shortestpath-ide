/*---------------------------------------------------------------------------------------------
 *  Copyright (c) ShortestPath IDE contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const apiRequestTimeoutMs = 30_000;
const maxAttempts = 3;
const maxConcurrentDownloads = 4;

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

function formatProgressBar(percent) {
	const width = 20;
	const complete = Math.floor(percent / 100 * width);
	return `[${'█'.repeat(complete)}${'░'.repeat(width - complete)}] ${percent}%`;
}

async function fetchGitHub(repository, path) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), apiRequestTimeoutMs);
	const headers = {
		Accept: 'application/vnd.github+json',
		'User-Agent': 'shortestpath-gitcode-release-mirror',
		'X-GitHub-Api-Version': '2022-11-28',
	};
	if (process.env.GITHUB_TOKEN) {
		headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
	}
	try {
		return await fetch(`https://api.github.com/repos/${repository}${path}`, {
			headers,
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timeout);
	}
}

async function requestGitHub(repository, path, description) {
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const response = await fetchGitHub(repository, path);
			if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
				throw new Error('GitHub API rate limit exceeded. Configure the GitCode secret SOURCE_GITHUB_TOKEN with a GitHub token.');
			}
			if ((response.status !== 429 && response.status < 500) || attempt === maxAttempts) {
				return response;
			}
			console.warn(`${description} returned HTTP ${response.status}; retrying (${attempt}/${maxAttempts}).`);
		} catch (error) {
			if (error.message.includes('rate limit exceeded')) {
				throw error;
			}
			if (attempt === maxAttempts) {
				throw error;
			}
			console.warn(`${error.message} Retrying (${attempt}/${maxAttempts}).`);
		}
		await delay(attempt);
	}
	throw new Error(`${description} exhausted its retries.`);
}

async function downloadAsset(asset, destination) {
	const curlArguments = [
		'--fail',
		'--location',
		'--progress-meter',
		'--retry', '3',
		'--retry-all-errors',
		'--retry-delay', '2',
		'--connect-timeout', '30',
		'--speed-limit', '1024',
		'--speed-time', '300',
		'--output', destination,
	];
	curlArguments.push(asset.browser_download_url);

	console.log(`Downloading ${asset.name} (${formatBytes(asset.size)}) from GitHub.`);
	await new Promise((resolve, reject) => {
		const curl = spawn('curl', curlArguments, { stdio: ['ignore', 'ignore', 'pipe'] });
		let lastPercent = 0;
		let lastReportedPercent = -1;
		let progressRemainder = '';
		let errorOutput = '';
		const reportProgress = force => {
			if (force || lastPercent >= lastReportedPercent + 5 || lastPercent === 100) {
				lastReportedPercent = lastPercent;
				console.log(`${asset.name} ${formatProgressBar(lastPercent)} (${formatBytes(Math.floor(asset.size * lastPercent / 100))} / ${formatBytes(asset.size)})`);
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
				reject(new Error(`curl download for ${asset.name} exited with code ${code}.${errorOutput ? ` ${errorOutput.trim()}` : ''}`));
			}
		}));
	});

	const downloadedSize = (await stat(destination)).size;
	if (downloadedSize !== asset.size) {
		throw new Error(`Downloaded size for ${asset.name} was ${downloadedSize}, expected ${asset.size}.`);
	}
	console.log(`Downloaded ${asset.name}.`);
}

async function downloadConcurrently(assets, directory) {
	let nextAssetIndex = 0;
	let failure;
	async function worker() {
		while (!failure && nextAssetIndex < assets.length) {
			const asset = assets[nextAssetIndex++];
			try {
				await downloadAsset(asset, join(directory, asset.name));
			} catch (error) {
				failure ??= error;
			}
		}
	}

	const workerCount = Math.min(maxConcurrentDownloads, assets.length);
	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	if (failure) {
		throw failure;
	}
}

const tag = readArgument('--tag');
const assetDirectory = readArgument('--asset-directory');
const titleFile = readArgument('--title-file');
const notesFile = readArgument('--notes-file');
const commitFile = readArgument('--commit-file');
const githubRepository = requiredEnvironment('GITHUB_REPOSITORY');
const releaseResponse = await requestGitHub(githubRepository, `/releases/tags/${encodeURIComponent(tag)}`, 'GitHub Release request');
if (!releaseResponse.ok) {
	throw new Error(`GitHub Release lookup failed with HTTP ${releaseResponse.status}.`);
}
const release = await releaseResponse.json();
if (release.draft) {
	throw new Error(`GitHub Release ${tag} is still a draft.`);
}
if (!Array.isArray(release.assets) || release.assets.length === 0) {
	throw new Error(`GitHub Release ${tag} has no assets.`);
}
const commitResponse = await requestGitHub(githubRepository, `/commits/${encodeURIComponent(tag)}`, 'GitHub tag commit request');
if (!commitResponse.ok) {
	throw new Error(`GitHub tag commit lookup failed with HTTP ${commitResponse.status}.`);
}
const commit = await commitResponse.json();
if (!/^[0-9a-f]{40}$/i.test(commit.sha)) {
	throw new Error(`GitHub tag ${tag} did not resolve to a full commit SHA.`);
}

const assets = release.assets.map(asset => {
	if (!asset.name || basename(asset.name) !== asset.name || asset.name === '.' || asset.name === '..') {
		throw new Error(`Unsafe GitHub Release asset name: ${asset.name}`);
	}
	if (!Number.isSafeInteger(asset.size) || asset.size < 0 || !asset.browser_download_url) {
		throw new Error(`Invalid GitHub Release asset metadata for ${asset.name}.`);
	}
	return asset;
});

await mkdir(assetDirectory, { recursive: true });
await writeFile(titleFile, `${String(release.name || tag).trim()}\n`);
await writeFile(notesFile, release.body ?? '');
await writeFile(commitFile, `${commit.sha}\n`);
console.log(`Downloading ${assets.length} GitHub Release asset(s) with up to ${maxConcurrentDownloads} concurrent downloads.`);
await downloadConcurrently(assets, assetDirectory);

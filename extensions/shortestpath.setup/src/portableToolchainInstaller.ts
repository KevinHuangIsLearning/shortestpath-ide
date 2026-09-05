/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';
import * as yauzl from 'yauzl';

export type PortableAsset = {
	readonly id: string;
	readonly urls: readonly string[];
	readonly archiveName: string;
	readonly bundledArchivePath?: string;
	readonly targetDirectory: string;
	readonly requiredFile: string;
	readonly directoryToRemove?: string;
};

export type PortableInstallResult = {
	readonly success: boolean;
	readonly message: string;
};

export type PortableInstallOptions = {
	readonly appRoot: string;
	readonly toolchainRoot: string;
	readonly assets: readonly PortableAsset[];
	readonly reportProgress: (message: string) => void;
};

const { createZstdDecompress } = require('node:zlib') as { createZstdDecompress?: () => NodeJS.ReadWriteStream };

export async function installPortableAssets(options: PortableInstallOptions): Promise<PortableInstallResult> {
	try {
		await fs.promises.mkdir(options.toolchainRoot, { recursive: true });
		for (const asset of options.assets) {
			await installPortableAsset(options, asset);
		}
		options.reportProgress('Portable toolchain installation complete.');
		return { success: true, message: 'Toolchain download completed.' };
	} catch (error) {
		return { success: false, message: toErrorMessage(error) };
	}
}

async function installPortableAsset(options: PortableInstallOptions, asset: PortableAsset): Promise<void> {
	const targetPath = path.join(options.toolchainRoot, asset.targetDirectory);
	const requiredPath = path.join(targetPath, asset.requiredFile);
	if (fs.existsSync(requiredPath)) {
		options.reportProgress(`${asset.id} is already installed; skipping extraction.`);
		await removeAssetDirectory(targetPath, asset, options.reportProgress);
		return;
	}

	const bundledArchivePath = asset.bundledArchivePath
		? path.resolve(options.appRoot, asset.bundledArchivePath)
		: undefined;
	const useBundledArchive = !!bundledArchivePath && fs.existsSync(bundledArchivePath);
	const archivePath = useBundledArchive ? bundledArchivePath! : path.join(options.toolchainRoot, asset.archiveName);
	let downloaded = false;
	try {
		if (useBundledArchive) {
			options.reportProgress(`Installing bundled ${asset.id}…`);
		} else {
			if (!asset.urls.length) {
				throw new Error(`No download source is configured for ${asset.id}.`);
			}
			options.reportProgress(`Downloading ${asset.id}… 0%`);
			await downloadAsset(asset.urls, archivePath, asset.id, options.reportProgress);
			downloaded = true;
		}

		options.reportProgress(`Extracting ${asset.id}… 0%`);
		await extractAsset(archivePath, targetPath, asset.id, options.reportProgress);
		if (!fs.existsSync(requiredPath)) {
			throw new Error(`${asset.id} archive did not contain ${asset.requiredFile}.`);
		}
		await removeAssetDirectory(targetPath, asset, options.reportProgress);
	} finally {
		if (downloaded) {
			await fs.promises.rm(archivePath, { force: true });
		}
	}
}

async function removeAssetDirectory(targetPath: string, asset: PortableAsset, reportProgress: (message: string) => void): Promise<void> {
	if (!asset.directoryToRemove) {
		return;
	}
	const directoryPath = path.join(targetPath, asset.directoryToRemove);
	if (fs.existsSync(directoryPath)) {
		reportProgress(`Removing locale data from ${asset.id}…`);
		await fs.promises.rm(directoryPath, { recursive: true, force: true });
	}
}

async function downloadAsset(urls: readonly string[], targetPath: string, label: string, reportProgress: (message: string) => void): Promise<void> {
	let lastError: unknown;
	for (const [index, url] of urls.entries()) {
		try {
			if (index > 0) {
				reportProgress(`Mirror unavailable for ${label}; retrying with the official source…`);
			}
			await downloadFromUrl(url, targetPath, label, reportProgress, 0);
			return;
		} catch (error) {
			lastError = error;
			await fs.promises.rm(targetPath, { force: true });
		}
	}
	throw lastError ?? new Error('No download source is configured.');
}

async function downloadFromUrl(url: string, targetPath: string, label: string, reportProgress: (message: string) => void, redirectCount: number): Promise<void> {
	if (redirectCount > 5) {
		throw new Error(`Too many redirects while downloading ${label}.`);
	}

	const parsed = new URL(url);
	const requestFunction = parsed.protocol === 'http:' ? http.get : parsed.protocol === 'https:' ? https.get : undefined;
	if (!requestFunction) {
		throw new Error(`Unsupported download protocol for ${label}.`);
	}

	await new Promise<void>((resolve, reject) => {
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let timeoutMessage = 'Download connection timed out.';
		let request: import('node:http').ClientRequest | undefined;
		let responseStream: import('node:http').IncomingMessage | undefined;
		let settled = false;
		const finish = (error?: unknown) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			if (error) {
				request?.destroy();
				responseStream?.destroy();
				reject(error);
			} else {
				resolve();
			}
		};
		const resetTimeout = (message: string, delay: number) => {
			clearTimeout(timeout);
			timeoutMessage = message;
			timeout = setTimeout(() => finish(new Error(timeoutMessage)), delay);
		};

		reportProgress(`Connecting to download source for ${label}…`);
		resetTimeout('Download connection timed out.', 45_000);
		request = requestFunction(parsed, response => {
			responseStream = response;
			const location = response.headers.location;
			if (location && response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
				response.resume();
				void downloadFromUrl(new URL(location, parsed).toString(), targetPath, label, reportProgress, redirectCount + 1).then(() => finish(), finish);
				return;
			}
			if (response.statusCode !== 200) {
				response.resume();
				finish(new Error(`Download failed with HTTP ${response.statusCode ?? 'unknown'}.`));
				return;
			}

			resetTimeout('Download stalled while waiting for data.', 60_000);
			const totalBytes = Number(response.headers['content-length'] ?? 0);
			let receivedBytes = 0;
			let lastReportedPercent = -1;
			let lastProgressReport = 0;
			response.on('data', (chunk: Buffer | string) => {
				const size = Buffer.byteLength(chunk);
				receivedBytes += size;
				resetTimeout('Download stalled while receiving data.', 60_000);
				if (totalBytes > 0) {
					const percent = Math.floor(receivedBytes * 100 / totalBytes);
					if (percent === 100 || percent - lastReportedPercent >= 5) {
						lastReportedPercent = percent;
						reportProgress(`Downloading ${label}… ${percent}% (${formatBytes(receivedBytes)} / ${formatBytes(totalBytes)})`);
					}
				} else if (Date.now() - lastProgressReport >= 1_000) {
					lastProgressReport = Date.now();
					reportProgress(`Downloading ${label}… ${formatBytes(receivedBytes)}`);
				}
			});
			response.on('error', error => finish(error));
			void pipeline(response, createWriteStream(targetPath)).then(() => finish(), error => finish(error));
		});
		request.on('error', error => finish(error.message === 'socket hang up' ? new Error(timeoutMessage) : error));
	});
}

async function extractAsset(archivePath: string, targetPath: string, label: string, reportProgress: (message: string) => void): Promise<void> {
	await fs.promises.mkdir(targetPath, { recursive: true });
	if (archivePath.endsWith('.tar.zst')) {
		if (!createZstdDecompress) {
			throw new Error('This Node.js runtime cannot extract .tar.zst archives.');
		}
		const totalBytes = (await fs.promises.stat(archivePath)).size;
		let receivedBytes = 0;
		const input = createReadStream(archivePath);
		input.on('data', (chunk: Buffer | string) => {
			receivedBytes += Buffer.byteLength(chunk);
			const percent = totalBytes > 0 ? Math.floor(receivedBytes * 100 / totalBytes) : 0;
			reportProgress(`Extracting ${label}… ${percent}% (${formatBytes(receivedBytes)} / ${formatBytes(totalBytes)})`);
		});
		await pipeline(input, createZstdDecompress(), tar.x({ cwd: targetPath, strict: true }));
		reportProgress(`Extracting ${label}… 100% (${formatBytes(totalBytes)} / ${formatBytes(totalBytes)})`);
		return;
	}
	if (archivePath.endsWith('.zip')) {
		await extractZip(archivePath, targetPath, label, reportProgress);
		return;
	}
	throw new Error(`Unsupported archive format for ${label}.`);
}

function extractZip(archivePath: string, targetPath: string, label: string, reportProgress: (message: string) => void): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		let zipfile: yauzl.ZipFile | undefined;
		let completed = false;
		let extractedEntries = 0;
		const finish = (error?: unknown) => {
			if (completed) {
				return;
			}
			completed = true;
			if (error) {
				zipfile?.close();
				reject(error);
			} else {
				resolve();
			}
		};
		const readNext = () => {
			if (!completed) {
				zipfile?.readEntry();
			}
		};

		yauzl.open(archivePath, { lazyEntries: true }, (error, openedZipfile) => {
			if (error || !openedZipfile) {
				finish(error ?? new Error(`Unable to open ${label} archive.`));
				return;
			}
			zipfile = openedZipfile;
			zipfile.on('error', finish);
			zipfile.on('end', () => finish());
			zipfile.on('entry', entry => {
				const entryName = entry.fileName.replaceAll('\\', '/');
				const entryPath = path.resolve(targetPath, entryName);
				const normalizedTargetPath = path.resolve(targetPath);
				if (entryPath !== normalizedTargetPath && !entryPath.startsWith(`${normalizedTargetPath}${path.sep}`)) {
					finish(new Error(`Invalid file path in ${label} archive.`));
					return;
				}
				if (entryName.endsWith('/')) {
					void fs.promises.mkdir(entryPath, { recursive: true }).then(readNext, finish);
					return;
				}
				void fs.promises.mkdir(path.dirname(entryPath), { recursive: true }).then(() => {
					zipfile!.openReadStream(entry, (streamError, stream) => {
						if (streamError || !stream) {
							finish(streamError ?? new Error(`Unable to read ${entryName} from ${label} archive.`));
							return;
						}
						void pipeline(stream, createWriteStream(entryPath)).then(() => {
							extractedEntries++;
							const percent = zipfile!.entryCount > 0 ? Math.floor(extractedEntries * 100 / zipfile!.entryCount) : 100;
							reportProgress(`Extracting ${label}… ${percent}% (${extractedEntries}/${zipfile!.entryCount} files)`);
							readNext();
						}, finish);
					});
				}, finish);
			});
			readNext();
		});
	});
}

function formatBytes(bytes: number): string {
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

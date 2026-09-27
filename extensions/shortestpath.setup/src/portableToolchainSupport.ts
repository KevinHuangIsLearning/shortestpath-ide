/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Shared by the main-process onboarding window and the setup extension.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { createZstdDecompress } from 'node:zlib';
import { createHash } from 'node:crypto';
import * as tar from 'tar';

type RecoveryMessages = Record<'message' | 'detail' | 'relocate' | 'copy' | 'cancel', string>;
type ExtractionOptions = {
	readonly link?: (source: string, target: string) => Promise<void>;
	readonly onHardlinkError?: (error: Error) => Promise<string | undefined>;
};

class RelocationRequest extends Error {
	constructor(readonly root: string) {
		super('Toolchain relocation requested.');
	}
}

export function getRelocationRoot(error: unknown): string | undefined {
	return error instanceof RelocationRequest ? error.root : undefined;
}

function hasCode(error: unknown, ...codes: string[]): error is NodeJS.ErrnoException {
	return error instanceof Error && codes.includes((error as NodeJS.ErrnoException).code ?? '');
}

const completionFile = '.shortestpath-complete';

export function getRoot(defaultRoot: string, platform: NodeJS.Platform = process.platform): string {
	try {
		const root = JSON.parse(fs.readFileSync(path.join(defaultRoot, 'location.json'), 'utf8')).root;
		return platform === 'win32' && typeof root === 'string' && path.win32.isAbsolute(root) && /\\ShortestPath-Toolchains\\[a-f0-9]{12}\\User\\globalStorage\\shortestpath\.shortestpath-setup\\toolchains$/i.test(root) ? root : defaultRoot;
	} catch {
		return defaultRoot;
	}
}

export async function saveRoot(defaultRoot: string, root: string): Promise<void> {
	await fs.promises.mkdir(defaultRoot, { recursive: true });
	const location = path.join(defaultRoot, 'location.json');
	const temporary = `${location}.tmp`;
	await fs.promises.writeFile(temporary, JSON.stringify({ root }));
	await fs.promises.rename(temporary, location);
}

export function isComplete(target: string, asset: { readonly requiredFile: string; readonly archiveName: string }): boolean {
	return fs.existsSync(path.join(target, asset.requiredFile))
		&& (!asset.archiveName.endsWith('.tar.zst') || fs.existsSync(path.join(target, completionFile)));
}

// Never extract over an existing installation. A failed extraction must not be
// mistaken for a complete toolchain merely because g++.exe was already written.
export async function prepare(target: string, requiredFile: string, extract: (staging: string) => Promise<void>): Promise<void> {
	await fs.promises.mkdir(path.dirname(target), { recursive: true });
	const staging = await fs.promises.mkdtemp(`${target}.install-`);
	let backup: string | undefined;
	try {
		await extract(staging);
		if (!(await fs.promises.stat(path.join(staging, requiredFile))).isFile()) {
			throw new Error(`Archive did not contain ${requiredFile}.`);
		}
		await fs.promises.writeFile(path.join(staging, completionFile), '1');
		if (fs.existsSync(target)) {
			backup = `${staging}.previous`;
			await fs.promises.rename(target, backup);
		}
		try {
			await fs.promises.rename(staging, target);
		} catch (error) {
			if (backup) {
				await fs.promises.rename(backup, target);
				backup = undefined;
			}
			throw error;
		}
		if (backup) {
			await fs.promises.rm(backup, { recursive: true, force: true });
		}
	} finally {
		await fs.promises.rm(staging, { recursive: true, force: true });
	}
}

function archivePath(root: string, name: string): string {
	const normalized = name.replaceAll('\\', '/');
	if (!normalized || path.posix.isAbsolute(normalized) || normalized.includes(':') || normalized.split('/').includes('..')) {
		throw new Error(`Invalid hard link path in archive: ${name}`);
	}
	const absolute = path.resolve(root, normalized);
	if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) {
		throw new Error(`Invalid hard link path in archive: ${name}`);
	}
	return absolute;
}

async function checkParents(root: string, filename: string, create = false): Promise<void> {
	let current = path.resolve(root);
	const parts = path.relative(current, path.dirname(filename)).split(path.sep).filter(Boolean);
	for (const part of parts) {
		current = path.join(current, part);
		if (create) {
			try {
				await fs.promises.mkdir(current);
			} catch (error) {
				if (!hasCode(error, 'EEXIST')) {
					throw error;
				}
			}
		}
		const stat = await fs.promises.lstat(current);
		if (!stat.isDirectory() || stat.isSymbolicLink()) {
			throw new Error(`Invalid hard link parent in archive: ${current}`);
		}
	}
}

export async function extractTar(archive: string, target: string, onProgress: (percent: number, detail?: string) => void, options: ExtractionOptions = {}): Promise<void> {
	const links: { target: string; source: string }[] = [];
	let pathError: unknown;
	const total = (await fs.promises.stat(archive)).size;
	let received = 0;
	const input = fs.createReadStream(archive);
	input.on('data', chunk => {
		received += chunk.length;
		onProgress(Math.floor(received * 100 / total), `${(received / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB`);
	});
	await pipeline(input, createZstdDecompress(), tar.x({
		cwd: target,
		strict: true,
		filter: (name, entry) => {
			if (!(entry instanceof tar.ReadEntry) || entry.type !== 'Link') {
				return true;
			}
			try {
				links.push({ target: archivePath(target, name), source: archivePath(target, entry.linkpath ?? '') });
			} catch (error) {
				pathError = error;
			}
			return false;
		}
	}));
	if (pathError) {
		throw pathError;
	}
	let copy = false;
	// Some archives link to a name declared later, or to another hard link.
	while (links.length) {
		let progressed = false;
		for (let index = 0; index < links.length;) {
			const link = links[index];
			let sourceStat;
			try {
				await checkParents(target, link.source);
				sourceStat = await fs.promises.lstat(link.source);
			} catch (error) {
				if (hasCode(error, 'ENOENT')) {
					index++;
					continue;
				}
				throw error;
			}
			if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
				throw new Error(`Hard link source is not a regular file: ${link.source}`);
			}
			await checkParents(target, link.target, true);
			if (!copy) {
				try {
					await (options.link || fs.promises.link)(link.source, link.target);
				} catch (error) {
					if (!hasCode(error, 'EISDIR', 'EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV')) {
						throw error;
					}
					const choice = await options.onHardlinkError?.(error);
					if (!choice) {
						throw error;
					}
					if (choice !== 'copy') {
						throw new RelocationRequest(choice);
					}
					copy = true;
				}
			}
			if (copy) {
				await fs.promises.copyFile(link.source, link.target, fs.constants.COPYFILE_EXCL);
			}
			links.splice(index, 1);
			progressed = true;
		}
		if (!progressed) {
			throw new Error('Archive contains missing or cyclic hard link targets.');
		}
	}
	onProgress(100);
}

export function getRelocatedRoot(defaultRoot: string, localAppData = process.env['LOCALAPPDATA'] || path.join(homedir(), 'AppData', 'Local')): string {
	const id = createHash('sha256').update(defaultRoot).digest('hex').slice(0, 12);
	return path.win32.join(localAppData, 'ShortestPath-Toolchains', id, 'User', 'globalStorage', 'shortestpath.shortestpath-setup', 'toolchains');
}

export function getRecoveryMessages(locale: string, defaults?: RecoveryMessages): RecoveryMessages {
	return /^zh(?:-|$)/i.test(locale) ? {
		// allow-any-unicode-next-line
		message: '无法在当前位置创建编译工具链所需的硬链接。',
		// allow-any-unicode-next-line
		detail: '安装到 AppData：自动安装到 %LOCALAPPDATA%\\ShortestPath-Toolchains 下，仅迁移编译工具链，IDE 保持原位置。复制两份：留在当前位置，将硬链接保存为独立文件，会占用更多空间。',
		// allow-any-unicode-next-line
		relocate: '安装到 AppData',
		// allow-any-unicode-next-line
		copy: '复制两份',
		// allow-any-unicode-next-line
		cancel: '取消'
	} : defaults || {
		message: 'Unable to create the hard links required by the compiler toolchain at this location.',
		detail: 'Install in AppData: Automatically install the toolchain under %LOCALAPPDATA%\\ShortestPath-Toolchains; the IDE stays in place. Copy Both Files: Stay here and store hard links as separate files, using more disk space.',
		relocate: 'Install in AppData',
		copy: 'Copy Both Files',
		cancel: 'Cancel'
	};
}


/** Keep the GCC installation path free of spaces on its own volume. */
export function getSpaceSafeCompilerPath(compiler: string, toolchainRoot: string, fileSystem: Pick<typeof fs, 'existsSync' | 'realpathSync' | 'symlinkSync'> = fs): string {
	if (!/\s/.test(compiler)) {
		return compiler;
	}
	const managedRoot = /^(.*)\\User\\(?:profiles\\[^\\]+\\)?globalStorage\\shortestpath\.shortestpath-setup\\toolchains$/i.exec(toolchainRoot)?.[1];
	if (!managedRoot) {
		return compiler;
	}
	const relative = path.win32.relative(managedRoot, compiler);
	if (path.win32.isAbsolute(relative) || relative.startsWith('..')) {
		return compiler;
	}
	const hash = createHash('sha256').update(managedRoot.toLowerCase()).digest('hex').slice(0, 12);
	const alias = path.win32.join(path.win32.parse(managedRoot).root, `.shortestpath-toolchain-${hash}`);
	try {
		if (fileSystem.existsSync(alias)) {
			if (String(fileSystem.realpathSync(alias)).replaceAll('\\', '/').toLowerCase() !== managedRoot.replaceAll('\\', '/').toLowerCase()) {
				return compiler;
			}
		} else {
			fileSystem.symlinkSync(managedRoot, alias, 'junction');
		}
		return path.win32.join(alias, relative);
	} catch {
		return compiler;
	}
}

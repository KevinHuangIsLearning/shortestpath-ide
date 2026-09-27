/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { zstdCompressSync } from 'node:zlib';
import { Header } from 'tar';
import { installPortableAssets, portableToolchain } from '../portableToolchainInstaller';

type Entry = { path: string; type?: 'File' | 'Link' | 'SymbolicLink' | 'Directory'; linkpath?: string; body?: string };
async function fixture(entries: Entry[], run: (archive: string, target: string, root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), 'shortestpath-recovery-'));
	try {
		const blocks: Buffer[] = [];
		for (const entry of entries) {
			const body = Buffer.from(entry.body ?? '');
			const header = new Header({ path: entry.path, type: entry.type ?? 'File', linkpath: entry.linkpath, mode: 0o755, size: body.length });
			header.encode();
			blocks.push(header.block!, body, Buffer.alloc((512 - body.length % 512) % 512));
		}
		blocks.push(Buffer.alloc(1024));
		const archive = path.join(root, 'compiler.tar.zst');
		await writeFile(archive, zstdCompressSync(Buffer.concat(blocks)));
		const target = path.join(root, 'compiler');
		await mkdir(target);
		await run(archive, target, root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

const localAppData = 'C:\\Users\\Tester\\AppData\\Local';

const entries: Entry[] = [
	{ path: 'bin/ld.exe', type: 'Link', linkpath: 'bin/ld.bfd.exe' },
	{ path: 'bin/g++.exe', body: 'compiler' },
	{ path: 'bin/ld.bfd.exe', body: 'linker' },
	{ path: 'bin/alias.exe', type: 'Link', linkpath: 'bin/ld.exe' }
];
const unsupported = Object.assign(new Error('EISDIR: link unsupported'), { code: 'EISDIR' });
const rejectLink = async () => { throw unsupported; };

test('retains hard links on supported volumes, including forward references and chains', async () => {
	await fixture(entries, async (archive, target) => {
		await portableToolchain.extractTar(archive, target, () => undefined, {});
		const files = await Promise.all(['ld.exe', 'ld.bfd.exe', 'alias.exe'].map(name => stat(path.join(target, 'bin', name))));
		assert.ok(files.every(file => file.ino === files[0].ino && file.nlink === 3));
	});
});

test('copy choice prompts once and materializes every hard link as an independent file', async () => {
	await fixture(entries, async (archive, target) => {
		let prompts = 0;
		await portableToolchain.extractTar(archive, target, () => undefined, {
			link: rejectLink,
			onHardlinkError: async () => { prompts++; return 'copy'; }
		});
		await writeFile(path.join(target, 'bin', 'ld.bfd.exe'), 'changed');
		assert.deepStrictEqual({ prompts, alias: await readFile(path.join(target, 'bin', 'alias.exe'), 'utf8'), linker: await readFile(path.join(target, 'bin', 'ld.exe'), 'utf8') }, { prompts: 1, alias: 'linker', linker: 'linker' });
	});
});

test('cancel preserves the old installation and removes partial staging files', async () => {
	await fixture(entries, async (archive, target, root) => {
		await writeFile(path.join(target, 'old'), 'preserved');
		await assert.rejects(portableToolchain.prepare(target, 'bin/g++.exe', staging => portableToolchain.extractTar(archive, staging, () => undefined, { link: rejectLink, onHardlinkError: async () => undefined })), unsupported);
		assert.deepStrictEqual(await readdir(target), ['old']);
		assert.deepStrictEqual((await readdir(root)).sort(), ['compiler', 'compiler.tar.zst']);
	});
});

test('AppData choice propagates the destination after cleaning the incomplete extraction', async () => {
	await fixture(entries, async (archive, target) => {
		const destination = portableToolchain.getRelocatedRoot('D:\\IDE\\data', localAppData);
		await assert.rejects(portableToolchain.prepare(target, 'bin/g++.exe', staging => portableToolchain.extractTar(archive, staging, () => undefined, { link: rejectLink, onHardlinkError: async () => destination })), error => portableToolchain.getRelocationRoot(error) === destination);
		assert.equal(existsSync(path.join(target, 'bin/g++.exe')), false);
	});
});

test('unrelated hard link errors do not offer filesystem recovery', async () => {
	await fixture(entries, async (archive, target) => {
		await assert.rejects(portableToolchain.extractTar(archive, target, () => undefined, {
			link: async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); },
			onHardlinkError: async () => { assert.fail('must not prompt'); }
		}), { code: 'ENOSPC' });
	});
});

for (const [name, invalid] of Object.entries<Entry[]>({
	traversal: [{ path: '../escape', type: 'Link', linkpath: 'bin/ld.bfd.exe' }],
	absolute: [{ path: 'bad', type: 'Link', linkpath: '/outside' }],
	cycle: [{ path: 'first', type: 'Link', linkpath: 'second' }, { path: 'second', type: 'Link', linkpath: 'first' }],
	directory: [{ path: 'directory/', type: 'Directory' }, { path: 'bad', type: 'Link', linkpath: 'directory' }],
	symlink: [{ path: 'sym', type: 'SymbolicLink', linkpath: 'bin/ld.bfd.exe' }, { path: 'bad', type: 'Link', linkpath: 'sym' }],
	parentSymlink: [{ path: 'sym', type: 'SymbolicLink', linkpath: 'bin' }, { path: 'sym/sub/bad', type: 'Link', linkpath: 'bin/ld.bfd.exe' }]
})) {
	test(`rejects ${name} hard links without following unsafe paths`, async () => {
		await fixture([...entries, ...invalid], async (archive, target) => {
			await assert.rejects(portableToolchain.extractTar(archive, target, () => undefined, { link: rejectLink, onHardlinkError: async () => 'copy' }));
			assert.equal(existsSync(path.join(target, 'bin/sub')), false);
		});
	});
}

test('reinstalls a legacy partial tar extraction and marks completion only after all files are present', async () => {
	await fixture(entries, async (_archive, target, root) => {
		await mkdir(path.join(target, 'bin'));
		await writeFile(path.join(target, 'bin/g++.exe'), 'incomplete');
		const asset = { id: 'compiler', urls: [], archiveName: 'compiler.tar.zst', bundledArchivePath: 'compiler.tar.zst', targetDirectory: 'compiler', requiredFile: 'bin/g++.exe' };
		assert.equal(portableToolchain.isComplete(target, asset), false);
		const result = await installPortableAssets({ appRoot: root, toolchainRoot: root, assets: [asset], reportProgress: () => undefined });
		assert.equal(result.success, true);
		assert.equal(portableToolchain.isComplete(target, asset), true);
		assert.equal(await readFile(path.join(target, 'bin/alias.exe'), 'utf8'), 'linker');
	});
});

test('AppData destination is deterministic, isolates installations, and follows redirected LocalAppData', () => {
	const first = portableToolchain.getRelocatedRoot('D:\\IDE', localAppData);
	assert.match(first, /^C:\\Users\\Tester\\AppData\\Local\\ShortestPath-Toolchains\\[a-f0-9]{12}\\User\\globalStorage\\shortestpath.shortestpath-setup\\toolchains$/);
	assert.equal(first, portableToolchain.getRelocatedRoot('D:\\IDE', localAppData));
	assert.notEqual(first, portableToolchain.getRelocatedRoot('E:\\IDE', localAppData));
	assert.ok(portableToolchain.getRelocatedRoot('D:\\IDE', 'E:\\LocalAppData').startsWith('E:\\LocalAppData\\ShortestPath-Toolchains\\'));
});

test('recovery choices have complete Chinese and English text', () => {
	const zh = portableToolchain.getRecoveryMessages('zh-cn');
	const en = portableToolchain.getRecoveryMessages('en');
	assert.deepStrictEqual([zh.relocate, zh.copy, en.relocate, en.copy], ['安装到 AppData', '复制两份', 'Install in AppData', 'Copy Both Files']);
	assert.deepStrictEqual(Object.keys(zh), Object.keys(en));
});

test('saved AppData location survives reload and invalid pointers fall back to the portable directory', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'shortestpath-location-'));
	try {
		const destination = portableToolchain.getRelocatedRoot('D:\\IDE\\data', 'E:\\LocalAppData');
		await portableToolchain.saveRoot(root, destination);
		assert.equal(portableToolchain.getRoot(root, 'win32'), destination);
		assert.equal(portableToolchain.getRoot(root, 'linux'), root);
		await writeFile(path.join(root, 'location.json'), '{broken');
		assert.equal(portableToolchain.getRoot(root, 'win32'), root);
		await writeFile(path.join(root, 'location.json'), JSON.stringify({ root: 'D:\\unexpected' }));
		assert.equal(portableToolchain.getRoot(root, 'win32'), root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('existing managed compiler paths with spaces use an alias on their own volume', () => {
	const root = 'C:\\My Tools\\User\\globalStorage\\shortestpath.shortestpath-setup\\toolchains';
	const compiler = path.win32.join(root, 'winlibs', 'mingw64-ucrt-15', 'bin', 'g++.exe');
	const links: string[][] = [];
	const alias = portableToolchain.getSpaceSafeCompilerPath(compiler, root, {
		existsSync: () => false,
		realpathSync: Object.assign(() => { throw new Error('unexpected realpath'); }, { native: () => { throw new Error('unexpected realpath'); } }),
		symlinkSync: (source, target) => { links.push([String(source), String(target)]); }
	});
	assert.equal(links.length, 1);
	assert.equal(links[0][0], 'C:\\My Tools');
	assert.match(links[0][1], /^C:\\\.shortestpath-toolchain-[a-f0-9]{12}$/);
	assert.equal(/\s/.test(alias), false);
	assert.match(alias, /\\User\\globalStorage\\shortestpath\.shortestpath-setup\\toolchains\\winlibs\\mingw64-ucrt-15\\bin\\g\+\+\.exe$/);
});

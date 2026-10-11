/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

/** Builds the app-local macOS phase monitor as an ABI-stable Node-API addon. */
export async function buildTrackpadGestureMonitor(root: string, outDir: string): Promise<void> {
	if (process.platform !== 'darwin') {
		return;
	}
	const version = /^target="([^"]+)"/m.exec(await fs.readFile(path.join(root, '.npmrc'), 'utf8'))?.[1];
	if (!version) {
		throw new Error('Missing Electron header version');
	}
	const cache = process.env.npm_config_devdir ?? path.join(os.homedir(), 'Library/Caches/node-gyp');
	let headers = path.join(cache, version, 'include/node');
	try {
		await fs.access(path.join(headers, 'node_api.h'));
	} catch {
		// Node-API needs only the C headers. Do not depend on a globally installed
		// node-gyp CLI, which is absent from clean repository installations.
		headers = path.join(root, '.build', 'trackpad-headers', version, 'include/node');
		try {
			await fs.access(path.join(headers, 'node_api.h'));
		} catch {
			const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'shortestpath-trackpad-headers-'));
			try {
				const response = await fetch(`https://electronjs.org/headers/v${version}/node-v${version}-headers.tar.gz`, { signal: AbortSignal.timeout(60000) });
				if (!response.ok) { throw new Error(`Cannot download Electron headers: ${response.status}`); }
				const archive = path.join(temporary, 'headers.tar.gz');
				await fs.writeFile(archive, Buffer.from(await response.arrayBuffer()));
				const extract = spawnSync('tar', ['-xzf', archive, '-C', temporary, `node-v${version}/include/node`], { stdio: 'inherit' });
				if (extract.error || extract.status !== 0) { throw extract.error ?? new Error('Cannot extract Electron headers'); }
				await fs.mkdir(headers, { recursive: true });
				await fs.cp(path.join(temporary, `node-v${version}/include/node`), headers, { recursive: true });
			} finally {
				await fs.rm(temporary, { recursive: true, force: true });
			}
		}
	}
	const arch = process.env.VSCODE_ARCH ?? process.arch;
	if (arch !== 'arm64' && arch !== 'x64') {
		throw new Error(`Unsupported macOS architecture: ${arch}`);
	}
	const output = path.join(outDir, 'vs/platform/browserView/electron-main/trackpadGestureMonitor.node');
	await fs.mkdir(path.dirname(output), { recursive: true });
	const result = spawnSync('xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-dynamiclib', '-undefined', 'dynamic_lookup', '-framework', 'AppKit', '-arch', arch === 'x64' ? 'x86_64' : 'arm64', '-mmacosx-version-min=12.0', '-I', headers, path.join(root, 'build/native/trackpadGestureMonitor.mm'), '-o', output], { stdio: 'inherit' });
	if (result.error || result.status !== 0) {
		throw result.error ?? new Error('Cannot build the macOS trackpad phase monitor');
	}
}

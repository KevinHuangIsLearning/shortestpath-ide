/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

for (const configuredCache of [false, true]) {
	test(`Electron compatibility headers are patched in the downloaded cache (configured=${configuredCache})`, () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-headers-'));
		try {
			const scriptDirectory = path.join(root, 'build', 'npm');
			const cache = configuredCache ? path.join(root, 'custom-cache') : path.join(root, '.build', 'node-gyp');
			const patches = path.join(scriptDirectory, 'gyp', 'custom-headers');
			fs.mkdirSync(patches, { recursive: true });
			fs.mkdirSync(path.join(root, 'remote'));
			fs.writeFileSync(path.join(root, '.npmrc'), 'disturl="https://electronjs.org/headers"\ntarget="43.6.0"\n');
			fs.writeFileSync(path.join(root, 'remote', '.npmrc'), '');
			fs.writeFileSync(path.join(patches, 'v8-source-location.h'), 'compatible header');
			const installs: string[][] = [];
			const source = fs.readFileSync(new URL('../../npm/preinstall.ts', import.meta.url), 'utf8');
			const body = stripTypeScriptTypes(source.slice(source.indexOf('function installHeaders()')).replaceAll('import.meta.dirname', 'scriptDirectory'));
			vm.runInNewContext(`${body}\ninstallHeaders();`, {
				fs, path, scriptDirectory, console: { log() {} },
				process: { platform: 'linux', env: configuredCache ? { npm_config_devdir: cache } : {} },
				child_process: {
					execSync() {},
					execFileSync(_file: string, args: string[]) {
						installs.push([...args]);
						const headers = path.join(args[args.indexOf('--devdir') + 1], args.at(-1)!, 'include', 'node');
						fs.mkdirSync(headers, { recursive: true });
						fs.writeFileSync(path.join(headers, 'v8-source-location.h'), 'original header');
					}
				}
			});
			assert.deepStrictEqual({ installs, header: fs.readFileSync(path.join(cache, '43.6.0', 'include', 'node', 'v8-source-location.h'), 'utf8') }, {
				installs: [['install', '--devdir', cache, '--dist-url', 'https://electronjs.org/headers', '43.6.0']], header: 'compatible header'
			});
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
}

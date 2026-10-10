/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as esbuild from 'esbuild';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { buildDarkReaderPreload } from './darkReader.ts';

const root = path.resolve(import.meta.dirname, '../..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'shortestpath-dark-reader-tests-'));
try {
	const product = JSON.parse(await fs.readFile(path.join(root, 'product.json'), 'utf8'));
	const executable = process.platform === 'darwin'
		? path.join(root, '.build/electron', `${product.nameLong}.app`, 'Contents/MacOS', product.nameShort)
		: path.join(root, '.build/electron', process.platform === 'win32' ? `${product.applicationName}.exe` : product.applicationName);
	const preload = path.join(temporary, 'preload-darkReader.cjs');
	const result = await buildDarkReaderPreload(path.join(root, 'src/vs/platform/browserView/electron-browser/preload-darkReader.ts'), preload, process.argv.includes('--minify'));
	for (const file of result.outputFiles) {
		await fs.writeFile(file.path, file.contents);
	}
	const suite = path.join(temporary, 'suite.cjs');
	const report = path.join(temporary, 'result.txt');
	await esbuild.build({
		entryPoints: [path.join(root, 'test/integration/browserView/darkReader.ts')],
		outfile: suite,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		external: ['electron'],
		define: { DARK_READER_TEST_PRELOAD: JSON.stringify(preload), DARK_READER_TEST_REPORT: JSON.stringify(report) },
	});
	process.exitCode = await new Promise<number>((resolve, reject) => {
		const child = spawn(executable, [suite, `--user-data-dir=${path.join(temporary, 'profile')}`], { stdio: 'inherit' });
		child.once('error', reject);
		child.once('exit', code => resolve(code ?? 1));
	});
	if (process.exitCode === 0 && await fs.readFile(report, 'utf8').catch(() => '') !== '3 partitions passed') {
		throw new Error('Electron exited before the integration suite completed');
	}
} finally {
	await fs.rm(temporary, { recursive: true, force: true });
}

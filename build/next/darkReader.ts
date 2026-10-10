/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as esbuild from 'esbuild';
import * as path from 'path';
import * as fs from 'fs';

/** Build a sandbox-compatible preload with a self-contained isolated-world payload. */
export async function buildDarkReaderPreload(entryPath: string, outPath: string, minify: boolean): Promise<esbuild.BuildResult & { outputFiles: esbuild.OutputFile[] }> {
	const license = await fs.promises.readFile(path.resolve(import.meta.dirname, '../../node_modules/darkreader/LICENSE'), 'utf8');
	const detector = await esbuild.build({
		entryPoints: [path.resolve(import.meta.dirname, '../../resources/vendor/darkreader/src/inject/detector.ts')],
		bundle: true,
		format: 'iife',
		globalName: 'shortestPathDarkReaderDetector',
		platform: 'browser',
		target: ['es2024'],
		minify,
		write: false,
		define: { __TEST__: 'false', __PLUS__: 'false', __CHROMIUM_MV2__: 'false', __CHROMIUM_MV3__: 'false', __FIREFOX_MV2__: 'false', __THUNDERBIRD__: 'false' },
		banner: { js: `/*! Dark Reader native dark theme detector\n${license.replaceAll('*/', '* /')} */` },
	});
	const script = await esbuild.build({
		entryPoints: [path.join(path.dirname(entryPath), 'darkReaderScript.ts')],
		bundle: true,
		platform: 'browser',
		format: 'iife',
		target: ['es2024'],
		minify,
		write: false,
		legalComments: 'inline',
		banner: { js: `/*! Dark Reader\n${license.replaceAll('*/', '* /')} */` },
	});
	return esbuild.build({
		entryPoints: [entryPath],
		outfile: outPath,
		bundle: true,
		platform: 'node',
		external: ['electron'],
		format: 'cjs',
		target: ['es2024'],
		minify,
		sourcemap: 'linked',
		sourcesContent: true,
		write: false,
		banner: { js: '/*! Copyright (c) 2026 ShortestPath IDE contributors. GPL-3.0-or-later. See LICENSE. */' },
		define: { DARK_READER_SCRIPT: JSON.stringify(`${detector.outputFiles[0].text}\n${script.outputFiles[0].text}`) },
	});
}

/** Also used after the legacy gulp compiler, which cannot bundle sandbox imports. */
export async function writeDarkReaderPreload(srcDir: string, outDir: string): Promise<void> {
	const relativePath = 'vs/platform/browserView/electron-browser/preload-darkReader';
	const result = await buildDarkReaderPreload(path.join(srcDir, `${relativePath}.ts`), path.join(outDir, `${relativePath}.js`), false);
	for (const file of result.outputFiles) {
		await fs.promises.mkdir(path.dirname(file.path), { recursive: true });
		await fs.promises.writeFile(file.path, file.contents);
	}
}

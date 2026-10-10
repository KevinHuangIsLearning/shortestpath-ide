/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as crypto from 'crypto';
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { suite, test, type TestContext } from 'node:test';
import { Writable } from 'stream';
import { pipeline } from 'stream/promises';
import * as vm from 'vm';
import { SourceMapConsumer, type RawSourceMap } from 'source-map';
import type Vinyl from 'vinyl';
import vfs from 'vinyl-fs';
import { filter, gulp } from '../../lib/gulp/facade.ts';
import { compileStandaloneFiles } from '../standalone.ts';
import { applyIncrementalClientChanges, transpileFile, transpileLocalizedFiles } from '../transpile.ts';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const srcDir = path.join(repoRoot, 'src');
const sourceMapRoot = 'https://example.test/sourcemaps/commit';
const sourceMapBaseUrl = `${sourceMapRoot}/core`;
const preloads = [
	{
		file: 'vs/base/parts/sandbox/electron-browser/preload.ts',
		markers: ['startsWith(', 'postMessage(', 'exposeInMainWorld('],
	},
	{
		file: 'vs/base/parts/sandbox/electron-browser/preload-aux.ts',
		markers: ['startsWith(', 'setZoomLevel(', 'exposeInMainWorld('],
	},
	{
		file: 'vs/platform/browserView/electron-browser/preload-browserView.ts',
		markers: ['isTrusted', 'exposeInMainWorld(', 'getBoundingClientRect(', '_onPicked('],
	},
];
const darkReaderPreload = 'vs/platform/browserView/electron-browser/preload-darkReader.js';
const javascriptFiles = preloads.map(({ file }) => file.replace(/\.ts$/, '.js')).sort();

suite('standalone preloads', () => {
	test('development builds emit the complete Dark Reader sandbox payload', async t => {
		const outDir = path.join(await temporaryDirectory(t), 'out');
		const outPath = path.join(outDir, darkReaderPreload);
		await transpileFile(path.join(srcDir, darkReaderPreload.replace(/\.js$/, '.ts')), outPath);
		const output = await fs.promises.readFile(outPath, 'utf8');
		new vm.Script(output);
		assert.ok(output.includes('shortestPathDarkReaderBridge'));
		assert.ok(output.includes('Dark Reader Ltd.'));
		assert.ok(!output.includes('require("darkreader")'));
		assert.ok(!output.includes('DARK_READER_SCRIPT'));
	});
	for (const mode of ['localized', 'incremental'] as const) {
		test(`${mode} builds keep the Dark Reader payload self-contained`, async t => {
			const outDir = path.join(await temporaryDirectory(t), 'out');
			if (mode === 'localized') {
				await transpileLocalizedFiles(srcDir, outDir, [darkReaderPreload.replace(/\.js$/, '.ts')]);
			} else {
				await applyIncrementalClientChanges(repoRoot, path.relative(repoRoot, outDir), ['src/vs/platform/browserView/electron-browser/darkReaderScript.ts']);
			}
			const output = await fs.promises.readFile(path.join(outDir, darkReaderPreload), 'utf8');
			new vm.Script(output);
			assert.match(output, /shortestPathDarkReaderBridge/);
			assert.doesNotMatch(output, /DARK_READER_SCRIPT|require\("darkreader"\)/);
		});
	}
	for (const minify of [false, true]) {
		for (const { mode, baseUrl } of [
			{ mode: 'local', baseUrl: undefined },
			{ mode: 'empty CDN base', baseUrl: '' },
			{ mode: 'CDN', baseUrl: sourceMapBaseUrl },
			{ mode: 'CDN with trailing slash', baseUrl: `${sourceMapBaseUrl}/` },
		]) {
			test(`links original sources for all preloads (minify: ${minify}, ${mode})`, async t => {
				const outDir = path.join(await temporaryDirectory(t), 'out');
				await compileStandaloneFiles(srcDir, outDir, 'desktop', minify, baseUrl);

				assert.deepStrictEqual(await outputFiles(outDir), [...javascriptFiles, darkReaderPreload].flatMap(file => [file, `${file}.map`]).sort());
				const results = await Promise.all(preloads.map(async ({ file, markers }) => {
					const entryPath = path.join(srcDir, file);
					const outPath = path.join(outDir, file.replace(/\.ts$/, '.js'));
					const [source, output, mapText, baseline] = await Promise.all([
						fs.promises.readFile(entryPath, 'utf8'),
						fs.promises.readFile(outPath, 'utf8'),
						fs.promises.readFile(`${outPath}.map`, 'utf8'),
						compileBaseline(entryPath, outPath, minify),
					]);
					const map: RawSourceMap = JSON.parse(mapText);
					const consumer = new SourceMapConsumer(map);
					const sourcePath = path.relative(path.dirname(outPath), entryPath).replaceAll('\\', '/');
					const expectedURL = baseUrl
						? `${sourceMapBaseUrl}/${file.replace(/\.ts$/, '.js.map')}`
						: `${path.basename(outPath)}.map`;
					const expectedComment = `//# sourceMappingURL=${expectedURL}`;
					new vm.Script(output, { filename: outPath });

					return {
						actual: {
							file,
							comments: output.match(/^\/\/# sourceMappingURL=.+$/gm),
							sources: map.sources,
							embedsOriginalSource: map.sourcesContent?.length === 1 && map.sourcesContent[0] === source,
							unchangedJavaScript: output === baseline.code.replace(/^\/\/# sourceMappingURL=.+$/m, expectedComment),
							unchangedMappings: map.mappings === baseline.map.mappings,
							header: consumer.originalPositionFor({ line: 1, column: 0 }),
							positions: markers.map(marker => {
								const { source, line, column } = consumer.originalPositionFor(positionOf(output, marker));
								return { marker, source, line, column };
							}),
						},
						expected: {
							file,
							comments: [expectedComment],
							sources: [sourcePath],
							embedsOriginalSource: true,
							unchangedJavaScript: true,
							unchangedMappings: true,
							header: { source: null, line: null, column: null, name: null },
							positions: markers.map(marker => ({ marker, source: sourcePath, ...positionOf(source, marker) })),
						},
					};
				}));

				assert.deepStrictEqual(results.map(result => result.actual), results.map(result => result.expected));
			});
		}
	}

	for (const target of ['server', 'server-web', 'web'] as const) {
		test(`does not read or emit desktop preloads for ${target}`, async t => {
			const root = await temporaryDirectory(t);
			const outDir = path.join(root, 'out');
			await compileStandaloneFiles(path.join(root, 'missing-src'), outDir, target, true, sourceMapBaseUrl);
			assert.strictEqual(fs.existsSync(outDir), false);
		});
	}

	test('development transpilation keeps inline maps without embedded sources', async t => {
		const outDir = path.join(await temporaryDirectory(t), 'out');
		const maps = await Promise.all(preloads.map(async ({ file }) => {
			const entryPath = path.join(srcDir, file);
			const outPath = path.join(outDir, file.replace(/\.ts$/, '.js'));
			await transpileFile(entryPath, outPath);
			const output = await fs.promises.readFile(outPath, 'utf8');
			const encodedMap = output.match(/^\/\/# sourceMappingURL=data:application\/json;base64,(?<map>.+)$/m)?.groups?.map;
			assert.ok(encodedMap);
			const map: RawSourceMap = JSON.parse(Buffer.from(encodedMap, 'base64').toString('utf8'));
			return { sources: map.sources.map(source => path.normalize(source)), sourcesContent: map.sourcesContent };
		}));
		assert.deepStrictEqual({
			files: await outputFiles(outDir),
			maps,
		}, {
			files: javascriptFiles,
			maps: preloads.map(({ file }) => ({ sources: [path.join(srcDir, file)], sourcesContent: undefined })),
		});
	});

	test('CI upload layout and map stripping retain final JavaScript and checksum bytes', async t => {
		const root = await temporaryDirectory(t);
		const outDir = path.join(root, 'out');
		const packagedOut = path.join(root, 'package', 'out');
		await compileStandaloneFiles(srcDir, outDir, 'desktop', true, sourceMapBaseUrl);
		const finalContents = await Promise.all([...javascriptFiles, darkReaderPreload].map(file => fs.promises.readFile(path.join(outDir, file))));
		const uploadedPaths: string[] = [];

		// Match upload-sourcemaps.ts: select maps relative to the output root and insert core/.
		await pipeline(
			vfs.src('**/*.map', { cwd: outDir, base: outDir }),
			new Writable({
				objectMode: true,
				write(file: Vinyl, _encoding, callback) {
					file.path = path.join(file.base, 'core', file.relative);
					uploadedPaths.push(file.relative.replaceAll('\\', '/'));
					callback();
				},
			}),
		);

		// Match packageTask's CI filter, without assembling an Electron distribution.
		await pipeline(
			gulp.src('**', { cwd: outDir, base: outDir }),
			filter(['**', '!**/*.{js,css}.map'], { dot: true }),
			gulp.dest(packagedOut),
		);

		const packagedContents = await Promise.all([...javascriptFiles, darkReaderPreload].map(file => fs.promises.readFile(path.join(packagedOut, file))));
		assert.deepStrictEqual({
			uploadedPaths: uploadedPaths.sort(),
			packagedFiles: await outputFiles(packagedOut),
			comments: packagedContents.map(contents => contents.toString().trimEnd().split('\n').at(-1)),
			checksums: packagedContents.map(checksum),
			unchangedBytes: packagedContents.map((contents, index) => contents.equals(finalContents[index])),
		}, {
			uploadedPaths: [...javascriptFiles, darkReaderPreload].map(file => `core/${file}.map`),
			packagedFiles: [...javascriptFiles, darkReaderPreload],
			comments: [...javascriptFiles, darkReaderPreload].map(file => `//# sourceMappingURL=${sourceMapRoot}/core/${file}.map`),
			checksums: finalContents.map(checksum),
			unchangedBytes: [...javascriptFiles, darkReaderPreload].map(() => true),
		});

		const preloadIndex = javascriptFiles.indexOf('vs/base/parts/sandbox/electron-browser/preload.js');
		const beforeURLRewrite = finalContents[preloadIndex].toString().replace(
			/^\/\/# sourceMappingURL=.+$/m,
			'//# sourceMappingURL=preload.js.map',
		);
		assert.notStrictEqual(checksum(finalContents[preloadIndex]), checksum(Buffer.from(beforeURLRewrite)));
	});

	test('fails rather than skipping missing standalone sources', async t => {
		const root = await temporaryDirectory(t);
		await assert.rejects(
			compileStandaloneFiles(path.join(root, 'missing-src'), path.join(root, 'out'), 'desktop', true),
			/Build failed/,
		);
	});
});

async function temporaryDirectory(t: TestContext): Promise<string> {
	const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vscode-standalone-test-'));
	t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
	return root;
}

async function outputFiles(outDir: string): Promise<string[]> {
	const entries = await fs.promises.readdir(outDir, { recursive: true, withFileTypes: true });
	return entries.filter(entry => entry.isFile())
		.map(entry => path.relative(outDir, path.join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
		.sort();
}

function positionOf(source: string, token: string): { line: number; column: number } {
	const offset = source.indexOf(token);
	assert.ok(offset >= 0, `Missing token: ${token}`);
	const prefix = source.slice(0, offset);
	return { line: prefix.split('\n').length, column: offset - prefix.lastIndexOf('\n') - 1 };
}

function checksum(contents: Buffer): string {
	return crypto.createHash('sha256').update(contents).digest('base64').replace(/=+$/, '');
}

async function compileBaseline(entryPath: string, outPath: string, minify: boolean) {
	// Original standalone options: only map publication is allowed to change JavaScript bytes.
	const result = await esbuild.build({
		entryPoints: [entryPath],
		outfile: outPath,
		bundle: false,
		format: 'cjs',
		platform: 'node',
		target: ['es2024'],
		sourcemap: 'linked',
		sourcesContent: false,
		minify,
		banner: {
			js: `/*!--------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/`,
		},
		write: false,
		logLevel: 'warning',
	});
	const javascript = result.outputFiles.find(file => file.path === outPath);
	const sourceMap = result.outputFiles.find(file => file.path === `${outPath}.map`);
	assert.ok(javascript && sourceMap);
	const map: RawSourceMap = JSON.parse(sourceMap.text);
	return { code: javascript.text, map };
}

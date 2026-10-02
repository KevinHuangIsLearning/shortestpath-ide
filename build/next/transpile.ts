/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { createNLSCollector, finalizeNLS, nlsPlugin, postProcessNLS } from './nls-plugin.ts';
import { adjustSourceMap } from './private-to-property.ts';

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** Keeps build I/O comfortably below the Windows CRT's 8192 file-handle limit. */
export const MAX_CONCURRENT_FILE_OPERATIONS = 256;

const transformOptions: esbuild.TransformOptions = {
	loader: 'ts',
	format: 'esm',
	target: 'es2024',
	sourcemap: 'inline',
	sourcesContent: false,
	tsconfigRaw: JSON.stringify({
		compilerOptions: {
			experimentalDecorators: true,
			useDefineForClassFields: false
		}
	}),
};

export async function transpileFile(srcPath: string, destPath: string): Promise<void> {
	const source = await fs.promises.readFile(srcPath, 'utf-8');
	const result = await esbuild.transform(source, {
		...transformOptions,
		sourcefile: srcPath,
	});

	await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
	await fs.promises.writeFile(destPath, adjustEsmUrl(result.code));
}

/** Generate matching indexed calls and metadata for localized desktop development. */
export async function transpileLocalizedFiles(srcDir: string, outDir: string, files: readonly string[]): Promise<void> {
	srcDir = await fs.promises.realpath(srcDir);
	const collector = createNLSCollector();
	const result = await esbuild.build({
		entryPoints: files.map(file => path.join(srcDir, file)),
		outbase: srcDir,
		outdir: outDir,
		bundle: false,
		format: 'esm',
		target: transformOptions.target,
		tsconfigRaw: transformOptions.tsconfigRaw,
		sourcemap: 'linked',
		sourcesContent: false,
		write: false,
		plugins: [nlsPlugin({ baseDir: srcDir, collector })],
		logLevel: 'warning',
	});
	const { indexMap } = await finalizeNLS(collector, outDir);
	const outputs = new Map(result.outputFiles.map(file => [file.path, file]));
	const transformed = new Map<string, ReturnType<typeof postProcessNLS>>();
	for (const file of result.outputFiles) {
		if (file.path.endsWith('.js')) {
			transformed.set(file.path, postProcessNLS(file.text, indexMap, true));
		}
	}
	await mapWithConcurrency(result.outputFiles, MAX_CONCURRENT_FILE_OPERATIONS, async file => {
		let content = file.text;
		if (file.path.endsWith('.js')) {
			content = adjustEsmUrl(transformed.get(file.path)!.code);
		} else if (file.path.endsWith('.js.map')) {
			const jsPath = file.path.slice(0, -'.map'.length);
			const processed = transformed.get(jsPath)!;
			if (processed.edits.length > 0) {
				const original = outputs.get(jsPath)!;
				content = JSON.stringify(adjustSourceMap(JSON.parse(content), original.text, processed.edits));
			}
		}
		await fs.promises.mkdir(path.dirname(file.path), { recursive: true });
		await fs.promises.writeFile(file.path, content);
	});
}

export async function copyFile(srcPath: string, destPath: string): Promise<void> {
	await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

	if (needsBomAdded(srcPath)) {
		const content = await fs.promises.readFile(srcPath);
		if (content[0] !== 0xef || content[1] !== 0xbb || content[2] !== 0xbf) {
			await fs.promises.writeFile(destPath, Buffer.concat([UTF8_BOM, content]));
			return;
		}
	}
	await fs.promises.copyFile(srcPath, destPath);
}

export async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
	if (!Number.isInteger(concurrency) || concurrency < 1) {
		throw new RangeError('Concurrency must be a positive integer.');
	}

	const results = new Array<R>(items.length);
	let nextIndex = 0;
	let firstError: { value: unknown } | undefined;

	async function worker(): Promise<void> {
		while (!firstError && nextIndex < items.length) {
			const index = nextIndex++;
			try {
				results[index] = await task(items[index], index);
			} catch (error) {
				firstError ??= { value: error };
			}
		}
	}

	const workerCount = Math.min(concurrency, items.length);
	await Promise.all(Array.from({ length: workerCount }, worker));

	if (firstError) {
		throw firstError.value;
	}

	return results;
}

export async function applyIncrementalClientChanges(repoRoot: string, outDir: string, changedPaths: readonly string[]): Promise<void> {
	const destinations = new Set<string>();
	for (const changedPath of changedPaths) {
		if (!changedPath.startsWith('src/')) {
			continue;
		}
		destinations.add(getOutputRelativePath(changedPath.slice('src/'.length)));
	}

	const operations = await mapWithConcurrency([...destinations], MAX_CONCURRENT_FILE_OPERATIONS, async destination => {
		const destinationPath = path.join(repoRoot, outDir, destination);
		const resourceSource = path.join(repoRoot, 'src', destination);

		if (!resourceSource.endsWith('.ts') && await isFile(resourceSource)) {
			return { destinationPath, sourcePath: resourceSource, kind: 'copy' as const };
		}

		if (destination.endsWith('.js')) {
			const typeScriptSource = path.join(repoRoot, 'src', destination.slice(0, -'.js'.length) + '.ts');
			if (await isFile(typeScriptSource) && !typeScriptSource.endsWith('.d.ts')) {
				return { destinationPath, sourcePath: typeScriptSource, kind: 'transpile' as const };
			}
		}

		if (await isFile(resourceSource)) {
			return { destinationPath, sourcePath: resourceSource, kind: 'copy' as const };
		}

		return { destinationPath, kind: 'remove' as const };
	});

	for (const operation of operations) {
		if (operation.kind === 'remove') {
			await fs.promises.rm(operation.destinationPath, { recursive: true, force: true });
		}
	}
	for (const operation of operations) {
		if (operation.kind !== 'remove' && await isDirectory(operation.destinationPath)) {
			await fs.promises.rm(operation.destinationPath, { recursive: true, force: true });
		}
	}

	await mapWithConcurrency(operations, MAX_CONCURRENT_FILE_OPERATIONS, async operation => {
		if (operation.kind === 'copy') {
			await copyFile(operation.sourcePath, operation.destinationPath);
		} else if (operation.kind === 'transpile') {
			await transpileFile(operation.sourcePath, operation.destinationPath);
		}
	});
}

export function getOutputRelativePath(sourceRelativePath: string): string {
	return sourceRelativePath.endsWith('.ts') && !sourceRelativePath.endsWith('.d.ts')
		? sourceRelativePath.slice(0, -'.ts'.length) + '.js'
		: sourceRelativePath;
}

function adjustEsmUrl(code: string): string {
	return code.replace(/\.ts(\?esm['"])/g, '.js$1');
}

function needsBomAdded(filePath: string): boolean {
	return /([\/\\])test\1.*utf8/.test(filePath);
}

async function isFile(filePath: string): Promise<boolean> {
	try {
		return (await fs.promises.stat(filePath)).isFile();
	} catch (error) {
		if (isPathMissing(error)) {
			return false;
		}
		throw error;
	}
}

async function isDirectory(filePath: string): Promise<boolean> {
	try {
		return (await fs.promises.stat(filePath)).isDirectory();
	} catch (error) {
		if (isPathMissing(error)) {
			return false;
		}
		throw error;
	}
}

function isPathMissing(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

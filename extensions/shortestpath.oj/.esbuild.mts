/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = import.meta.dirname;
await fs.rm(path.join(root, 'dist'), { recursive: true, force: true });
const result = await esbuild.build({
	absWorkingDir: root,
	entryPoints: ['src/extension.ts'],
	outfile: 'dist/extension.js',
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'node22',
	external: ['vscode'],
	minify: true,
	legalComments: 'linked',
	metafile: true,
});

// Preserve the notices of every package included in the bundle, including
// transitively bundled grammar, WASM, Markdown and mathematical dependencies.
const packages = new Set<string>();
for (const input of Object.keys(result.metafile.inputs)) {
	if (!input.includes('node_modules/')) { continue; }
	let directory = path.dirname(path.resolve(root, input));
	while (true) {
		try {
			const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')) as { name?: string };
			if (manifest.name) { break; }
		} catch {
			// Some dist folders contain a package.json with only an ESM type.
			// Continue to the owning package for its license metadata.
		}
		const parent = path.dirname(directory);
		if (parent === directory) { throw new Error(`Missing package metadata for ${input}`); }
		directory = parent;
	}
	packages.add(directory);
}
const notices: string[] = [];
for (const directory of [...packages].sort()) {
	const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')) as { name: string; version: string; license?: string };
	const files = (await fs.readdir(directory)).filter(file => /^(license|licence|copying|notice)([.-]|$)/i.test(file));
	if (!files.length) { throw new Error(`Missing license text for ${manifest.name}`); }
	notices.push(`${manifest.name} ${manifest.version}\nLicense: ${manifest.license ?? 'See package license'}`);
	for (const file of files) { notices.push(await fs.readFile(path.join(directory, file), 'utf8')); }
}
await fs.writeFile(path.join(root, 'dist/THIRD_PARTY_NOTICES.txt'), notices.join('\n\n'));
await fs.writeFile(path.join(root, 'dist/metafile.json'), JSON.stringify(result.metafile));

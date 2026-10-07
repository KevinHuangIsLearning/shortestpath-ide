/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as esbuild from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await esbuild.build({ entryPoints: ['src/extension.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], outfile: 'dist/extension.js', minify: true, legalComments: 'linked' });
// Excalidraw 0.18.1 appends a CDN font source even when a local asset base is set.
// Remove that fallback from our offline bundle; fail the build if an upgrade
// changes this code so the font loading behavior must be reviewed again.
let offlineFontReplacements = 0;
const offlineFonts = {
	name: 'offline-excalidraw-fonts',
	setup(build) {
		build.onLoad({ filter: /@excalidraw[\\/]excalidraw[\\/]dist[\\/]prod[\\/].*\.js$/ }, async ({ path: file }) => {
			const source = await readFile(file, 'utf8');
			const contents = source.replace(/return ([\w$]+)\.push\(new URL\(([\w$]+),[\w$]+\.ASSETS_FALLBACK_URL\)\),\1/g, (_match, urls) => {
				offlineFontReplacements++;
				return `return ${urls}`;
			});
			return { contents, loader: 'js' };
		});
	},
};
const result = await esbuild.build({
	entryPoints: { webview: 'src/webview/index.ts' }, bundle: true, platform: 'browser', format: 'esm', splitting: true,
	tsconfig: 'tsconfig.webview.json',
	outdir: 'dist', chunkNames: 'chunks/[name]-[hash]', assetNames: 'assets/[name]-[hash]', minify: true,
	conditions: ['production'], define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'linked', metafile: true,
	loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.png': 'file', '.svg': 'file' },
	plugins: [offlineFonts],
});
if (offlineFontReplacements !== 1) { throw new Error('Review the updated Excalidraw offline font loading before building.'); }
await cp('node_modules/@excalidraw/excalidraw/dist/prod/fonts', 'dist/fonts', { recursive: true });

// Preserve the licenses of the packages that actually enter the Webview bundle.
const names = new Set(Object.keys(result.metafile.inputs).flatMap(input => {
	const match = /node_modules\/(?<name>@[^/]+\/[^/]+|[^/]+)/.exec(input);
	return match ? [match.groups.name] : [];
}));
const notices = [];
for (const name of [...names].sort()) {
	const folder = path.join('node_modules', name);
	const manifest = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'));
	const files = (await readdir(folder)).filter(file => /^(license|licence|copying|notice)(\.|$)/i.test(file));
	notices.push(`${name} ${manifest.version}\nLicense: ${manifest.license ?? 'See package license'}\n${manifest.homepage ?? ''}\n`);
	for (const file of files) { notices.push(await readFile(path.join(folder, file), 'utf8')); }
}
notices.push(await readFile('THIRD_PARTY_NOTICES.txt', 'utf8'));
await writeFile('dist/THIRD_PARTY_NOTICES.txt', notices.join('\n\n'));
await writeFile('dist/metafile.json', JSON.stringify(result.metafile));

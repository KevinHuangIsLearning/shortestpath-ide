/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import path from 'path';
import esbuild, { type Plugin } from 'esbuild';
import { run } from '../esbuild-webview-common.mts';

const rootDir = import.meta.dirname;
const previewSrcDir = path.join(rootDir, 'preview-src');
const chatSrcDir = path.join(previewSrcDir, 'chat');

const cssTextPlugin: Plugin = {
	name: 'css-text',
	setup(build) {
		build.onLoad({ filter: /diagramStyles\.css$/ }, async args => {
			const result = await esbuild.build({
				entryPoints: [args.path],
				bundle: true,
				minify: true,
				write: false,
				loader: {
					'.ttf': 'dataurl',
					'.woff': 'dataurl',
					'.woff2': 'dataurl',
				},
			});
			const css = result.outputFiles[0].text;
			return {
				contents: `export default ${JSON.stringify(css)};`,
				loader: 'js',
			};
		});
	},
};

// Build all renderers together so Mermaid, icon packs, and diagram loaders are
// emitted once. Keep each renderer as an independent entry point.
await run({
	entryPoints: {
		'chat/index': path.join(chatSrcDir, 'index.ts'),
		'chat/index-editor': path.join(chatSrcDir, 'index-editor.ts'),
		'chat/codicon': path.join(rootDir, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'),
		'markdown/index': path.join(previewSrcDir, 'markdown', 'index.ts'),
		'notebook/index': path.join(previewSrcDir, 'notebook', 'index.ts'),
	},
	srcDir: previewSrcDir,
	outdir: path.join(rootDir, 'webview-out'),
	additionalOptions: {
		loader: { '.ttf': 'dataurl' },
		plugins: [cssTextPlugin],
		splitting: true,
		chunkNames: 'shared/[name]-[hash]',
	},
}, process.argv);

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import esbuild from 'esbuild';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// SVG images cannot load external font resources. Embed the exact KaTeX fonts
// used by the live webview rather than substituting or measuring glyphs.
const katexRoot = join(import.meta.dirname, 'resources/katex');
const katexCss = readFileSync(join(katexRoot, 'katex.min.css'), 'utf8').replace(
	/src:[^;}]+/g, source => {
		const font = source.match(/url\(([^)]+\.woff2)\)/);
		return font ? `src:url(data:font/woff2;base64,${readFileSync(join(katexRoot, font[1])).toString('base64')}) format('woff2')` : source;
	},
);
export const readerBuild = await esbuild.build({
	absWorkingDir: import.meta.dirname,
	entryPoints: ['src/protectedReaderView.ts'], outfile: 'out/protectedReader.bundle.js',
	bundle: true, platform: 'browser', format: 'iife', target: 'es2022',
	define: { READER_KATEX_CSS: JSON.stringify(katexCss) },
	minify: true, legalComments: 'linked', metafile: true,
});

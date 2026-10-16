/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import esbuild from 'esbuild';
export const readerBuild = await esbuild.build({
	absWorkingDir: import.meta.dirname,
	entryPoints: ['src/protectedReaderView.ts'], outfile: 'out/protectedReader.bundle.js',
	bundle: true, platform: 'browser', format: 'iife', target: 'es2022',
	minify: true, legalComments: 'linked', metafile: true,
});

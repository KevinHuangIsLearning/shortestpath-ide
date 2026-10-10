/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs/promises';
import * as path from 'path';

// Regenerate only from an unpacked official v4.9.133 source archive.
const source = process.argv[2];
if (!source) {
	throw new Error('Pass the unpacked Dark Reader v4.9.133 source directory');
}
const sourceRoot = path.resolve(source);
const manifest = JSON.parse(await fs.readFile(path.join(sourceRoot, 'package.json'), 'utf8'));
if (manifest.version !== '4.9.133') {
	throw new Error('Expected Dark Reader 4.9.133');
}
const output = path.resolve(import.meta.dirname, '../../resources/vendor/darkreader');
const license = await fs.readFile(path.join(sourceRoot, 'LICENSE'), 'utf8');
await fs.mkdir(output, { recursive: true });
for (const file of ['inject/detector.ts', 'utils/color.ts', 'utils/math-eval.ts', 'utils/media-query.ts', 'utils/platform.ts', 'utils/text.ts', 'definitions.d.ts']) {
	const destination = path.join(output, 'src', file);
	await fs.mkdir(path.dirname(destination), { recursive: true });
	await fs.copyFile(path.join(sourceRoot, 'src', file), destination);
}
await fs.writeFile(path.join(output, 'LICENSE'), license);

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Count regular-file bytes without following framework symlinks or counting their targets twice. */
export function getPackageSize(directory: string): number {
	let bytes = 0;
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const file = path.join(directory, entry.name);
		if (entry.isDirectory()) { bytes += getPackageSize(file); }
		else if (entry.isFile()) { bytes += fs.statSync(file).size; }
	}
	return bytes;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [directory, maximum] = process.argv.slice(2);
	const maximumBytes = Number(maximum);
	if (!directory || !Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
		throw new Error('Usage: node build/lib/checkPackageSize.ts <package-directory> <maximum-bytes>');
	}
	const bytes = getPackageSize(directory);
	console.log(`Package size: ${bytes} bytes (${(bytes / 1_000_000).toFixed(2)} MB); limit: ${maximumBytes} bytes`);
	if (bytes >= maximumBytes) { throw new Error(`Package must be smaller than ${maximumBytes} bytes`); }
}

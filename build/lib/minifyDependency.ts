/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { transformSync } from 'esbuild';

// Limit this to inspected runtime JavaScript distributions. Source distributions
// such as KaTeX's Flow files must not be parsed as plain JavaScript.
const packages = new Set([
	'playwright-core', 'undici', 'zod', 'axios', 'ssh2', 'tar', 'chrome-remote-interface',
	'opentype.js', '@vscode/sandbox-runtime',
	'@microsoft/1ds-core-js', '@microsoft/1ds-post-js',
	'@microsoft/applicationinsights-core-js', '@microsoft/dynamicproto-js',
	'@microsoft/dev-tunnels-ssh', '@microsoft/dev-tunnels-connections',
	'@microsoft/dev-tunnels-contracts', '@microsoft/dev-tunnels-management',
]);

/** Minimize whitespace in selected shipped dependencies without renaming or bundling. */
export function minifyDependency(relativePath: string, contents: Buffer): Buffer {
	const parts = relativePath.replaceAll('\\', '/').split('/');
	if (parts.shift() !== 'node_modules' || !/\.[cm]?js$/.test(relativePath)) {
		return contents;
	}
	const packageName = parts[0]?.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
	if (!packages.has(packageName)) {
		return contents;
	}
	const result = transformSync(contents.toString('utf8'), {
		sourcefile: relativePath,
		target: 'esnext',
		minifyWhitespace: true,
		minifyIdentifiers: false,
		minifySyntax: false,
		legalComments: 'inline',
	});
	const output = Buffer.from(result.code);
	return output.length < contents.length ? output : contents;
}

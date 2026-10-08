/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import VinylFile from 'vinyl';
import { cleanNodeModules } from '../util.ts';

test('dependency cleanup retains telemetry entrypoints and icon runtime assets while dropping build inputs', async () => {
	const root = path.resolve(import.meta.dirname, '../../..');
	const runtime = [
		'@vscode/codicons/dist/codicon.ttf', '@vscode/codicons/dist/codicon.css', '@vscode/codicons/dist/metadata.json', '@vscode/codicons/LICENSE',
		'@microsoft/1ds-core-js/dist/ms.core.js', '@microsoft/1ds-core-js/dist-esm/src/Index.js', '@microsoft/1ds-core-js/LICENSE',
		'@microsoft/1ds-core-js/bundle/ms.core.min.js',
		'@microsoft/1ds-post-js/dist/ms.post.js', '@microsoft/1ds-post-js/dist-esm/src/Index.js', '@microsoft/1ds-post-js/LICENSE',
		'@microsoft/1ds-post-js/bundle/ms.post.min.js',
		'@microsoft/applicationinsights-core-js/dist/applicationinsights-core-js.js',
		'@microsoft/applicationinsights-core-js/dist-esm/applicationinsights-core-js.js', '@microsoft/applicationinsights-core-js/LICENSE',
	];
	const development = [
		'@vscode/codicons/src/icons/example.svg', '@vscode/codicons/scripts/fonts.js', '@vscode/codicons/_iconCloud/keywords.csv',
		'@vscode/codicons/dist/codicon.html', '@vscode/codicons/preview.png',
		'@microsoft/1ds-core-js/bundle/ms.core.js', '@microsoft/1ds-post-js/bundle/ms.post.js',
		'@microsoft/applicationinsights-core-js/browser/applicationinsights-core-js.js',
		'@microsoft/applicationinsights-core-js/dist/applicationinsights-core-js.api.json',
	];
	const stream = cleanNodeModules(path.join(root, 'build/.moduleignore'));
	const selected: string[] = [];
	const completed = new Promise<void>((resolve, reject) => {
		stream.on('data', (file: VinylFile) => selected.push(file.relative.replaceAll('\\', '/').replace(/^node_modules\//, '')));
		stream.on('end', resolve);
		stream.on('error', reject);
	});
	for (const file of [...runtime, ...development]) {
		stream.write(new VinylFile({ base: root, path: path.join(root, 'node_modules', file), contents: Buffer.from('fixture') }));
	}
	stream.end();
	await completed;
	assert.deepStrictEqual(selected.sort(), runtime.sort());
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as vm from 'node:vm';
import * as ts from 'typescript';
import { desktopNlsPlugin } from '../../vite/desktop-nls.ts';

function createFixture() {
	const root = mkdtempSync(join(tmpdir(), 'spide-vite-nls-'));
	const pack = join(root, 'extensions', 'test.language-pack-zh-hans');
	mkdirSync(join(root, 'out'), { recursive: true });
	mkdirSync(pack, { recursive: true });
	writeFileSync(join(pack, 'package.json'), JSON.stringify({ contributes: { localizations: [{ languageId: 'zh-cn', translations: [{ id: 'vscode', path: 'main.json' }] }] } }));
	const writeTranslations = (label: string) => writeFileSync(join(pack, 'main.json'), JSON.stringify({ contents: { module: { browse: label } } }));
	const writeMetadata = (keys: Array<string | { key: string }>, messages: string[]) => {
		writeFileSync(join(root, 'out/nls.keys.json'), JSON.stringify([['module', keys]]));
		writeFileSync(join(root, 'out/nls.messages.json'), JSON.stringify(messages));
	};
	writeMetadata(['background', { key: 'browse' }], ['Selection background', 'Browse']);
	writeTranslations('浏览');
	const plugin = desktopNlsPlugin(root);
	let invalidations = 0;
	let middleware!: (request: { url: string }, response: { statusCode: number; setHeader: (key: string, value: string) => void; end: (value: string) => void }, next: () => void) => void;
	assert.equal(typeof plugin.configureServer, 'function');
	if (typeof plugin.configureServer === 'function') {
		plugin.configureServer.call({} as never, { moduleGraph: { invalidateAll() { invalidations++; } }, middlewares: { use(handler: typeof middleware) { middleware = handler; } } } as never);
	}
	return {
		writeMetadata, writeTranslations, invalidations: () => invalidations,
		async transform(source = "localize('browse', 'Browse')") {
			assert.equal(typeof plugin.transform, 'function');
			if (typeof plugin.transform === 'function') {
				const result = await plugin.transform.call({} as never, "import { localize } from './nls.js';\n" + source, join(root, 'src/module.ts'));
				return result && typeof result === 'object' && typeof result.code === 'string' ? result.code.split('\n').at(-1) : result;
			}
		},
		request(url = '/@shortestpath/nls?language=zh-cn') {
			let body = '', forwarded = false;
			const headers = new Map<string, string>();
			const response = { statusCode: 200, setHeader(key: string, value: string) { headers.set(key, value); }, end(value: string) { body = value; } };
			middleware({ url }, response, () => { forwarded = true; });
			return { status: response.statusCode, body, headers, forwarded };
		},
		dispose() { rmSync(root, { recursive: true, force: true }); }
	};
}

test('window reload refreshes Vite indices and translated messages together after a rebuild', async () => {
	const fixture = createFixture();
	try {
		assert.equal(await fixture.transform(), "localize(1, 'Browse')");
		assert.deepEqual(JSON.parse(fixture.request().body), { language: 'zh-cn', messages: ['Selection background', '浏览'] });
		fixture.writeMetadata(['browse', 'background'], ['Browse', 'Selection background']);
		const response = fixture.request();
		assert.equal(response.status, 200);
		assert.equal(response.headers.get('Cache-Control'), 'no-store');
		assert.deepEqual(JSON.parse(response.body).messages, ['浏览', 'Selection background']);
		assert.equal(await fixture.transform(), "localize(0, 'Browse')");
		assert.equal(fixture.invalidations(), 1);
		fixture.request();
		assert.equal(fixture.invalidations(), 1);
	} finally { fixture.dispose(); }
});

test('uses fresh translations, English defaults, and source fallback for new or changed labels', async () => {
	const fixture = createFixture();
	try {
		fixture.writeTranslations('浏览网页');
		assert.deepEqual(JSON.parse(fixture.request().body).messages, ['Selection background', '浏览网页']);
		assert.deepEqual(JSON.parse(fixture.request('/@shortestpath/nls?language=en').body), { language: 'en', messages: ['Selection background', 'Browse'] });
		assert.equal(await fixture.transform("localize('browse', 'Changed label')"), undefined);
		assert.equal(await fixture.transform("localize('newLabel', 'New label')"), undefined);
		assert.equal(fixture.request('/other-resource').forwarded, true);
	} finally { fixture.dispose(); }
});

test('does not publish incomplete build metadata or replace the last coherent transform map', async () => {
	const fixture = createFixture();
	try {
		fixture.writeMetadata(['browse'], ['Browse', 'Selection background']);
		assert.equal(fixture.request().status, 503);
		assert.equal(fixture.invalidations(), 0);
		assert.equal(await fixture.transform(), "localize(1, 'Browse')");
		fixture.writeMetadata(['browse'], ['Browse']);
		assert.deepEqual(JSON.parse(fixture.request().body).messages, ['浏览']);
		assert.equal(await fixture.transform(), "localize(0, 'Browse')");
	} finally { fixture.dispose(); }
});

test('Vite bootstrap replaces stale Electron messages before loading UI; packaged and file-based windows keep their table', async () => {
	const source = readFileSync(fileURLToPath(new URL('../../../src/vs/code/electron-browser/workbench/workbench.ts', import.meta.url)), 'utf8');
	const sourceFile = ts.createSourceFile('workbench.ts', source, ts.ScriptTarget.Latest, true);
	let setup: ts.FunctionDeclaration | undefined;
	let waitsForNls = false;
	function visit(node: ts.Node): void {
		if (ts.isFunctionDeclaration(node) && node.name?.text === 'setupNLS') { setup = node; }
		if (ts.isAwaitExpression(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(sourceFile) === 'setupNLS') { waitsForNls = true; }
		ts.forEachChild(node, visit);
	}
	visit(sourceFile); assert.ok(setup); assert.equal(waitsForNls, true);
	const compiled = ts.transpileModule(setup.getText(sourceFile), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
	const fixture = createFixture();
	try {
		for (const [development, protocol, expectedFetches] of [[true, 'http:', 1], [false, 'http:', 0], [true, 'vscode-file:', 0]] as const) {
			let fetches = 0, htmlLanguage = '';
			const stale = ['Wrong label', 'Selection background'];
			const globals = {
				_VSCODE_USE_RELATIVE_IMPORTS: true, _VSCODE_NLS_MESSAGES: stale,
				configuration: { nls: { language: 'zh-cn', messages: stale } },
				safeProcess: { env: { VSCODE_DEV: development ? '1' : undefined } }, URL,
				window: { location: { protocol, href: 'http://localhost:5199/workbench.html' }, document: { documentElement: { setAttribute(_key: string, value: string) { htmlLanguage = value; } } } },
				async fetch(url: URL, options: { cache: string }) {
					fetches++; assert.equal(options.cache, 'no-store');
					const response = fixture.request(url.pathname + url.search);
					return { ok: response.status === 200, status: response.status, async json() { return JSON.parse(response.body); } };
				}
			};
			await vm.runInNewContext(compiled + '\nsetupNLS(configuration)', globals);
			assert.equal(fetches, expectedFetches);
			assert.deepEqual(globals._VSCODE_NLS_MESSAGES, expectedFetches ? ['Selection background', '浏览'] : stale);
			assert.equal(htmlLanguage, 'zh-Hans');
		}
	} finally { fixture.dispose(); }
});

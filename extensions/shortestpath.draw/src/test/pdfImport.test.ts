/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as path from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { ClientMessage, DraftSnapshot } from '../protocol';
import { getDrawHtml } from '../webviewHtml';

/** A small two-page PDF with different page sizes and a rotated second page. */
function pdfFixture(): string {
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << >> /Contents 5 0 R >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Rotate 90 /Resources << >> /Contents 5 0 R >>',
		'<< /Length 25 >>\nstream\n1 0 0 rg 10 10 50 50 re f\nendstream',
	];
	let data = '%PDF-1.4\n';
	const offsets = [0];
	for (const [index, object] of objects.entries()) { offsets.push(data.length); data += `${index + 1} 0 obj\n${object}\nendobj\n`; }
	const xref = data.length;
	data += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets.slice(1)) { data += `${String(offset).padStart(10, '0')} 00000 n \n`; }
	return `${data}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
}

test('drops PDF pages without Shift, preserves existing content, autosaves images and rejects invalid PDFs atomically', async t => {
	const dist = path.resolve(__dirname, '../../dist');
	const server = http.createServer((request, response) => {
		response.setHeader('Access-Control-Allow-Origin', '*');
		void (async () => {
			if (request.url === '/') {
				response.setHeader('Content-Type', 'text/html');
				response.end(getDrawHtml({ resourceRoot: `${assets}/dist`, cspSource: assets, language: 'en', theme: 'light', companion: false, title: 'Sketchpad', nonce: 'test' }));
				return;
			}
			const file = path.resolve(dist, '.' + decodeURIComponent(request.url!.replace(/^\/dist/, '')));
			if (!file.startsWith(dist + path.sep)) { response.writeHead(403).end(); return; }
			response.setHeader('Content-Type', file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
			response.end(await fs.readFile(file));
		})().catch(() => response.writeHead(404).end());
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
	const address = server.address();
	assert.ok(address && typeof address !== 'string');
	const origin = `http://127.0.0.1:${address.port}`;
	// Webview resources also use a different origin; PDF.js must create a blob worker under the CSP.
	const assets = `http://localhost:${address.port}`;
	const browser = await chromium.launch({ headless: true });
	t.after(() => browser.close());
	const page = await browser.newPage();
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	const messages: ClientMessage[] = [];
	await page.exposeFunction('capture', (message: ClientMessage) => messages.push(message));
	await page.addInitScript(`window.acquireVsCodeApi = () => ({ setState() {}, postMessage(message) {
		window.capture(message);
		if (message.type === 'ready') window.postMessage({type: 'init', fileId: 'test'});
		if (message.type === 'save') window.postMessage({type: 'saved', revision: message.revision});
	}});`);
	await page.goto(origin);
	await page.locator('.excalidraw canvas').first().waitFor();
	const waitUntil = async (predicate: () => boolean) => new Promise<void>((resolve, reject) => {
		const started = Date.now();
		const check = () => predicate() ? resolve() : Date.now() - started > 15000 ? reject(new Error('Timed out waiting for the canvas')) : setTimeout(check, 50);
		check();
	});
	await waitUntil(() => messages.some(message => message.type === 'canvasReady'));
	const drop = async (data: string, name: string, type: string) => page.evaluate(`(() => {
		const { data, name, type } = ${JSON.stringify({ data, name, type })};
		const transfer = new DataTransfer();
		transfer.items.add(new File([data], name, { type }));
		document.querySelector('.excalidraw').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: 400, clientY: 300 }));
	})()`);
	const lastSnapshot = (): DraftSnapshot | undefined => messages.filter(message => message.type === 'save').at(-1)?.snapshot;
	await drop(pdfFixture(), 'pages.PDF', '');
	await waitUntil(() => JSON.parse(lastSnapshot()?.scene ?? '{}').elements?.length === 2);
	let snapshot = lastSnapshot();
	assert.ok(snapshot);
	const scene = JSON.parse(snapshot.scene);
	assert.deepEqual({ sizes: scene.elements.map((element: { width: number; height: number }) => [element.width, element.height]), files: Object.keys(scene.files).length, errors }, { sizes: [[200, 300], [200, 400]], files: 2, errors: [] });
	assert.ok(scene.elements[1].y > scene.elements[0].y + 300);
	assert.ok(Object.values(scene.files).every(file => (file as { dataURL: string }).dataURL.startsWith('data:image/png;base64,')));
	const readyCount = messages.filter(message => message.type === 'canvasReady').length;
	await page.evaluate(`window.postMessage(${JSON.stringify({ type: 'replace', snapshot, fileId: 'restored' })})`);
	await waitUntil(() => messages.filter(message => message.type === 'canvasReady').length > readyCount);
	await drop(pdfFixture(), 'again.pdf', 'application/pdf');
	await waitUntil(() => JSON.parse(lastSnapshot()?.scene ?? '{}').elements?.length === 4);
	snapshot = lastSnapshot();
	assert.equal(JSON.parse(snapshot!.scene).elements.length, 4);
	await drop('not a PDF', 'broken.pdf', 'application/pdf');
	await page.getByText('Could not import the drawing.', { exact: true }).waitFor();
	assert.equal(lastSnapshot()!.scene, snapshot!.scene);
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProtectedReaderCrypto } from './protectedReaderCrypto';
import html2canvas from 'html2canvas-pro';
import { createHighlighterCore } from 'shiki/core';
import type { ThemeRegistration } from 'shiki';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { createMarkdownRendererWithHighlighter } from './markdownRenderer';

declare const READER_KATEX_CSS: string;

const decoder = new TextDecoder('utf-8', { fatal: true });
const boxes = /spide1:([A-Za-z0-9_-]+)/g;
const bytes = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const reader = new ProtectedReaderCrypto();
const templates = new WeakMap<HTMLElement, { content: string; baseUrl: string }>();
const active = new WeakSet<HTMLElement>();
const rendered = new WeakMap<HTMLElement, string>();
const elements = new Set<HTMLElement>();
const pendingResize = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
let themeRevision = 0;
let activePublicKey = '';
let keyRevision = 0;
let editorTheme: string | ThemeRegistration | undefined;
let editorThemeJSON = '';
function applyEditorTheme(value: unknown): void {
	if (typeof value !== 'string' && (!value || typeof value !== 'object' || !Array.isArray((value as ThemeRegistration).settings))) { return; }
	const json = JSON.stringify(value);
	if (json === editorThemeJSON) { return; }
	editorThemeJSON = json; editorTheme = value as string | ThemeRegistration; themeRevision++;
}

const renderMarkdown = (async () => {
	const highlighter = await createHighlighterCore({
		themes: [import('shiki/themes/github-dark.mjs'), import('shiki/themes/github-light.mjs')],
		langs: [import('shiki/langs/cpp.mjs'), import('shiki/langs/python.mjs'), import('shiki/langs/java.mjs'), import('shiki/langs/javascript.mjs'), import('shiki/langs/typescript.mjs'), import('shiki/langs/bash.mjs'), import('shiki/langs/json.mjs')],
		engine: createJavaScriptRegexEngine(),
	});
	return createMarkdownRendererWithHighlighter(highlighter, () => editorTheme ?? (document.body.classList.contains('vscode-light') || document.body.classList.contains('vscode-high-contrast-light') ? 'github-light' : 'github-dark'));
})();

/** Preserve Chromium's layout instead of reconstructing glyphs and whitespace. */
async function rasterizeNative(stage: HTMLElement, width: number, height: number, nativeMath = false): Promise<HTMLCanvasElement> {
	const clone = stage.cloneNode(true) as HTMLElement;
	const imageLayers: { image: HTMLImageElement; bounds: DOMRect }[] = [];
	// Shiki tokens already contain their colors and font styles. Only four
	// structural styles need resolving; copying every browser property onto
	// every token creates megabytes of redundant SVG and blocks the webview.
	const properties = [
		'display', 'position', 'box-sizing', 'width', 'min-width', 'max-width',
		'min-height', 'max-height', 'margin', 'padding', 'border', 'border-radius',
		'left', 'top', 'overflow', 'background-color', 'color',
		'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
		'font-feature-settings', 'font-variation-settings', 'font-kerning',
		'line-height', 'letter-spacing', 'word-spacing', 'white-space',
		'overflow-wrap', 'word-break', 'tab-size', 'text-align', 'text-indent',
		'text-transform', 'text-rendering', 'direction', 'writing-mode',
	];
	const stylesheet = document.createElement('style');
	stylesheet.textContent = ['pre', 'code', '.line', '.protected-reader-line-number'].map(selector => {
		const source = stage.querySelector<HTMLElement>(selector);
		if (!source) { return ''; }
		const computed = getComputedStyle(source);
		return `${selector}{${properties.map(property => `${property}:${computed.getPropertyValue(property)};`).join('')}}`;
	}).join('');
	if (nativeMath) {
		// Preserve the surrounding Markdown's resolved layout, but leave KaTeX's
		// entire subtree to its original CSS (including pseudo elements and em
		// units). Chromium lays out and paints formulas without glyph simulation.
		stylesheet.textContent = READER_KATEX_CSS;
		const sources = [stage, ...stage.querySelectorAll<HTMLElement>('*')];
		const copies = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
		sources.forEach((source, index) => {
			if (source.closest('.katex')) { return; }
			const computed = getComputedStyle(source);
			copies[index].style.cssText = Array.from(computed, property => `${property}:${computed.getPropertyValue(property)};`).join('');
		});
		// SVG images cannot load external assets. Preserve decoded illustrations
		// as bitmaps; cross-origin images can still be drawn to the final canvas
		// without reading their pixels or weakening the webview's CSP.
		for (const [index, source] of [...stage.querySelectorAll('img')].entries()) {
			const copy = clone.querySelectorAll('img')[index];
			copy.removeAttribute('srcset');
			copy.removeAttribute('src');
			if (!source.naturalWidth || !source.naturalHeight) { continue; }
			const bitmap = document.createElement('canvas');
			bitmap.width = source.naturalWidth; bitmap.height = source.naturalHeight;
			bitmap.getContext('2d')!.drawImage(source, 0, 0);
			try { copy.src = bitmap.toDataURL(); }
			catch {
				copy.style.visibility = 'hidden';
				imageLayers.push({ image: source, bounds: source.getBoundingClientRect() });
			}
		}
	}
	// The staging container is offscreen; only its children carry the document layout.
	if (!nativeMath) { clone.style.cssText = ''; }
	Object.assign(clone.style, { display: 'flow-root', position: 'static', left: 'auto', top: 'auto', width: `${width}px`, height: `${height}px` });
	clone.removeAttribute('inert');
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
	const content = document.createElementNS(svg.namespaceURI, 'foreignObject');
	content.setAttribute('width', '100%'); content.setAttribute('height', '100%');
	content.append(stylesheet, clone); svg.append(content);
	const image = new Image();
	try {
		image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
		await image.decode();
		const scale = Math.min(devicePixelRatio || 1, 2, 16384 / width, 16384 / height, Math.sqrt(12000000 / (width * height)));
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.floor(width * scale));
		canvas.height = Math.max(1, Math.floor(height * scale));
		const context = canvas.getContext('2d');
		if (!context) { throw new Error('Canvas unavailable'); }
		context.drawImage(image, 0, 0, canvas.width, canvas.height);
		const origin = stage.getBoundingClientRect();
		for (const layer of imageLayers) {
			context.drawImage(layer.image, (layer.bounds.left - origin.left) * canvas.width / width,
				(layer.bounds.top - origin.top) * canvas.height / height,
				layer.bounds.width * canvas.width / width, layer.bounds.height * canvas.height / height);
		}
		return canvas;
	} finally {
		image.removeAttribute('src'); clone.replaceChildren(); svg.replaceChildren();
	}
}

async function paint(element: HTMLElement): Promise<void> {
	if (!reader.ready || pendingResize.has(element) || active.has(element) || !element.isConnected || element.getBoundingClientRect().width < 1 || !element.getClientRects().length) { return; }
	const template = templates.get(element);
	if (!template) { return; }
	const width = Math.floor(element.clientWidth);
	const revision = `${width}:${themeRevision}`;
	if (!width || rendered.get(element) === revision) { return; }
	active.add(element);
	const stage = document.createElement('div');
	const sandbox = document.createElement('div');
	sandbox.className = 'protected-reader-sandbox';
	sandbox.setAttribute('aria-hidden', 'true');
	sandbox.inert = true;
	stage.className = 'protected-reader-stage';
	stage.setAttribute('aria-hidden', 'true');
	stage.inert = true;
	stage.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;pointer-events:none;`;
	try {
		// Plaintext exists only for this paint. Never put it in webview state, IPC,
		// attributes, editor documents or a persistent DOM overlay.
		let markdown = template.content;
		const replacements = await Promise.all([...markdown.matchAll(boxes)].map(async match => [match[0], await reader.decrypt(match[1])] as const));
		for (const [sealed, text] of replacements) { markdown = markdown.replaceAll(sealed, text); }
		const renderer = await renderMarkdown;
		stage.innerHTML = renderer(markdown, template.baseUrl);
		markdown = '';
		replacements.length = 0;
		// Preserve the original editorial, hint and sample style context.
		element.append(stage);
		for (const code of stage.querySelectorAll<HTMLElement>('pre > code')) {
			if (!code.querySelector(':scope > .line')) {
				const plainLines = (code.textContent ?? '').split('\n');
				code.replaceChildren(...plainLines.map(text => {
					const line = document.createElement('span');
					line.className = 'line'; line.textContent = text;
					return line;
				}));
			}
			// Shiki separates its inline line spans with newlines. Our block lines
			// already create those breaks; retain whitespace inside each source line.
			for (const node of [...code.childNodes]) {
				if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) { node.remove(); }
			}
			const lines = code.querySelectorAll<HTMLElement>(':scope > .line');
			code.style.setProperty('--reader-line-digits', String(Math.max(3, String(lines.length).length)));
			lines.forEach((line, index) => {
				const number = document.createElement('span');
				number.className = 'protected-reader-line-number';
				number.textContent = String(index + 1);
				line.prepend(number);
			});
		}
		await document.fonts.ready;
		await Promise.all([...stage.querySelectorAll('img')].map(image => image.decode().catch(() => { })));
		if (!element.isConnected) { return; }
		const height = Math.max(1, Math.ceil(stage.scrollHeight));
		const bounds = stage.getBoundingClientRect();
		const links = [...stage.querySelectorAll<HTMLAnchorElement>('a[href]')].flatMap(link => [...link.getClientRects()].map(rect => ({ href: link.href, x: rect.left - bounds.left, y: rect.top - bounds.top, width: rect.width, height: rect.height })));
		const rasterize = (target: HTMLElement, rasterWidth: number, rasterHeight: number) => {
			// Electron webview resource URLs are not reliably reloadable inside
			// html2canvas's iframe. Snapshot resolved styles from the real view,
			// including inherited fonts, rather than relying on a second CSS load.
			const styles = [target, ...target.querySelectorAll<HTMLElement>('*')].map(node => {
				const computed = getComputedStyle(node);
				return Array.from(computed, property => `${property}:${computed.getPropertyValue(property)};`).join('');
			});
			return html2canvas(target, {
				iframeContainer: sandbox, width: rasterWidth, height: rasterHeight,
				scale: Math.min(devicePixelRatio || 1, 2, 16384 / rasterWidth, 16384 / rasterHeight, Math.sqrt(12000000 / (rasterWidth * rasterHeight))),
				backgroundColor: null, allowTaint: true, useCORS: false, logging: false,
				onclone: (_document, clonedTarget) => {
					[clonedTarget, ...clonedTarget.querySelectorAll<HTMLElement>('*')].forEach((node, index) => { node.style.cssText = styles[index]; });
				},
				ignoreElements: node => node !== stage && !stage.contains(node) && !node.contains(stage) && node !== document.head && !document.head.contains(node),
			});
		};
		// Own the clone container so failed rasterization cannot leave plaintext in an iframe.
		document.body.append(sandbox);
		// Rasterize the original Markdown layout as one surface. The existing
		// containers own sizing and scrolling; do not reconstruct code boxes.
		const codeOnly = stage.childElementCount === 1 && stage.firstElementChild?.tagName === 'PRE';
		const nativeMath = !!stage.querySelector('.katex');
		const canvas = codeOnly || nativeMath ? await rasterizeNative(stage, width, height, nativeMath) : await rasterize(stage, width, height);
		if (!element.isConnected) { return; }
		if (`${Math.floor(element.clientWidth)}:${themeRevision}` !== revision) { return; }
		canvas.style.cssText = `display:block;width:${width}px;height:${height}px;`;
		canvas.setAttribute('aria-hidden', 'true');
		element.replaceChildren(canvas);
		for (const link of links) {
			const anchor = document.createElement('a');
			anchor.href = link.href;
			anchor.setAttribute('aria-label', '打开内容链接');
			anchor.style.cssText = `position:absolute;left:${link.x}px;top:${link.y}px;width:${link.width}px;height:${link.height}px;`;
			element.append(anchor);
		}
		rendered.set(element, revision);
	} catch {
		element.replaceChildren();
		rendered.set(element, revision);
		element.textContent = document.documentElement.lang.startsWith('zh') ? '内容显示暂不可用，请重新连接。' : 'Content unavailable. Please reconnect.';
	} finally {
		stage.replaceChildren(); stage.remove();
		sandbox.replaceChildren(); sandbox.remove();
		active.delete(element);
		if (`${Math.floor(element.clientWidth)}:${themeRevision}` !== revision) { void paint(element); }
	}
}

const resize = new ResizeObserver(entries => {
	for (const entry of entries) {
		const element = entry.target as HTMLElement;
		if (!rendered.has(element)) { void paint(element); continue; }
		if (rendered.get(element) === `${Math.floor(element.clientWidth)}:${themeRevision}`) { continue; }
		clearTimeout(pendingResize.get(element));
		pendingResize.set(element, setTimeout(() => {
			pendingResize.delete(element);
			void paint(element);
		}, 100));
	}
});
function scan(): void {
	for (const element of elements) { if (!element.isConnected) { resize.unobserve(element); elements.delete(element); clearTimeout(pendingResize.get(element)); pendingResize.delete(element); } }
	for (const element of document.querySelectorAll<HTMLElement>('[data-reader-template]')) {
		try {
			const value = JSON.parse(decoder.decode(bytes(element.dataset.readerTemplate!))) as { content: string; baseUrl: string };
			if (typeof value.content !== 'string' || typeof value.baseUrl !== 'string') { throw new Error('Invalid template'); }
			templates.set(element, value); elements.add(element); resize.observe(element);
			element.removeAttribute('data-reader-template');
		} catch { element.textContent = ''; element.removeAttribute('data-reader-template'); }
	}
	for (const element of elements) { void paint(element); }
}

window.addEventListener('message', async event => {
	const value = event.data;
	if (value?.type === 'protectedReaderTheme' || value?.type === 'protectedReaderKey') { applyEditorTheme(value.theme); scan(); }
	if (value?.type !== 'protectedReaderKey' || value.publicKey === activePublicKey) { return; }
	const revision = ++keyRevision;
	activePublicKey = '';
	try {
		if (!await reader.initialize(value.privateJwk, value.publicKey) || revision !== keyRevision) { return; }
		activePublicKey = value.publicKey; themeRevision++; scan();
	} catch { if (revision === keyRevision) { reader.clear(); } }
});
for (const name of ['copy', 'cut', 'contextmenu', 'dragstart']) {
	document.addEventListener(name, event => {
		if (event.target instanceof Element && event.target.closest('.protected-reader')) { event.preventDefault(); event.stopPropagation(); }
	}, true);
}
new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
const themeObserver = new MutationObserver(() => { themeRevision++; scan(); });
for (const target of [document.documentElement, document.body]) { themeObserver.observe(target, { attributes: true, attributeFilter: ['class', 'style'] }); }
document.addEventListener('toggle', scan, true);
window.addEventListener('pagehide', () => { reader.clear(); elements.clear(); resize.disconnect(); for (const timer of pendingResize.values()) { clearTimeout(timer); } pendingResize.clear(); });
scan();
window.dispatchEvent(new Event('protected-reader-ready'));

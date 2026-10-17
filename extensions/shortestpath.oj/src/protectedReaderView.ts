/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProtectedReaderCrypto } from './protectedReaderCrypto';
import type { ThemeRegistration } from 'shiki';
import { createProtectedMarkdownRenderer } from './protectedReaderMarkdown';
import { createMarkdownRendererWithHighlighter } from './markdownRenderer';

declare const READER_KATEX_CSS: string;

const decoder = new TextDecoder('utf-8', { fatal: true });
const boxes = /spide1:([A-Za-z0-9_-]+)/g;
const bytes = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const reader = new ProtectedReaderCrypto();
const templates = new WeakMap<HTMLElement, { content: string; baseUrl: string; mode?: 'canvas' | 'dom' }>();
const active = new WeakSet<HTMLElement>();
const rendered = new WeakMap<HTMLElement, string>();
const elements = new Set<HTMLElement>();
const pendingResize = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
const pendingPaint = new Set<HTMLElement>();
let painting = false;
let paintFrame = 0;
let themeRevision = 0;
let activePublicKey = '';
let keyRevision = 0;
let editorTheme: string | ThemeRegistration | undefined;
let editorThemeJSON = '';

function paintRevision(element: HTMLElement): string {
	return element.dataset.readerMode === 'dom' ? `dom:${themeRevision}:${keyRevision}` : `${Math.floor(element.clientWidth)}:${themeRevision}:${keyRevision}:${devicePixelRatio || 1}`;
}

/** Paint nearby surfaces serially, yielding between them so input stays responsive. */
function schedulePaint(element: HTMLElement): void {
	pendingPaint.add(element);
	if (painting || paintFrame) { return; }
	paintFrame = requestAnimationFrame(async () => {
		paintFrame = 0;
		if (!reader.ready) { return; }
		for (const next of pendingPaint) {
			pendingPaint.delete(next);
			const bounds = next.getBoundingClientRect();
			if (!next.isConnected || next.closest('details:not([open]), .tab-panel:not(.active)') || bounds.bottom < -600 || bounds.top > innerHeight + 600 || rendered.get(next) === paintRevision(next)) { continue; }
			painting = true;
			try { await paint(next); }
			finally {
				painting = false;
				const remaining = pendingPaint.values().next().value;
				if (remaining) { schedulePaint(remaining); }
			}
			break;
		}
	});
}

function applyEditorTheme(value: unknown): void {
	if (typeof value !== 'string' && (!value || typeof value !== 'object' || !Array.isArray((value as ThemeRegistration).settings))) { return; }
	const json = JSON.stringify(value);
	if (json === editorThemeJSON) { return; }
	editorThemeJSON = json; editorTheme = value as string | ThemeRegistration; themeRevision++;
}

const renderMarkdown = createProtectedMarkdownRenderer(() => editorTheme ?? (document.body.classList.contains('vscode-light') || document.body.classList.contains('vscode-high-contrast-light') ? 'github-light' : 'github-dark'));
const renderReportMarkdown = createMarkdownRendererWithHighlighter(undefined, () => 'github-dark');
const codeOwners = new WeakMap<HTMLElement, { element: HTMLElement; revision: string }>();
const pendingCode = new Set<HTMLElement>();
const observedCode = new Set<HTMLElement>();
let highlighting = false;

async function highlightNextCode(): Promise<void> {
	if (highlighting) { return; }
	highlighting = true;
	try {
		for (const pre of pendingCode) {
			pendingCode.delete(pre);
			const owner = codeOwners.get(pre);
			if (!owner || !pre.isConnected || !reader.ready || paintRevision(owner.element) !== owner.revision) { continue; }
			// Let the plain, selectable report reach the screen before compiling
			// a grammar. Only visible snippets are highlighted, one per frame.
			await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
			if (!pre.isConnected || !reader.ready || paintRevision(owner.element) !== owner.revision) { continue; }
			const html = await renderMarkdown.highlight(pre.textContent ?? '', pre.dataset.readerLanguage!);
			if (!html || !pre.isConnected || !reader.ready || paintRevision(owner.element) !== owner.revision) { continue; }
			const selection = window.getSelection();
			if (selection && !selection.isCollapsed && Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index)).some(range => range.intersectsNode(pre))) { continue; }
			const template = document.createElement('template');
			template.innerHTML = html;
			const highlighted = template.content.querySelector('pre');
			if (highlighted) { highlighted.style.margin = getComputedStyle(pre).margin; }
			pre.replaceWith(template.content);
		}
	} catch {
		// Keep the readable, copyable plain code if highlighting is unavailable.
	} finally {
		highlighting = false;
		if (pendingCode.size) { void highlightNextCode(); }
	}
}

const codeVisibility = new IntersectionObserver(entries => {
	for (const entry of entries) {
		if (entry.isIntersecting) { codeVisibility.unobserve(entry.target); observedCode.delete(entry.target as HTMLElement); pendingCode.add(entry.target as HTMLElement); }
	}
	void highlightNextCode();
});

/** Preserve Chromium's layout instead of reconstructing glyphs and whitespace. */
async function rasterizeNative(stage: HTMLElement, width: number, height: number, codeOnly: boolean): Promise<HTMLCanvasElement> {
	const clone = stage.cloneNode(true) as HTMLElement;
	const imageLayers: { image: HTMLImageElement; bounds: DOMRect }[] = [];
	// Copy only Markdown layout and typography. Serializing every browser
	// property on every token creates megabytes of redundant SVG.
	const properties = [
		'display', 'position', 'box-sizing', 'width', 'min-width', 'max-width',
		'min-height', 'max-height', 'margin', 'padding', 'border', 'border-radius',
		'left', 'top', 'overflow', 'background-color', 'color',
		'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
		'font-feature-settings', 'font-variation-settings', 'font-kerning',
		'line-height', 'letter-spacing', 'word-spacing', 'white-space',
		'overflow-wrap', 'word-break', 'tab-size', 'text-align', 'text-indent',
		'text-transform', 'text-rendering', 'direction', 'writing-mode',
		'border-top', 'border-right', 'border-bottom', 'border-left',
		'border-collapse', 'border-spacing', 'table-layout', 'vertical-align',
		'list-style-type', 'list-style-position', 'text-decoration', 'opacity',
	];
	const stylesheet = document.createElement('style');
	stylesheet.textContent = ['pre', 'code', '.line', '.protected-reader-line-number'].map(selector => {
		const source = stage.querySelector<HTMLElement>(selector);
		if (!source) { return ''; }
		const computed = getComputedStyle(source);
		return `${selector}{${properties.map(property => `${property}:${computed.getPropertyValue(property)};`).join('')}}`;
	}).join('');
	if (!codeOnly) {
		// Preserve the surrounding Markdown's resolved layout, but leave KaTeX's
		// entire subtree to its original CSS (including pseudo elements and em
		// units). Chromium lays out and paints formulas without glyph simulation.
		stylesheet.textContent = stage.querySelector('.katex') ? READER_KATEX_CSS : '';
		const sources = [stage, ...stage.querySelectorAll<HTMLElement>('*')];
		const copies = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
		sources.forEach((source, index) => {
			if (source.closest('.katex') || (source.matches('span') && source.closest('pre code') && !source.matches('.line, .protected-reader-line-number'))) { return; }
			const computed = getComputedStyle(source);
			copies[index].style.cssText = properties.map(property => `${property}:${computed.getPropertyValue(property)};`).join('');
		});
		// SVG images cannot load external assets. Preserve decoded illustrations
		// as bitmaps; cross-origin images can still be drawn to the final canvas
		// without reading their pixels or weakening the webview's CSP.
		for (const [index, source] of [...stage.querySelectorAll('img')].entries()) {
			const copy = clone.querySelectorAll('img')[index];
			// Keep the decoded image's space even when its cross-origin pixels
			// have to be composited separately after the SVG is painted.
			copy.style.height = getComputedStyle(source).height;
			copy.removeAttribute('srcset');
			copy.removeAttribute('src');
			if (!source.naturalWidth || !source.naturalHeight) { continue; }
			const bitmap = document.createElement('canvas');
			bitmap.width = source.naturalWidth; bitmap.height = source.naturalHeight;
			bitmap.getContext('2d')!.drawImage(source, 0, 0);
			try { copy.src = bitmap.toDataURL(); }
			catch {
				// A missing src turns an inline image into its alt text, which does
				// not reserve the image's height even with explicit dimensions.
				copy.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
				copy.style.visibility = 'hidden';
				imageLayers.push({ image: source, bounds: source.getBoundingClientRect() });
			}
		}
	}
	// The staging container is offscreen; only its children carry the document layout.
	if (codeOnly) { clone.style.cssText = ''; }
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
	const revision = paintRevision(element);
	if (!width || rendered.get(element) === revision) { return; }
	active.add(element);
	const stage = document.createElement('div');
	stage.className = 'protected-reader-stage';
	stage.setAttribute('aria-hidden', 'true');
	stage.inert = true;
	stage.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;pointer-events:none;`;
	try {
		// Decrypted text stays in this reader's bounded memory cache. Only report
		// prose is published as DOM; protected statements/code remain bitmaps.
		let markdown = template.content;
		const replacements = await Promise.all([...markdown.matchAll(boxes)].map(async match => [match[0], await reader.decrypt(match[1])] as const));
		for (const [sealed, text] of replacements) { markdown = markdown.replaceAll(sealed, text); }
		const renderer = template.mode === 'dom' ? renderReportMarkdown : await renderMarkdown(markdown);
		stage.innerHTML = renderer(markdown, template.baseUrl);
		markdown = '';
		replacements.length = 0;
		if (template.mode === 'dom') {
			if (!element.isConnected || !reader.ready || paintRevision(element) !== revision) { return; }
			for (const pre of element.querySelectorAll<HTMLElement>('pre[data-reader-language]')) {
				codeVisibility.unobserve(pre); observedCode.delete(pre); pendingCode.delete(pre);
			}
			element.replaceChildren(...stage.childNodes);
			rendered.set(element, revision);
			for (const pre of element.querySelectorAll<HTMLElement>('pre[data-reader-language]')) {
				codeOwners.set(pre, { element, revision }); observedCode.add(pre); codeVisibility.observe(pre);
			}
			return;
		}
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
		if (!element.isConnected || !reader.ready || paintRevision(element) !== revision) { return; }
		const height = Math.max(1, Math.ceil(stage.scrollHeight));
		const bounds = stage.getBoundingClientRect();
		const links = [...stage.querySelectorAll<HTMLAnchorElement>('a[href]')].flatMap(link => [...link.getClientRects()].map(rect => ({ href: link.href, x: rect.left - bounds.left, y: rect.top - bounds.top, width: rect.width, height: rect.height })));
		// Rasterize the original Markdown layout as one surface. The existing
		// containers own sizing and scrolling; do not reconstruct code boxes.
		const codeOnly = stage.childElementCount === 1 && stage.firstElementChild?.tagName === 'PRE';
		const canvas = await rasterizeNative(stage, width, height, codeOnly);
		if (!element.isConnected) { return; }
		if (!reader.ready || paintRevision(element) !== revision) { return; }
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
		if (!element.isConnected || !reader.ready || paintRevision(element) !== revision) { return; }
		element.replaceChildren();
		rendered.set(element, revision);
		element.textContent = document.documentElement.lang.startsWith('zh') ? '内容显示暂不可用，请重新连接。' : 'Content unavailable. Please reconnect.';
	} finally {
		stage.replaceChildren(); stage.remove();
		active.delete(element);
		if (element.isConnected && reader.ready && paintRevision(element) !== revision) { schedulePaint(element); }
	}
}

const resize = new ResizeObserver(entries => {
	for (const entry of entries) {
		const element = entry.target as HTMLElement;
		if (!rendered.has(element)) { schedulePaint(element); continue; }
		if (rendered.get(element) === paintRevision(element)) { continue; }
		clearTimeout(pendingResize.get(element));
		pendingResize.set(element, setTimeout(() => {
			pendingResize.delete(element);
			schedulePaint(element);
		}, 100));
	}
});
const visibility = new IntersectionObserver(entries => {
	for (const entry of entries) {
		if (entry.isIntersecting) { schedulePaint(entry.target as HTMLElement); }
	}
}, { rootMargin: '600px' });
function scan(): void {
	for (const pre of observedCode) { if (!pre.isConnected) { codeVisibility.unobserve(pre); observedCode.delete(pre); pendingCode.delete(pre); } }
	for (const element of elements) { if (!element.isConnected) { resize.unobserve(element); visibility.unobserve(element); elements.delete(element); pendingPaint.delete(element); clearTimeout(pendingResize.get(element)); pendingResize.delete(element); } }
	for (const element of document.querySelectorAll<HTMLElement>('[data-reader-template]')) {
		try {
			const value = JSON.parse(decoder.decode(bytes(element.dataset.readerTemplate!))) as { content: string; baseUrl: string; mode?: 'canvas' | 'dom' };
			if (typeof value.content !== 'string' || typeof value.baseUrl !== 'string' || (value.mode !== undefined && value.mode !== 'canvas' && value.mode !== 'dom')) { throw new Error('Invalid template'); }
			templates.set(element, value); elements.add(element); resize.observe(element); visibility.observe(element);
			element.removeAttribute('data-reader-template');
		} catch { element.textContent = ''; element.removeAttribute('data-reader-template'); }
	}
	for (const element of elements) { schedulePaint(element); }
}

window.addEventListener('message', async event => {
	const value = event.data;
	if (value?.type === 'protectedReaderTheme' || value?.type === 'protectedReaderKey') { applyEditorTheme(value.theme); scan(); }
	if (value?.type !== 'protectedReaderKey' || value.publicKey === activePublicKey) { return; }
	const revision = ++keyRevision;
	activePublicKey = '';
	for (const element of elements) { element.replaceChildren(); rendered.delete(element); }
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
// Canvas insertion, line numbers and like counters do not introduce readers.
// In particular, never rescan the document for our own temporary plaintext DOM.
const contentObserver = new MutationObserver(records => {
	if (records.some(record => record.type === 'attributes' || [...record.addedNodes, ...record.removedNodes].some(node =>
		node instanceof Element && (node.matches('[data-reader-id]') || node.querySelector('[data-reader-id]'))))) { scan(); }
});
contentObserver.observe(document.body, { childList: true, subtree: true });
for (const panel of document.querySelectorAll('.tab-panel')) { contentObserver.observe(panel, { attributes: true, attributeFilter: ['class'] }); }
const themeObserver = new MutationObserver(() => { themeRevision++; scan(); });
for (const target of [document.documentElement, document.body]) { themeObserver.observe(target, { attributes: true, attributeFilter: ['class', 'style'] }); }
document.addEventListener('toggle', scan, true);
window.addEventListener('pagehide', () => { renderMarkdown.dispose(); reader.clear(); keyRevision++; for (const element of elements) { element.replaceChildren(); } elements.clear(); pendingPaint.clear(); pendingCode.clear(); observedCode.clear(); codeVisibility.disconnect(); cancelAnimationFrame(paintFrame); paintFrame = 0; resize.disconnect(); visibility.disconnect(); contentObserver.disconnect(); themeObserver.disconnect(); for (const timer of pendingResize.values()) { clearTimeout(timer); } pendingResize.clear(); });
scan();
window.dispatchEvent(new Event('protected-reader-ready'));

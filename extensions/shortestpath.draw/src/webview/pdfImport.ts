/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { BinaryFileData, DataURL } from '@excalidraw/excalidraw/types';
import type { FileId } from '@excalidraw/excalidraw/element/types';

export interface PdfPageImage {
	file: BinaryFileData;
	width: number;
	height: number;
}

export function isPdf(file: Pick<File, 'type' | 'name'>): boolean {
	return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/** Render sequentially to keep only one page canvas in memory at a time. */
export async function renderPdf(file: File, assets: string): Promise<PdfPageImage[]> {
	const pdfjs = await import('pdfjs-dist');
	const root = new URL('pdfjs/', assets).href;
	pdfjs.GlobalWorkerOptions.workerSrc = `${root}pdf.worker.min.mjs`;
	const task = pdfjs.getDocument({
		data: new Uint8Array(await file.arrayBuffer()),
		cMapUrl: `${root}cmaps/`, cMapPacked: true,
		standardFontDataUrl: `${root}standard_fonts/`, wasmUrl: `${root}wasm/`, iccUrl: `${root}iccs/`,
		useWorkerFetch: false,
	});
	try {
		const pdf = await task.promise;
		const images: PdfPageImage[] = [];
		for (let number = 1; number <= pdf.numPages; number++) {
			const page = await pdf.getPage(number);
			const size = page.getViewport({ scale: 1 });
			// Preserve the page's logical size while bounding raster memory for large sheets.
			const scale = Math.min(2, 4096 / Math.max(size.width, size.height));
			const viewport = page.getViewport({ scale });
			const canvas = document.createElement('canvas');
			try {
				canvas.width = Math.ceil(viewport.width);
				canvas.height = Math.ceil(viewport.height);
				await page.render({ canvas, viewport, background: '#ffffff' }).promise;
				images.push({
					file: { id: crypto.randomUUID() as FileId, mimeType: 'image/png', dataURL: canvas.toDataURL('image/png') as DataURL, created: Date.now() },
					width: size.width, height: size.height,
				});
			} finally {
				canvas.width = canvas.height = 0;
				page.cleanup();
			}
		}
		return images;
	} finally {
		await task.destroy();
	}
}

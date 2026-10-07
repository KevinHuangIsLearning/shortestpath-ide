/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

function escapeAttribute(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function getDrawHtml(options: { resourceRoot: string; cspSource: string; language: string; theme: string; companion: boolean; title: string; nonce: string }): string {
	const root = escapeAttribute(options.resourceRoot);
	return `<!DOCTYPE html>
<html lang="${escapeAttribute(options.language)}"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${options.cspSource} 'nonce-${options.nonce}' 'wasm-unsafe-eval'; style-src ${options.cspSource} 'unsafe-inline'; font-src ${options.cspSource} data:; img-src ${options.cspSource} data: blob:; connect-src ${options.cspSource};">
<title>${escapeAttribute(options.title)}</title>
<link rel="stylesheet" href="${root}/webview.css"></head>
<body><div id="root" data-assets="${root}/" data-language="${escapeAttribute(options.language)}" data-theme="${escapeAttribute(options.theme)}" data-companion="${options.companion}"></div>
<script type="module" nonce="${options.nonce}" src="${root}/webview.js"></script></body></html>`;
}

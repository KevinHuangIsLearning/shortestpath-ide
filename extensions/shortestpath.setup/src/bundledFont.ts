/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/** Webviews have their own font faces and cannot inherit the workbench's bundled font. */
export function withBundledCodeFont(html: string, webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const fontUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'fonts', 'FiraCode-VF.ttf'));
	const style = `<style>@font-face { font-family: 'Fira Code'; src: url('${fontUri}') format('truetype'); font-style: normal; font-weight: 300 700; font-display: swap; }</style>`;
	return html.replace("default-src 'none';", `default-src 'none'; font-src ${webview.cspSource};`).replace('</head>', style + '</head>');
}

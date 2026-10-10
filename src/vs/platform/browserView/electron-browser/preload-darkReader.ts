/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { IBrowserDarkReaderConfiguration, IBrowserDarkReaderResource } from '../common/browserDarkReader.js';

// Replaced with the bundled official API and controller by the preload build.
declare const DARK_READER_SCRIPT: string;

if (location.protocol === 'http:' || location.protocol === 'https:') {
	const { contextBridge, ipcRenderer, webFrame } = require('electron');
	const worldId = 1001;
	let apply: ((configuration: IBrowserDarkReaderConfiguration) => void) | undefined;

	// The page retains its own CSP. Only this trusted world may inject the
	// engine's styles and stylesheet proxy; no Node or IPC is exposed to it.
	webFrame.setIsolatedWorldInfo(worldId, {
		securityOrigin: location.origin,
		// eslint-disable-next-line local/code-no-unexternalized-strings
		csp: "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src http: https: data: blob:; connect-src http: https: data: blob:;",
		name: 'Dark Reader',
	});
	ipcRenderer.on('vscode:browserView:darkReader', (_event: Electron.IpcRendererEvent, configuration: IBrowserDarkReaderConfiguration) => apply?.({ enabled: configuration?.enabled === true, detectDarkTheme: configuration?.detectDarkTheme !== false, excludedHosts: [] }));
	contextBridge.exposeInIsolatedWorld(worldId, 'shortestPathDarkReaderBridge', {
		ready: (callback: (configuration: IBrowserDarkReaderConfiguration) => void) => {
			apply = callback;
			ipcRenderer.send('vscode:browserView:darkReaderReady', location.href);
		},
		fetch: (url: string): Promise<IBrowserDarkReaderResource> => ipcRenderer.invoke('vscode:browserView:darkReaderFetch', location.href, url),
	});
	void webFrame.executeJavaScriptInIsolatedWorld(worldId, [{ code: DARK_READER_SCRIPT }]).catch((error: Error) => console.error('[Dark Reader]', error));
}

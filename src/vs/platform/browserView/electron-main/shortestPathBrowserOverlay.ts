/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import electron, { type BrowserWindow, type WebContents, type WebContentsView } from 'electron';
import { Disposable, DisposableStore, toDisposable } from '../../../base/common/lifecycle.js';
import { Event } from '../../../base/common/event.js';
import { validatedIpcMain } from '../../../base/parts/ipc/electron-main/ipcMain.js';

interface IOverlay {
	readonly owner: WebContents;
	readonly window: BrowserWindow;
	readonly view: WebContentsView;
	readonly store: DisposableStore;
}

export interface IShortestPathBrowserOverlayEnvironment {
	readonly ipc: Pick<typeof validatedIpcMain, 'handle' | 'removeHandler'>;
	getWindow(owner: WebContents): BrowserWindow | null;
	getOpener(contents: WebContents): WebContents | undefined;
	createView(options: Electron.BrowserWindowConstructorOptions): WebContentsView;
}

const nativeEnvironment: IShortestPathBrowserOverlayEnvironment = {
	ipc: validatedIpcMain,
	getWindow: owner => electron.BrowserWindow.fromWebContents(owner),
	getOpener: contents => contents.opener ? electron.webContents.fromFrame(contents.opener) : undefined,
	createView: options => new electron.WebContentsView(options),
};

/** Hosts workbench notification DOM in a native view above integrated browser pages. */
export class ShortestPathBrowserOverlayWindows extends Disposable {
	private readonly pendingOwners = new Set<number>();
	private readonly overlays = new Map<number, IOverlay>();

	constructor(private readonly environment: IShortestPathBrowserOverlayEnvironment = nativeEnvironment) {
		super();
		this.environment.ipc.handle('vscode:layoutBrowserOverlay', async (event, layout: Electron.Rectangle & { viewportWidth: number; viewportHeight: number; zoomFactor: number } | undefined) => {
			const overlay = this.overlays.get(event.sender.id);
			if (!overlay || event.senderFrame !== overlay.owner.mainFrame) {
				throw new Error('Unknown browser overlay owner');
			}
			if (!layout) {
				overlay.view.setVisible(false);
				return;
			}
			const values = [layout.x, layout.y, layout.width, layout.height, layout.viewportWidth, layout.viewportHeight, layout.zoomFactor];
			if (!values.every(Number.isFinite) || layout.width <= 0 || layout.height <= 0 || layout.viewportWidth <= 0 || layout.viewportHeight <= 0 || layout.zoomFactor < 0.25 || layout.zoomFactor > 5) {
				throw new Error('Invalid browser overlay bounds');
			}
			const z = layout.zoomFactor;
			const x = Math.floor(layout.x * z);
			const y = Math.floor(layout.y * z);
			// A native view must have the notification's actual bounds. A parent
			// View does not clip a WebContentsView reliably on macOS.
			overlay.view.setBounds({ x, y, width: Math.ceil((layout.x + layout.width) * z) - x, height: Math.ceil((layout.y + layout.height) * z) - y });
			overlay.view.webContents.setZoomFactor(z);
			overlay.window.contentView.addChildView(overlay.view);
			overlay.view.setVisible(true);
		});
		this._register(toDisposable(() => this.environment.ipc.removeHandler('vscode:layoutBrowserOverlay')));
		this._register(toDisposable(() => {
			this.pendingOwners.clear();
			for (const overlay of this.overlays.values()) {
				overlay.store.dispose();
			}
		}));
	}

	/** Called before auxiliary-window registration during popup creation. */
	isOverlay(contents: WebContents): boolean {
		return this.pendingOwners.has(this.environment.getOpener(contents)?.id ?? -1);
	}

	/** Only the trusted workbench may request this specialized popup. */
	createWindowOpenHandler(owner: WebContents): Electron.WindowOpenHandlerResponse {
		const window = this.environment.getWindow(owner);
		if (!window || this.overlays.has(owner.id) || this.pendingOwners.has(owner.id)) {
			return { action: 'deny' };
		}
		this.pendingOwners.add(owner.id);
		return {
			action: 'allow',
			overrideBrowserWindowOptions: { webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false } },
			createWindow: options => {
				try {
					const view = this.environment.createView(options);
					view.setVisible(false);
					view.setBackgroundColor('#00000000');
					view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
					window.contentView.addChildView(view);
					const store = new DisposableStore();
					const overlay: IOverlay = { owner, window, view, store };
					this.overlays.set(owner.id, overlay);
					store.add(toDisposable(() => {
						this.overlays.delete(owner.id);
						if (!window.isDestroyed()) {
							window.contentView.removeChildView(view);
						}
						if (!view.webContents.isDestroyed()) {
							view.webContents.close();
						}
					}));
					store.add(Event.fromNodeEventEmitter(owner, 'destroyed')(() => store.dispose()));
					store.add(Event.fromNodeEventEmitter(owner, 'did-start-navigation', (_event, _url, _inPlace, isMainFrame: boolean) => isMainFrame)(isMainFrame => {
						if (isMainFrame) {
							store.dispose();
						}
					}));
					store.add(Event.fromNodeEventEmitter(view.webContents, 'destroyed')(() => store.dispose()));
					return view.webContents;
				} finally {
					this.pendingOwners.delete(owner.id);
				}
			}
		};
	}
}

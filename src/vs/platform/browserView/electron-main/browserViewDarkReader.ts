/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { net } from 'electron';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { browserDarkReaderHostname, isBrowserDarkReaderEnabled, IBrowserDarkReaderConfiguration, IBrowserDarkReaderResource } from '../common/browserDarkReader.js';
import type { ILogService } from '../../log/common/log.js';

const maximumResourceBytes = 5 * 1024 * 1024;

/** Owns trusted frame messages and resource requests for one browser view. */
export class BrowserViewDarkReader extends Disposable {
	private configuration: IBrowserDarkReaderConfiguration = { enabled: false, excludedHosts: [] };
	private readonly frames = new Map<Electron.WebFrameMain, string>();
	private readonly requests = new Map<AbortController, { frame: Electron.WebFrameMain; documentUrl: string }>();

	constructor(private readonly webContents: Electron.WebContents, private readonly logService: ILogService) {
		super();
		const ready = (event: Electron.IpcMainEvent, url: string) => {
			const frame = event.senderFrame;
			if (frame && typeof url === 'string' && this.isCurrentFrame(frame, url)) {
				this.frames.set(frame, url);
				this.apply(frame);
			}
		};
		webContents.ipc.on('vscode:browserView:darkReaderReady', ready);
		webContents.ipc.handle('vscode:browserView:darkReaderFetch', (event, documentUrl: string, url: string) => this.fetch(event.senderFrame, documentUrl, url).catch(error => {
			this.logService.debug('[Dark Reader] Resource request failed', error);
			return { body: new Uint8Array(), contentType: 'text/css' };
		}));
		const navigated = () => this.update();
		webContents.on('did-frame-navigate', navigated);
		webContents.on('did-navigate', navigated);
		const navigatedInPage = () => {
			for (const frame of this.frames.keys()) {
				if (!frame.detached) {
					this.frames.set(frame, frame.url);
				}
			}
			this.update();
		};
		webContents.on('did-navigate-in-page', navigatedInPage);
		this._register(toDisposable(() => {
			webContents.ipc.removeListener('vscode:browserView:darkReaderReady', ready);
			webContents.ipc.removeHandler('vscode:browserView:darkReaderFetch');
			webContents.removeListener('did-frame-navigate', navigated);
			webContents.removeListener('did-navigate', navigated);
			webContents.removeListener('did-navigate-in-page', navigatedInPage);
			this.frames.clear();
			for (const request of this.requests.keys()) {
				request.abort();
			}
			this.requests.clear();
		}));
	}

	setConfiguration(configuration: IBrowserDarkReaderConfiguration): void {
		this.configuration = configuration;
		this.update();
	}

	private isCurrentFrame(frame: Electron.WebFrameMain, url: string): boolean {
		try {
			return !this.webContents.isDestroyed() && !frame.detached && frame.url === url
				&& this.webContents.mainFrame.framesInSubtree.includes(frame) && !!browserDarkReaderHostname(url);
		} catch {
			return false;
		}
	}

	private apply(frame: Electron.WebFrameMain): void {
		try {
			frame.postMessage('vscode:browserView:darkReader', {
				enabled: isBrowserDarkReaderEnabled(this.webContents.mainFrame.url, this.configuration),
				detectDarkTheme: this.configuration.detectDarkTheme !== false,
			});
		} catch (error) {
			this.frames.delete(frame);
			this.logService.debug('[Dark Reader] Frame disappeared', error);
		}
	}

	private update(): void {
		for (const [controller, request] of this.requests) {
			if (!this.isCurrentFrame(request.frame, request.documentUrl) || !isBrowserDarkReaderEnabled(this.webContents.mainFrame.url, this.configuration)) {
				controller.abort();
			}
		}
		for (const [frame, url] of this.frames) {
			if (this.isCurrentFrame(frame, url)) {
				this.apply(frame);
			} else {
				this.frames.delete(frame);
			}
		}
	}

	private async fetch(frame: Electron.WebFrameMain | null, documentUrl: string, resourceUrl: string): Promise<IBrowserDarkReaderResource> {
		if (!frame || typeof documentUrl !== 'string' || typeof resourceUrl !== 'string' || !this.isCurrentFrame(frame, documentUrl)
			|| this.frames.get(frame) !== documentUrl || !isBrowserDarkReaderEnabled(this.webContents.mainFrame.url, this.configuration)) {
			throw new Error('Inactive Dark Reader frame');
		}
		const controller = new AbortController();
		this.requests.set(controller, { frame, documentUrl });
		const timeout = setTimeout(() => controller.abort(), 10000);
		try {
			const validUrl = (value: string) => {
				try {
					const url = new URL(value);
					return !!browserDarkReaderHostname(url.href) && !url.username && !url.password;
				} catch {
					return false;
				}
			};
			if (!validUrl(resourceUrl)) {
				throw new Error('Unsupported Dark Reader resource URL');
			}
			// Electron fetch cancels manual redirects instead of returning their
			// headers. ClientRequest lets us validate each destination before following.
			const resource = await new Promise<IBrowserDarkReaderResource>((resolve, reject) => {
				const request = net.request({ url: resourceUrl, session: this.webContents.session, useSessionCookies: true, redirect: 'manual' });
				let settled = false;
				const finish = (error?: Error, resource?: IBrowserDarkReaderResource) => {
					if (settled) {
						return;
					}
					settled = true;
					controller.signal.removeEventListener('abort', abort);
					if (error) {
						reject(error);
					} else {
						resolve(resource!);
					}
				};
				const abort = () => { request.abort(); finish(new Error('Dark Reader request cancelled')); };
				controller.signal.addEventListener('abort', abort, { once: true });
				request.once('error', error => finish(error));
				let redirects = 0;
				request.on('redirect', (_status, _method, url) => {
					if (++redirects <= 5 && validUrl(url)) {
						request.followRedirect();
					} else {
						request.abort();
						finish(new Error('Unsupported Dark Reader resource redirect'));
					}
				});
				request.once('response', response => {
					const header = response.headers['content-type'];
					const contentType = Array.isArray(header) ? header[0] : header ?? '';
					if (response.statusCode < 200 || response.statusCode >= 300 || !/^(text\/css|image\/)/i.test(contentType)) {
						request.abort();
						finish(new Error('Unsupported Dark Reader resource response'));
						return;
					}
					const chunks: Buffer[] = [];
					let length = 0;
					response.once('error', error => finish(error));
					response.once('aborted', () => finish(new Error('Dark Reader response aborted')));
					response.once('end', () => finish(undefined, { body: new Uint8Array(Buffer.concat(chunks)), contentType }));
					response.on('data', (chunk: Buffer) => {
						length += chunk.byteLength;
						if (length > maximumResourceBytes) {
							request.abort();
							finish(new Error('Dark Reader resource is too large'));
						} else {
							chunks.push(chunk);
						}
					});
				});
				if (controller.signal.aborted) {
					abort();
				} else {
					request.end();
				}
			});
			if (controller.signal.aborted || !this.isCurrentFrame(frame, documentUrl) || !isBrowserDarkReaderEnabled(this.webContents.mainFrame.url, this.configuration)) {
				throw new Error('Dark Reader frame navigated');
			}
			return resource;
		} finally {
			clearTimeout(timeout);
			this.requests.delete(controller);
		}
	}
}

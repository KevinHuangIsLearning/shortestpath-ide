/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, copyAttributes, EventType, registerChildWindow, registerWindowViewportOffset } from '../../../../base/browser/dom.js';
import { getZoomFactor } from '../../../../base/browser/browser.js';
import { cloneGlobalStylesheets, isGlobalStylesheet } from '../../../../base/browser/domStylesheets.js';
import { CodeWindow, ensureCodeWindow, mainWindow } from '../../../../base/browser/window.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ISandboxGlobals } from '../../../../base/parts/sandbox/electron-browser/globals.js';
import { ILogService } from '../../../../platform/log/common/log.js';

export interface IShortestPathBrowserOverlayLayout {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly viewportWidth: number;
	readonly viewportHeight: number;
	readonly zoomFactor: number;
}

export interface IShortestPathBrowserOverlayHost {
	open(): Window | null;
	layout(layout: IShortestPathBrowserOverlayLayout | undefined): Promise<void>;
}

interface INotificationPortal {
	readonly element: HTMLElement;
	readonly placeholder: Comment;
}

/** A live DOM portal: notification handlers and state stay in the workbench renderer. */
export class ShortestPathBrowserOverlay extends Disposable {
	private static readonly instances = new WeakMap<CodeWindow, { overlay: ShortestPathBrowserOverlay; references: number }>();
	private readonly browsers = new Set<HTMLElement>();
	private readonly portals = new Map<HTMLElement, INotificationPortal>();
	private readonly windowStore = this._register(new DisposableStore());
	private target: Window | undefined;
	private root: HTMLElement | undefined;
	private frame: number | undefined;
	private ready = false;
	private opening = false;
	private disposed = false;
	private lastLayout: string | undefined;
	private rootStyle = '';
	private offset = { x: 0, y: 0 };
	private layoutQueue: Promise<void> = Promise.resolve();

	static acquire(source: CodeWindow, logService: ILogService): { setVisible(container: HTMLElement, visible: boolean): void; dispose(): void } {
		let entry = this.instances.get(source);
		if (!entry) {
			const nativeWindow = source as CodeWindow & { vscode?: ISandboxGlobals };
			const host: IShortestPathBrowserOverlayHost = {
				open: () => nativeWindow.vscode ? source.open('about:blank', generateUuid(), 'vscode-native-browser-overlay=yes') : null,
				layout: async layout => { await nativeWindow.vscode?.ipcRenderer.invoke('vscode:layoutBrowserOverlay', layout); }
			};
			entry = { overlay: new ShortestPathBrowserOverlay(source, host, logService), references: 0 };
			this.instances.set(source, entry);
		}
		entry.references++;
		const containers = new Set<HTMLElement>();
		let disposed = false;
		return {
			setVisible: (container, visible) => {
				if (disposed) {
					return;
				}
				containers.add(container);
				entry.overlay.setVisible(container, visible);
			},
			dispose: () => {
				if (disposed) {
					return;
				}
				disposed = true;
				for (const container of containers) {
					entry.overlay.setVisible(container, false);
				}
				if (--entry.references === 0) {
					entry.overlay.dispose();
					this.instances.delete(source);
				}
			}
		};
	}

	constructor(
		private readonly source: CodeWindow,
		private readonly host: IShortestPathBrowserOverlayHost,
		private readonly logService: ILogService,
	) {
		super();
		const observer = new source.MutationObserver(() => this.scheduleUpdate());
		observer.observe(source.document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'inert'] });
		this._register(toDisposable(() => observer.disconnect()));
		this._register(addDisposableListener(source, EventType.RESIZE, () => this.scheduleUpdate()));
	}

	setVisible(container: HTMLElement, visible: boolean): void {
		if (visible) {
			this.browsers.add(container);
			void this.open();
		} else {
			this.browsers.delete(container);
		}
		this.scheduleUpdate();
	}

	private scheduleUpdate(): void {
		if (this.disposed || this.frame !== undefined) {
			return;
		}
		this.frame = this.source.requestAnimationFrame(() => {
			this.frame = undefined;
			this.update();
		});
	}

	private async open(): Promise<void> {
		if (this.target || this.opening || this.disposed) {
			return;
		}
		this.opening = true;
		try {
			const target = this.host.open();
			if (!target) {
				return;
			}
			this.target = target;
			this.rootStyle = '';
			ensureCodeWindow(target, this.source.vscodeWindowId);
			this.windowStore.add(registerWindowViewportOffset(target, () => ({ ...this.offset, width: this.source.innerWidth, height: this.source.innerHeight })));
			// The workbench owns these existing nodes; they are not built by this portal.
			// eslint-disable-next-line no-restricted-syntax
			const csp = this.source.document.head.querySelector('meta[http-equiv="Content-Security-Policy"]');
			if (csp) {
				const clone = csp.cloneNode(true) as HTMLMetaElement;
				clone.content = clone.content.replace(/script-src[^;]*/, 'script-src \'none\'');
				target.document.head.appendChild(clone);
			}
			copyAttributes(this.source.document.body, target.document.body);
			target.document.body.style.cssText = 'margin: 0; background: transparent; overflow: hidden;';
			this.root = target.document.body.appendChild($('div'));
			this.root.className = 'monaco-workbench';
			this.windowStore.add(registerChildWindow(target as CodeWindow));
			const loaded: Promise<void>[] = [];
			// eslint-disable-next-line no-restricted-syntax
			for (const style of this.source.document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
				if (isGlobalStylesheet(style)) {
					continue;
				}
				const clone = style.cloneNode(true) as HTMLElement;
				if (clone.tagName === 'LINK') {
					loaded.push(new Promise<void>(resolve => {
						this.windowStore.add(addDisposableListener(clone, 'load', () => resolve(), { once: true }));
						this.windowStore.add(addDisposableListener(clone, 'error', () => resolve(), { once: true }));
					}));
				}
				target.document.head.appendChild(clone);
				const observer = new this.source.MutationObserver(() => {
					if (clone.textContent !== style.textContent) {
						clone.textContent = style.textContent;
					}
				});
				observer.observe(style, { childList: true, subtree: true, characterData: true });
				this.windowStore.add(toDisposable(() => observer.disconnect()));
			}
			this.windowStore.add(cloneGlobalStylesheets(target));
			const observer = new this.source.MutationObserver(() => this.scheduleUpdate());
			observer.observe(this.root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
			this.windowStore.add(toDisposable(() => observer.disconnect()));

			this.windowStore.add(addDisposableListener(target, EventType.UNLOAD, () => {
				this.restore();
				this.target = undefined;
				this.root = undefined;
				this.ready = false;
				this.lastLayout = undefined;
				this.windowStore.clear();
			}));
			await Promise.all(loaded);
			if (!this.disposed && this.target === target) {
				this.ready = true;
				this.scheduleUpdate();
			}
		} catch (error) {
			this.logService.error('Failed to open native browser notification overlay', error);
		} finally {
			this.opening = false;
		}
	}

	private update(): void {
		if (!this.ready || !this.root || !this.target) {
			return;
		}
		// Preserve workbench layering only where a higher overlay overlaps a notification.
		// Unrelated editor hovers must not pull notifications behind a still-visible page.
		// eslint-disable-next-line no-restricted-syntax
		const notifications = [...this.portals.keys(), ...this.source.document.querySelectorAll<HTMLElement>('.notifications-toasts, .notifications-center')].filter(element => element.classList.contains('visible')).map(element => {
			const rect = element.getBoundingClientRect();
			const offset = element.ownerDocument === this.target!.document ? this.offset : { x: 0, y: 0 };
			return { left: rect.left + offset.x, right: rect.right + offset.x, top: rect.top + offset.y, bottom: rect.bottom + offset.y };
		});
		// eslint-disable-next-line no-restricted-syntax
		const blocking = [...this.source.document.querySelectorAll<HTMLElement>('.quick-input-widget, .monaco-dialog-modal-block, .monaco-modal-editor-block, .monaco-menu-container, .monaco-hover, .context-view')].some(element => {
			const rect = element.getBoundingClientRect();
			const style = this.source.getComputedStyle(element);
			return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && notifications.some(notification => rect.left < notification.right && rect.right > notification.left && rect.top < notification.bottom && rect.bottom > notification.top);
		});
		if (!this.browsers.size || blocking) {
			this.restore();
			this.setLayout(undefined);
			return;
		}
		// eslint-disable-next-line no-restricted-syntax
		for (const element of this.source.document.querySelectorAll<HTMLElement>('.monaco-workbench > .notifications-toasts, .monaco-workbench > .notifications-center')) {
			const parent = element.parentElement!;
			if (this.root.className !== parent.className) {
				this.root.className = parent.className;
			}
			const placeholder = mainWindow.document.createComment('native browser notification overlay');
			element.before(placeholder);
			this.portals.set(element, { element, placeholder });
			this.root.appendChild(element);
		}
		const parent = this.portals.values().next().value?.placeholder.parentElement;
		if (parent) {
			const css = `${parent.style.cssText}; position: absolute; left: ${-this.offset.x}px; top: ${-this.offset.y}px; width: ${this.source.innerWidth}px; height: ${this.source.innerHeight}px; background: transparent;`;
			if (this.rootStyle !== css) {
				this.rootStyle = css;
				this.root.style.cssText = css;
			}
			if (this.root.className !== parent.className) {
				this.root.className = parent.className;
			}
		}
		const visible = [...this.portals.values()].filter(portal => portal.element.classList.contains('visible')).map(portal => portal.element.getBoundingClientRect());
		// Notification tooltips share the portal and must also fit inside its native bounds.
		// eslint-disable-next-line no-restricted-syntax
		visible.push(...[...this.root.querySelectorAll<HTMLElement>('.monaco-hover')].map(element => element.getBoundingClientRect()));
		const rectangles = visible.filter(rect => rect.width > 0 && rect.height > 0);
		if (!rectangles.length) {
			this.setLayout(undefined);
			return;
		}
		// Include the existing notification shadows without intercepting the rest of the page.
		const z = getZoomFactor(this.source);
		const x = Math.floor(Math.max(0, Math.min(...rectangles.map(rect => rect.left + this.offset.x)) - 8) * z) / z;
		const y = Math.floor(Math.max(0, Math.min(...rectangles.map(rect => rect.top + this.offset.y)) - 8) * z) / z;
		const right = Math.min(this.source.innerWidth, Math.max(...rectangles.map(rect => rect.right + this.offset.x)) + 8);
		const bottom = Math.min(this.source.innerHeight, Math.max(...rectangles.map(rect => rect.bottom + this.offset.y)) + 8);
		this.offset = { x, y };
		if (this.root.style.left !== `${-x}px`) {
			this.root.style.left = `${-x}px`;
		}
		if (this.root.style.top !== `${-y}px`) {
			this.root.style.top = `${-y}px`;
		}
		this.setLayout({ x, y, width: right - x, height: bottom - y, viewportWidth: this.source.innerWidth, viewportHeight: this.source.innerHeight, zoomFactor: z });
	}

	private setLayout(layout: IShortestPathBrowserOverlayLayout | undefined): void {
		const key = JSON.stringify(layout);
		if (key === this.lastLayout) {
			return;
		}
		this.lastLayout = key;
		this.layoutQueue = this.layoutQueue.then(() => this.host.layout(layout)).catch(error => {
			this.lastLayout = undefined;
			this.logService.error('Failed to lay out native browser notification overlay', error);
		});
	}

	private restore(): void {
		for (const { element, placeholder } of this.portals.values()) {
			placeholder.replaceWith(element);
		}
		this.portals.clear();
	}

	override dispose(): void {
		this.disposed = true;
		if (this.frame !== undefined) {
			this.source.cancelAnimationFrame(this.frame);
		}
		this.restore();
		this.target?.close();
		super.dispose();
	}
}

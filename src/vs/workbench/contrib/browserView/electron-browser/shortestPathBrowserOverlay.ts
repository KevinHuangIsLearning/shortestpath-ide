/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, copyAttributes, EventType, getDomNodeZoomLevel, isHTMLElement, registerChildWindow, registerWindowViewportOffset } from '../../../../base/browser/dom.js';
import { getZoomFactor } from '../../../../base/browser/browser.js';
import { cloneGlobalStylesheets, isGlobalStylesheet } from '../../../../base/browser/domStylesheets.js';
import { CodeWindow, ensureCodeWindow, mainWindow } from '../../../../base/browser/window.js';
import { Disposable, DisposableMap, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
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

/** Hosts notifications and navigation labels above native pages while the workbench owns their state. */
export class ShortestPathBrowserOverlay extends Disposable {
	private static readonly instances = new WeakMap<CodeWindow, Map<string, { overlay: ShortestPathBrowserOverlay; references: number }>>();
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
	private navigationContent = '';

	static acquire(source: CodeWindow, logService: ILogService, kind: 'notification' | 'navigation' = 'notification'): { setVisible(container: HTMLElement, visible: boolean): void; dispose(): void } {
		let instances = this.instances.get(source);
		if (!instances) {
			instances = new Map();
			this.instances.set(source, instances);
		}
		let entry = instances.get(kind);
		if (!entry) {
			const nativeWindow = source as CodeWindow & { vscode?: ISandboxGlobals };
			const host: IShortestPathBrowserOverlayHost = {
				open: () => nativeWindow.vscode ? source.open('about:blank', generateUuid(), `vscode-native-browser-overlay=${kind === 'navigation' ? 'navigation' : 'yes'}`) : null,
				layout: async layout => { await nativeWindow.vscode?.ipcRenderer.invoke('vscode:layoutBrowserOverlay', layout, kind); }
			};
			entry = { overlay: new ShortestPathBrowserOverlay(source, host, logService, kind), references: 0 };
			instances.set(kind, entry);
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
					instances.delete(kind);
					if (!instances.size) {
						this.instances.delete(source);
					}
				}
			}
		};
	}

	constructor(
		private readonly source: CodeWindow,
		private readonly host: IShortestPathBrowserOverlayHost,
		private readonly logService: ILogService,
		private readonly kind: 'notification' | 'navigation' = 'notification',
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
			if (this.kind === 'notification') {
				void this.open();
			}
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
			this.navigationContent = '';
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
			copyAttributes(this.source.document.documentElement, target.document.documentElement);
			this.makeTransparent(target.document.documentElement);
			const documentObserver = new this.source.MutationObserver(() => {
				copyAttributes(this.source.document.documentElement, target.document.documentElement);
				this.makeTransparent(target.document.documentElement);
				this.scheduleUpdate();
			});
			documentObserver.observe(this.source.document.documentElement, { attributes: true, attributeFilter: ['lang', 'dir', 'class', 'style'] });
			this.windowStore.add(toDisposable(() => documentObserver.disconnect()));
			copyAttributes(this.source.document.body, target.document.body);
			target.document.body.style.cssText = 'margin: 0; overflow: hidden;';
			this.makeTransparent(target.document.body);
			this.root = target.document.body.appendChild($('div'));
			this.root.className = 'monaco-workbench';
			this.windowStore.add(registerChildWindow(target as CodeWindow));
			const loaded: Promise<void>[] = [];
			const styles = this.windowStore.add(new DisposableMap<HTMLElement>());
			const cloneStyle = (style: HTMLElement, initial = false): void => {
				if (isGlobalStylesheet(style) || styles.has(style)) {
					return;
				}
				const styleStore = new DisposableStore();
				styles.set(style, styleStore);
				const clone = style.cloneNode(true) as HTMLElement;
				styleStore.add(toDisposable(() => clone.remove()));
				if (clone.tagName === 'LINK') {
					// The child is about:blank; preserve the source URL's base for CSS resources.
					(clone as HTMLLinkElement).href = (style as HTMLLinkElement).href;
					const settled = new Promise<void>(resolve => {
						const finish = () => { this.scheduleUpdate(); resolve(); };
						styleStore.add(addDisposableListener(clone, 'load', finish, { once: true }));
						styleStore.add(addDisposableListener(clone, 'error', finish, { once: true }));
						styleStore.add(toDisposable(() => resolve()));
					});
					if (initial) {
						loaded.push(settled);
					}
				}
				target.document.head.appendChild(clone);
				const observer = new this.source.MutationObserver(() => {
					if (clone.textContent !== style.textContent) {
						clone.textContent = style.textContent;
					}
					this.scheduleUpdate();
				});
				observer.observe(style, { childList: true, subtree: true, characterData: true });
				styleStore.add(toDisposable(() => observer.disconnect()));
			};
			// eslint-disable-next-line no-restricted-syntax
			for (const style of this.source.document.head.querySelectorAll<HTMLElement>('style, link[rel="stylesheet"]')) {
				cloneStyle(style, true);
			}
			this.windowStore.add(cloneGlobalStylesheets(target));
			const headObserver = new this.source.MutationObserver(records => {
				for (const record of records) {
					for (const node of record.removedNodes) {
						if (isHTMLElement(node)) {
							styles.deleteAndDispose(node);
						}
					}
					for (const node of record.addedNodes) {
						if (isHTMLElement(node) && (node.tagName === 'STYLE' || (node.tagName === 'LINK' && (node as HTMLLinkElement).rel === 'stylesheet'))) {
							cloneStyle(node);
						}
					}
				}
				this.scheduleUpdate();
			});
			headObserver.observe(this.source.document.head, { childList: true });
			this.windowStore.add(toDisposable(() => headObserver.disconnect()));
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
			this.logService.error('Failed to open native browser overlay', error);
		} finally {
			this.opening = false;
		}
	}

	private update(): void {
		// Keep the extra native renderer lazy until a navigation label is shown.
		// eslint-disable-next-line no-restricted-syntax
		if (this.kind === 'navigation' && this.browsers.size && !this.target && this.source.document.querySelector('.shortestpath-navigation-hover')) {
			void this.open();
		}
		if (!this.ready || !this.root || !this.target) {
			return;
		}
		if (this.kind === 'navigation') {
			this.updateNavigation();
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
			// Navigation labels have their own native layer above notifications.
			// eslint-disable-next-line no-restricted-syntax
			if (element.classList.contains('shortestpath-navigation-hover') || element.querySelector('.shortestpath-navigation-hover')) {
				return false;
			}
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
			this.setRootClassName(parent);
			const placeholder = mainWindow.document.createComment('native browser notification overlay');
			element.before(placeholder);
			this.portals.set(element, { element, placeholder });
			this.root.appendChild(element);
		}
		const parent = this.portals.values().next().value?.placeholder.parentElement;
		if (parent) {
			this.setRootStyle(`${parent.style.cssText}; position: absolute; left: ${-this.offset.x}px; top: ${-this.offset.y}px; width: ${this.source.innerWidth}px; height: ${this.source.innerHeight}px;`);
			this.setRootClassName(parent);
		}
		const visible = [...this.portals.values()].filter(portal => portal.element.classList.contains('visible')).map(portal => portal.element.getBoundingClientRect());
		// Notification tooltips share the portal and must also fit inside its native bounds.
		// eslint-disable-next-line no-restricted-syntax
		visible.push(...[...this.root.querySelectorAll<HTMLElement>('.monaco-hover')].map(element => element.getBoundingClientRect()));
		const rectangles = visible.filter(rect => rect.width > 0 && rect.height > 0);
		this.layoutRectangles(rectangles);
	}

	/** Mirrors plain navigation labels in a separate native view, retaining hover lifecycle in the source document. */
	private updateNavigation(): void {
		const root = this.root;
		if (!root) {
			return;
		}
		// eslint-disable-next-line no-restricted-syntax
		const hover = this.browsers.size ? this.source.document.querySelector<HTMLElement>('.shortestpath-navigation-hover') : null;
		const workbench = hover?.closest<HTMLElement>('.monaco-workbench');
		const rect = hover?.getBoundingClientRect();
		if (!hover || !workbench || !rect?.width || !rect.height || this.source.getComputedStyle(hover).visibility === 'hidden') {
			if (this.navigationContent) {
				root.replaceChildren();
				this.navigationContent = '';
			}
			this.setLayout(undefined);
			return;
		}
		// A separate view keeps notification and tooltip bounds independent, so the
		// transparent space between them never intercepts clicks on the page.
		const context = hover.closest<HTMLElement>('.context-view');
		if (!context) {
			this.setLayout(undefined);
			return;
		}
		const content = context.outerHTML;
		if (this.navigationContent !== content) {
			const clone = context.cloneNode(true) as HTMLElement;
			clone.setAttribute('aria-hidden', 'true');
			root.replaceChildren(clone);
			this.navigationContent = content;
		}
		this.setRootClassName(workbench);
		const zoom = getDomNodeZoomLevel(workbench);
		this.setRootStyle(`${workbench.style.cssText}; position: absolute; left: ${-this.offset.x / zoom}px; top: ${-this.offset.y / zoom}px; width: ${this.source.innerWidth}px; height: ${this.source.innerHeight}px;`);
		// eslint-disable-next-line no-restricted-syntax
		const mirrored = root.querySelector<HTMLElement>('.shortestpath-navigation-hover')!;
		this.layoutRectangles([mirrored.getBoundingClientRect()]);
	}

	private makeTransparent(element: HTMLElement): void {
		element.style.setProperty('background', 'transparent', 'important');
		element.style.setProperty('background-color', 'transparent', 'important');
	}

	private setRootClassName(source: HTMLElement): void {
		const root = this.root;
		if (!root) {
			return;
		}
		const className = [...source.classList].filter(className => className !== 'border').join(' ');
		if (root.className !== className) {
			root.className = className;
		}
	}

	private setRootStyle(style: string): void {
		const root = this.root;
		if (!root) {
			return;
		}
		const rootStyle = `${style}; background: transparent !important; background-color: transparent !important; border: 0 !important; border-radius: 0 !important;`;
		if (this.rootStyle !== rootStyle) {
			this.rootStyle = rootStyle;
			root.style.cssText = rootStyle;
		}
	}

	private layoutRectangles(rectangles: readonly DOMRect[]): void {
		const root = this.root;
		if (!root || !rectangles.length) {
			this.setLayout(undefined);
			return;
		}
		// Include floating surface shadows without intercepting the rest of the page.
		const z = getZoomFactor(this.source);
		const x = Math.floor(Math.max(0, Math.min(...rectangles.map(rect => rect.left + this.offset.x)) - 8) * z) / z;
		const y = Math.floor(Math.max(0, Math.min(...rectangles.map(rect => rect.top + this.offset.y)) - 8) * z) / z;
		const right = Math.min(this.source.innerWidth, Math.max(...rectangles.map(rect => rect.right + this.offset.x)) + 8);
		const bottom = Math.min(this.source.innerHeight, Math.max(...rectangles.map(rect => rect.bottom + this.offset.y)) + 8);
		this.offset = { x, y };
		const zoom = this.kind === 'navigation' ? getDomNodeZoomLevel(root) : 1;
		if (root.style.left !== `${-x / zoom}px`) {
			root.style.left = `${-x / zoom}px`;
		}
		if (root.style.top !== `${-y / zoom}px`) {
			root.style.top = `${-y / zoom}px`;
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
			this.logService.error('Failed to lay out native browser overlay', error);
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

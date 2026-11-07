/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';

export interface SettingsPageHost {
	readonly webview: Pick<vscode.Webview, 'html' | 'postMessage' | 'onDidReceiveMessage'>;
	readonly onDidDispose: vscode.Event<void>;
	openSubpage?(title: string, render: (host: SettingsPageHost) => void | Promise<void>): Promise<void>;
}

type Route = { title: string; render: (host: SettingsPageHost) => void | Promise<void> };

/** Reuses one Webview, disposing each detail page's handlers before changing pages. */
export class SettingsNavigation {
	private readonly routes: Route[] = [];
	private listeners: vscode.Disposable[] = [];
	private disposedCallbacks = new Set<() => void>();
	private generation = 0;
	private pending: Promise<unknown> = Promise.resolve();
	constructor(private readonly webview: vscode.Webview, private readonly decorate: (html: string, title: string) => string, private readonly restore: () => void) { }
	get active(): boolean { return this.routes.length > 0; }
	async open(title: string, render: Route['render']): Promise<void> {
		await this.pending;
		this.routes.push({ title, render });
		await this.show();
	}
	async back(toRoot = false): Promise<void> {
		await this.pending;
		if (toRoot) { this.routes.length = 0; } else { this.routes.pop(); }
		if (this.active) { await this.show(); } else { this.clear(); this.restore(); }
	}
	dispose(): void { this.clear(); this.routes.length = 0; }
	private clear(): void {
		this.generation++;
		for (const callback of this.disposedCallbacks) { callback(); }
		this.disposedCallbacks.clear();
		for (const listener of this.listeners) { listener.dispose(); }
		this.listeners = [];
	}
	private async show(): Promise<void> {
		this.clear();
		const route = this.routes[this.routes.length - 1];
		const generation = this.generation;
		const owner = this;
		let assigned = false;
		const host: SettingsPageHost = {
			webview: {
				get html() { return owner.webview.html; },
				set html(value) { if (generation === owner.generation) { assigned = true; owner.webview.html = owner.decorate(value, route.title); } },
				postMessage: message => generation === this.generation ? this.webview.postMessage(message) : Promise.resolve(false),
				onDidReceiveMessage: (listener, thisArgs, disposables) => {
					const subscription = this.webview.onDidReceiveMessage(message => {
						if (generation !== this.generation || message?.type === 'settingsBack') { return; }
						const work = this.pending.then(() => generation === this.generation ? listener.call(thisArgs, message) : undefined);
						this.pending = work.catch(() => undefined);
						return work;
					});
					this.listeners.push(subscription);
					disposables?.push(subscription);
					return subscription;
				}
			},
			onDidDispose: (listener, thisArgs, disposables) => {
				const callback = () => listener.call(thisArgs);
				this.disposedCallbacks.add(callback);
				const subscription = { dispose: () => { this.disposedCallbacks.delete(callback); } };
				disposables?.push(subscription);
				return subscription;
			},
			// Rendering a nested page from an event must not wait on that same event.
			openSubpage: async (title, render) => { this.routes.push({ title, render }); await this.show(); }
		};
		try { await route.render(host); } catch (error) { if (generation === this.generation) { await this.restorePrevious(); } throw error; }
		if (!assigned && generation === this.generation) { await this.restorePrevious(); }
	}
	private async restorePrevious(): Promise<void> {
		this.routes.pop();
		if (this.active) { await this.show(); } else { this.clear(); this.restore(); }
	}
}

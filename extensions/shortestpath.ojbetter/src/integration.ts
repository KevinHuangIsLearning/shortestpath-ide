/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { BrowserTab, Disposable } from 'vscode';
import { Assets } from './assets';
import { CDP, CDPMessage } from './cdp';
import { Platform, platformForUrl } from './sites';

export const worldName = 'shortestpath-ojbetter';
export const bindingName = '__shortestpathOJBetterBridge';

interface Context {
	id: number;
	uniqueId: string;
	frameId: string;
}

interface FrameTree {
	frameTree: { frame: { id: string; url: string } };
}

interface BridgeRequest {
	id: number;
	operation: string;
	args: Record<string, unknown>;
}

export interface Storage {
	get(platform: Platform): Record<string, unknown>;
	write(platform: Platform, key: string, value: unknown, remove: boolean): Promise<void>;
}

interface Services {
	storage: Storage;
	fetch: typeof fetch;
	clipboard(text: string): PromiseLike<void>;
	log(message: string): void;
	changed(platform: Platform): void;
}

/** Lifecycle and privilege boundary for one tab, independent of Judger's CDP clients. */
export class Integration implements Disposable {
	private readonly contexts = new Map<number, Context>();
	private readonly requests = new Map<string, AbortController>();
	private sessionId: string | undefined;
	private scriptId: string | undefined;
	private disposed = false;
	onDidDispose: () => void = () => { };
	get isDisposed(): boolean { return this.disposed; }

	constructor(private readonly cdp: CDP, private readonly assets: Assets, private readonly services: Services) {
		cdp.onEvent = message => this.event(message);
		cdp.onClose = () => this.dispose();
	}

	async start(enabled: Record<Platform, boolean>): Promise<void> {
		const { targetInfos } = await this.cdp.send<{ targetInfos: { type: string; targetId: string }[] }>('Target.getTargets');
		const target = targetInfos.find(info => info.type === 'page');
		if (!target) {
			throw new Error('OJBetter: browser page target unavailable');
		}
		const { sessionId } = await this.cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId: target.targetId, flatten: true });
		this.sessionId = sessionId;
		await this.cdp.send('Page.enable', {}, sessionId);
		await this.cdp.send('Runtime.enable', {}, sessionId);
		await this.cdp.send('Runtime.addBinding', { name: bindingName, executionContextName: worldName }, sessionId);
		const source = this.assets.source(bindingName, enabled);
		const { identifier } = await this.cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source, worldName }, sessionId);
		this.scriptId = identifier;
		const { frameTree } = await this.cdp.send<FrameTree>('Page.getFrameTree', {}, sessionId);
		if (!platformForUrl(frameTree.frame.url)) {
			return;
		}
		const { executionContextId } = await this.cdp.send<{ executionContextId: number }>('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName }, sessionId);
		const context = this.contexts.get(executionContextId);
		if (context) {
			await this.cdp.send('Runtime.evaluate', { expression: source, uniqueContextId: context.uniqueId }, sessionId);
		}
	}

	private event(message: CDPMessage): void {
		if (message.sessionId !== this.sessionId || this.disposed) {
			return;
		}
		const params = message.params ?? {};
		if (message.method === 'Runtime.executionContextCreated') {
			const context = params.context as { id: number; uniqueId: string; name: string; auxData?: { frameId: string } };
			if (context.name === worldName && context.uniqueId && context.auxData?.frameId) {
				this.contexts.set(context.id, { id: context.id, uniqueId: context.uniqueId, frameId: context.auxData.frameId });
			}
		} else if (message.method === 'Runtime.executionContextsCleared') {
			for (const context of this.contexts.values()) {
				this.revoke(context);
			}
			this.contexts.clear();
		} else if (message.method === 'Runtime.executionContextDestroyed') {
			const context = this.contexts.get(params.executionContextId as number);
			if (context) {
				this.revoke(context);
				this.contexts.delete(context.id);
			}
		} else if (message.method === 'Runtime.exceptionThrown') {
			const details = params.exceptionDetails as { executionContextId?: number; text: string; exception?: { description?: string } };
			if (details.executionContextId && this.contexts.has(details.executionContextId)) {
				this.services.log(`OJBetter runtime error: ${details.exception?.description ?? details.text}`);
			}
		} else if (message.method === 'Runtime.bindingCalled' && params.name === bindingName) {
			const context = this.contexts.get(params.executionContextId as number);
			if (context && typeof params.payload === 'string') {
				void this.handle(context, params.payload).catch(error => this.services.log(`Bridge failed: ${error.message}`));
			}
		}
	}

	private revoke(context: Context): void {
		for (const [key, controller] of this.requests) {
			if (key.startsWith(`${context.uniqueId}:`)) {
				controller.abort();
				this.requests.delete(key);
			}
		}
	}

	private alive(context: Context): boolean {
		return !this.disposed && this.contexts.get(context.id) === context;
	}

	private async authorize(context: Context): Promise<{ platform: Platform; url: string } | undefined> {
		if (!this.alive(context)) {
			return undefined;
		}
		const { frameTree } = await this.cdp.send<FrameTree>('Page.getFrameTree', {}, this.sessionId);
		const platform = platformForUrl(frameTree.frame.url);
		return this.alive(context) && context.frameId === frameTree.frame.id && platform ? { platform, url: frameTree.frame.url } : undefined;
	}

	private async reply(context: Context, reply: object): Promise<void> {
		if (this.alive(context)) {
			await this.cdp.send('Runtime.evaluate', {
				expression: `globalThis.__shortestpathOJBetterReceive?.(${JSON.stringify(reply)})`,
				uniqueContextId: context.uniqueId
			}, this.sessionId);
		}
	}

	private async handle(context: Context, payload: string): Promise<void> {
		if (payload.length > 4 * 1024 * 1024) {
			return;
		}
		const message = JSON.parse(payload) as BridgeRequest;
		if (!Number.isSafeInteger(message.id) || message.id < 1 || !message.args || typeof message.args !== 'object') {
			return;
		}
		const authorized = await this.authorize(context);
		if (!authorized) {
			return;
		}
		const { id, operation, args } = message;
		try {
			if (operation === 'hydrate') {
				await this.reply(context, { id, value: this.services.storage.get(authorized.platform) });
			} else if (operation === 'siteData') {
				// A fixed, read-only bridge for globals that upstream userscripts normally
				// read from the page. Never accept executable source from the userscript.
				const { result } = await this.cdp.send<{ result: { value?: object } }>('Runtime.evaluate', {
					expression: `({
						csrfToken: typeof globalThis.csrfToken === 'string' ? globalThis.csrfToken : globalThis.Codeforces?.getCsrfToken?.() ?? '',
						ace: [...document.querySelectorAll('pre.ace_editor')].map((element, index) => {
							element.setAttribute('data-shortestpath-ace', String(index));
							return globalThis.ace?.edit(element)?.getValue() ?? element.textContent;
						})
					})`, returnByValue: true
				}, this.sessionId);
				if (this.alive(context)) {
					await this.reply(context, { id, value: result.value ?? {} });
				}
			} else if (operation === 'set' || operation === 'delete') {
				if (typeof args.key !== 'string' || args.key.length > 1024 || ['__proto__', 'constructor', 'prototype'].includes(args.key)) {
					throw new Error('Invalid OJBetter storage key');
				}
				await this.services.storage.write(authorized.platform, args.key, args.value, operation === 'delete');
				this.services.changed(authorized.platform);
				await this.reply(context, { id });
			} else if (operation === 'clipboard') {
				if (typeof args.text !== 'string') {
					throw new Error('Invalid clipboard text');
				}
				await this.services.clipboard(args.text);
				await this.reply(context, { id });
			} else if (operation === 'request') {
				await this.request(context, id, args, authorized.url);
			} else if (operation === 'abort') {
				this.requests.get(`${context.uniqueId}:${id}`)?.abort();
			} else {
				throw new Error('Unsupported OJBetter operation');
			}
		} catch (error) {
			await this.reply(context, { id, error: error.message });
		}
	}

	async synchronize(platform: Platform): Promise<void> {
		for (const context of [...this.contexts.values()]) {
			const authorization = await this.authorize(context);
			if (authorization?.platform === platform) {
				await this.reply(context, { id: 0, event: 'values', value: this.services.storage.get(platform) });
			}
		}
	}

	private async request(context: Context, id: number, args: Record<string, unknown>, pageUrl: string): Promise<void> {
		const key = `${context.uniqueId}:${id}`;
		if (this.requests.has(key)) {
			throw new Error('Duplicate OJBetter request');
		}
		const controller = new AbortController();
		this.requests.set(key, controller);
		let timedOut = false;
		const requestedTimeout = typeof args.timeout === 'number' && args.timeout > 0 ? args.timeout : 120000;
		const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(requestedTimeout, 300000));
		try {
			if (typeof args.url !== 'string') {
				throw new Error('Invalid OJBetter request URL');
			}
			let url = new URL(args.url, pageUrl);
			let method = typeof args.method === 'string' ? args.method.toUpperCase() : 'GET';
			let data = typeof args.data === 'string' ? args.data : undefined;
			const headers = new Headers();
			if (args.headers && typeof args.headers === 'object') {
				for (const [name, value] of Object.entries(args.headers)) {
					if (typeof value === 'string' && !['cookie', 'host', 'content-length'].includes(name.toLowerCase())) {
						headers.set(name, value);
					}
				}
			}
			let response: Response | undefined;
			for (let redirects = 0; redirects <= 10; redirects++) {
				if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
					throw new Error('OJBetter requests require HTTP(S) URLs without embedded credentials');
				}
				if (!this.alive(context)) {
					return;
				}
				const local = method === 'GET' ? this.assets.localResource(url.href) : undefined;
				if (local !== undefined) {
					response = new Response(local, { headers: { 'Content-Type': 'application/json' } });
				} else {
					headers.delete('cookie');
					if (!args.anonymous && url.origin === new URL(pageUrl).origin) {
						const { cookies } = await this.cdp.send<{ cookies: { name: string; value: string }[] }>('Network.getCookies', { urls: [url.href] }, this.sessionId);
						if (cookies.length) {
							headers.set('cookie', cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '));
						}
					}
					response = await this.services.fetch(url, { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : data, redirect: 'manual', signal: controller.signal });
				}
				if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.has('location')) {
					break;
				}
				await response.body?.cancel();
				const next = new URL(response.headers.get('location')!, url);
				if (next.origin !== url.origin) {
					headers.delete('authorization');
					headers.delete('cookie');
				}
				if (response.status === 303 || (method === 'POST' && [301, 302].includes(response.status))) {
					method = 'GET';
					data = undefined;
					headers.delete('content-type');
				}
				url = next;
				response = undefined;
			}
			if (!response) {
				throw new Error('Too many OJBetter request redirects');
			}
			const metadata = {
				id, status: response.status, statusText: response.statusText, finalUrl: url.href,
				responseHeaders: [...response.headers].filter(([name]) => name.toLowerCase() !== 'set-cookie').map(([name, value]) => `${name}: ${value}`).join('\r\n')
			};
			if (args.responseType === 'stream' && response.body) {
				await this.reply(context, { ...metadata, event: 'start' });
				for await (const chunk of response.body) {
					await this.reply(context, { id, event: 'chunk', data: Buffer.from(chunk).toString('base64') });
				}
				await this.reply(context, { ...metadata, event: 'load' });
			} else {
				const body = Buffer.from(await response.arrayBuffer());
				await this.reply(context, { ...metadata, event: 'load', data: body.toString('base64') });
			}
		} catch (error) {
			await this.reply(context, { id, event: timedOut ? 'timeout' : controller.signal.aborted ? 'abort' : 'error', error: timedOut ? 'Request timed out' : controller.signal.aborted ? 'Request aborted' : error.message });
		} finally {
			clearTimeout(timer);
			this.requests.delete(key);
		}
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.onDidDispose();
		for (const context of this.contexts.values()) {
			this.revoke(context);
		}
		this.contexts.clear();
		const cleanup = async () => {
			if (this.scriptId) {
				await this.cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.scriptId }, this.sessionId);
			}
		};
		void cleanup().catch(() => { }).finally(() => this.cdp.dispose());
	}
}

export async function connect(tab: BrowserTab, assets: Assets, services: Services, enabled: Record<Platform, boolean>): Promise<Integration> {
	const cdp = new CDP(await tab.startCDPSession());
	const integration = new Integration(cdp, assets, services);
	try {
		await integration.start(enabled);
		return integration;
	} catch (error) {
		integration.dispose();
		throw error;
	}
}

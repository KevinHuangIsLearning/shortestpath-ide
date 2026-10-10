/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import type { BrowserCDPSession, Event } from 'vscode';
import { Assets } from '../assets';
import { CDP, CDPMessage } from '../cdp';
import { Integration, bindingName, worldName } from '../integration';

const assets = new Assets(join(__dirname, '../../resources'));

class Session implements BrowserCDPSession {
	private readonly messages = new Set<(message: unknown) => void>();
	private readonly closed = new Set<() => void>();
	readonly onDidReceiveMessage: Event<unknown> = listener => { this.messages.add(listener); return { dispose: () => { this.messages.delete(listener); } }; };
	readonly onDidClose: Event<void> = listener => { this.closed.add(listener); return { dispose: () => { this.closed.delete(listener); } }; };
	url = 'https://atcoder.jp/contests/abc001/tasks/abc001_1';
	readonly commands: { method: string; params: Record<string, unknown> }[] = [];
	readonly replies: { id: number; event?: string; error?: string; value?: unknown; responseHeaders?: string }[] = [];
	emit(message: CDPMessage): void {
		for (const listener of this.messages) { listener(message); }
	}
	sendMessage(raw: unknown): Promise<void> {
		const message = raw as { id: number; method: string; params: Record<string, unknown>; sessionId?: string };
		this.commands.push(message);
		let result: object = {};
		if (message.method === 'Target.getTargets') {
			result = { targetInfos: [{ targetId: 'target', type: 'page' }] };
		} else if (message.method === 'Target.attachToTarget') {
			result = { sessionId: 'page' };
		} else if (message.method === 'Page.getFrameTree') {
			result = { frameTree: { frame: { id: 'main', url: this.url } } };
		} else if (message.method === 'Runtime.enable') {
			this.context(1, 'main');
		} else if (message.method === 'Page.addScriptToEvaluateOnNewDocument') {
			result = { identifier: 'script' };
		} else if (message.method === 'Page.createIsolatedWorld') {
			result = { executionContextId: 1 };
		} else if (message.method === 'Runtime.evaluate' && (message.params.expression as string).startsWith('globalThis.__shortestpathOJBetterReceive?.(')) {
			this.replies.push(JSON.parse((message.params.expression as string).slice('globalThis.__shortestpathOJBetterReceive?.('.length, -1)));
		} else if (message.method === 'Network.getCookies') {
			result = { cookies: [{ name: 'session', value: 'private-cookie' }] };
		}
		this.emit({ id: message.id, sessionId: message.sessionId, result: result as Record<string, unknown> });
		return Promise.resolve();
	}
	context(id: number, frameId: string): void {
		this.emit({ method: 'Runtime.executionContextCreated', sessionId: 'page', params: { context: { id, uniqueId: `context-${id}`, name: worldName, auxData: { frameId } } } });
	}
	call(id: number, contextId: number, operation: string, args: object = {}, sessionId = 'page'): void {
		this.emit({ method: 'Runtime.bindingCalled', sessionId, params: { name: bindingName, executionContextId: contextId, payload: JSON.stringify({ id, operation, args }) } });
	}
	close(): Promise<void> { return Promise.resolve(); }
}

const settle = async () => { for (let i = 0; i < 8; i++) { await new Promise(resolve => setImmediate(resolve)); } };

test('bridge rejects page, subframe, unrelated session and navigated contexts', async () => {
	const session = new Session();
	const clipboard: string[] = [];
	const integration = new Integration(new CDP(session), assets, {
		storage: { get: () => ({}), write: async () => {} }, fetch,
		clipboard: async text => { clipboard.push(text); }, log: () => {}, changed: () => {}
	});
	await integration.start({ atcoder: true, codeforces: true });
	assert.deepEqual(session.commands.find(command => command.method === 'Runtime.addBinding')?.params, { name: bindingName, executionContextName: worldName });
	session.context(2, 'child');
	session.call(1, 99, 'clipboard', { text: 'page-forgery' });
	session.call(2, 2, 'clipboard', { text: 'child-forgery' });
	session.call(3, 1, 'clipboard', { text: 'session-forgery' }, 'unrelated');
	await settle();
	session.call(4, 1, 'clipboard', { text: 'authorized' });
	await settle();
	session.url = 'https://atcoder.jp.evil.test/';
	session.call(5, 1, 'clipboard', { text: 'url-forgery' });
	await settle();
	session.emit({ method: 'Runtime.executionContextsCleared', sessionId: 'page', params: {} });
	session.call(6, 1, 'clipboard', { text: 'stale-forgery' });
	await settle();
	assert.deepEqual(clipboard, ['authorized']);
	integration.dispose();
	await settle();
});

test('XHR strips credentials across redirects and rejects non-web protocols', async () => {
	const session = new Session();
	const network: { url: string; cookie: string | null; authorization: string | null }[] = [];
	const integration = new Integration(new CDP(session), assets, {
		storage: { get: () => ({}), write: async () => {} },
		fetch: async (url, options) => {
			const headers = new Headers(options?.headers);
			network.push({ url: String(url), cookie: headers.get('cookie'), authorization: headers.get('authorization') });
			return network.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://translator.example.test/response' } }) : new Response('{"ok":true}', { headers: { 'Set-Cookie': 'external=secret' } });
		},
		clipboard: async () => {}, log: () => {}, changed: () => {}
	});
	await integration.start({ atcoder: true, codeforces: true });
	session.call(1, 1, 'request', { url: 'https://atcoder.jp/api', headers: { Authorization: 'Bearer private' } });
	await settle();
	session.call(2, 1, 'request', { url: 'file:///etc/passwd' });
	await settle();
	assert.deepEqual(network, [
		{ url: 'https://atcoder.jp/api', cookie: 'session=private-cookie', authorization: 'Bearer private' },
		{ url: 'https://translator.example.test/response', cookie: null, authorization: null }
	]);
	assert.equal(session.replies.find(reply => reply.id === 1)?.responseHeaders?.toLowerCase().includes('set-cookie'), false);
	assert.equal(session.replies.find(reply => reply.id === 2)?.event, 'error');
	integration.dispose();
	await settle();
});

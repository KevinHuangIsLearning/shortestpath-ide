/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { BrowserCDPSession, Disposable } from 'vscode';

export interface CDPMessage {
	id?: number;
	sessionId?: string;
	method?: string;
	params?: Record<string, unknown>;
	result?: Record<string, unknown>;
	error?: { message: string };
}

/** Multiplex requests on a tab's private CDP channel without taking over its debugger. */
export class CDP implements Disposable {
	private nextId = 0;
	private closed = false;
	private readonly pending = new Map<number, { complete: (result: Record<string, unknown>) => void; fail: (error: Error) => void }>();
	private readonly listeners: Disposable[];
	onEvent: (message: CDPMessage) => void = () => { };
	onClose: () => void = () => { };

	constructor(private readonly session: BrowserCDPSession) {
		this.listeners = [
			session.onDidReceiveMessage(raw => {
				const message = raw as CDPMessage;
				if (message.id !== undefined) {
					const pending = this.pending.get(message.id);
					if (message.error) {
						pending?.fail(new Error(message.error.message));
					} else if (message.result?.exceptionDetails) {
						const details = message.result.exceptionDetails as { text: string; exception?: { description?: string } };
						pending?.fail(new Error(details.exception?.description ?? details.text));
					} else {
						pending?.complete(message.result ?? {});
					}
				} else {
					this.onEvent(message);
				}
			}),
			session.onDidClose(() => this.dispose())
		];
	}

	send<T>(method: string, params: object = {}, sessionId?: string): Promise<T> {
		if (this.closed) {
			return Promise.reject(new Error('OJBetter CDP session closed'));
		}
		return new Promise((resolve, reject) => {
			const id = ++this.nextId;
			const finish = (error?: Error, result?: Record<string, unknown>) => {
				clearTimeout(timer);
				this.pending.delete(id);
				if (error) {
					reject(error);
				} else {
					resolve(result as T);
				}
			};
			const timer = setTimeout(() => finish(new Error(`OJBetter CDP timeout: ${method}`)), 30000);
			this.pending.set(id, { complete: result => finish(undefined, result), fail: error => finish(error) });
			void Promise.resolve(this.session.sendMessage({ id, method, params, ...(sessionId ? { sessionId } : {}) })).catch(error => finish(error));
		});
	}

	dispose(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		for (const pending of [...this.pending.values()]) {
			pending.fail(new Error('OJBetter CDP session closed'));
		}
		for (const listener of this.listeners) {
			listener.dispose();
		}
		this.onClose();
		void Promise.resolve(this.session.close()).catch(() => { });
	}
}

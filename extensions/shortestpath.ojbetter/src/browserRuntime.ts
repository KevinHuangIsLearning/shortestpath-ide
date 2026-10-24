/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

interface Reply {
	id: number;
	error?: string;
	value?: unknown;
	event?: string;
	data?: string;
	status?: number;
	statusText?: string;
	responseHeaders?: string;
	finalUrl?: string;
}

interface RequestOptions {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	data?: string;
	timeout?: number;
	responseType?: string;
	anonymous?: boolean;
	onload?: (response: object) => void;
	onloadstart?: (response: object) => void;
	onloadend?: (response: object) => void;
	onprogress?: (response: object) => void;
	onreadystatechange?: (response: object) => void;
	onerror?: (error: object) => void;
	ontimeout?: (error: object) => void;
	onabort?: (error: object) => void;
}

/** Serialized into the isolated world; editing stays in the IDE. */
export function addIDEProblemEntry(importProblem: () => Promise<{ count: number; error?: string; cancelled?: boolean }>, language: string): void {
	if (document.getElementById('shortestpath-ojbetter-ide')) { return; }
	const anchor = document.querySelector('#task-statement, .ttypography');
	if (!anchor) { return; }
	const translations: Record<string, readonly string[]> = {
		en: ['Please write code in the IDE.', 'Import Problem', 'Importing…', 'Problem imported into the IDE.', 'Import failed. Please try again.', 'Paste code here'],
		// allow-any-unicode-next-line
		zh: ['请到 IDE 里写代码', '导入题目', '正在导入…', '题目已导入 IDE。', '导入失败，请重试。', '在此粘贴代码'],
		// allow-any-unicode-next-line
		'zh-tw': ['請到 IDE 裡寫程式', '匯入題目', '正在匯入…', '題目已匯入 IDE。', '匯入失敗，請重試。', '在此貼上程式碼'],
		// allow-any-unicode-next-line
		ja: ['コードは IDE で書いてください。', '問題をインポート', 'インポート中…', '問題を IDE にインポートしました。', 'インポートに失敗しました。もう一度お試しください。', 'ここにコードを貼り付け'],
		// allow-any-unicode-next-line
		ko: ['IDE에서 코드를 작성하세요.', '문제 가져오기', '가져오는 중…', '문제를 IDE로 가져왔습니다.', '가져오지 못했습니다. 다시 시도하세요.', '여기에 코드를 붙여넣으세요']
	};
	const normalized = language.toLowerCase();
	const text = translations[normalized] ?? translations[normalized.split('-')[0]] ?? translations.en;
	const entry = document.createElement('section');
	entry.id = 'shortestpath-ojbetter-ide';
	entry.dataset.pasteLabel = text[5];
	entry.setAttribute('data-i18n-ignore', '');
	entry.style.cssText = 'margin:16px 0;padding:16px;border:1px solid var(--border-color,#8886);border-radius:6px;';
	const message = entry.appendChild(document.createElement('p'));
	message.textContent = text[0];
	const button = entry.appendChild(document.createElement('button'));
	button.id = 'shortestpath-ojbetter-import';
	button.type = 'button';
	button.className = 'ojb_btn primary';
	button.textContent = text[1];
	const status = entry.appendChild(document.createElement('p'));
	status.setAttribute('role', 'status');
	status.hidden = true;
	button.addEventListener('click', async () => {
		if (button.disabled) { return; }
		button.disabled = true;
		button.textContent = text[2];
		status.hidden = true;
		try {
			const result = await importProblem();
			if (result.error) { throw new Error(result.error); }
			if (result.count > 0) { status.textContent = text[3]; status.hidden = false; }
		} catch (error) {
			status.textContent = error instanceof Error ? error.message : text[4];
			status.hidden = false;
		} finally {
			button.disabled = false;
			button.textContent = text[1];
		}
	});
	anchor.after(entry);
}

/** Serialized into a named isolated world. No bridge or GM API is exposed to page scripts. */
export async function browserBootstrap(bindingName: string) {
	const isolated = globalThis as typeof globalThis & {
		[key: string]: unknown;
		__shortestpathOJBetterReceive?: (reply: Reply) => void;
	};
	const binding = isolated[bindingName] as (value: string) => void;
	let nextId = 0;
	const pending = new Map<number, (reply: Reply) => void>();
	const requests = new Map<number, (reply: Reply) => void>();
	const values: Record<string, unknown> = Object.create(null);
	const dirty = new Map<string, { value: unknown; remove: boolean }>();
	const writes = new Set<Promise<unknown>>();
	const reportError = (error: Error) => console.error('OJBetter bridge:', error.message);
	const call = <T>(operation: string, args: object = {}): Promise<T> => new Promise((resolve, reject) => {
		const id = ++nextId;
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new Error(`OJBetter bridge timeout: ${operation}`));
		}, 30000);
		pending.set(id, reply => {
			clearTimeout(timer);
			pending.delete(id);
			if (reply.error) {
				reject(new Error(reply.error));
			} else {
				resolve(reply.value as T);
			}
		});
		binding(JSON.stringify({ id, operation, args }));
	});
	isolated.__shortestpathOJBetterReceive = reply => {
		if (reply.event === 'values') {
			for (const key of Object.keys(values)) {
				delete values[key];
			}
			Object.assign(values, reply.value);
			for (const [key, change] of dirty) {
				if (change.remove) {
					delete values[key];
				} else {
					values[key] = change.value;
				}
			}
		} else if (reply.event) {
			requests.get(reply.id)?.(reply);
		} else {
			pending.get(reply.id)?.(reply);
		}
	};
	Object.assign(values, await call<Record<string, unknown>>('hydrate'));
	const bytes = (data = '') => Uint8Array.from(atob(data), char => char.charCodeAt(0));
	const write = (operation: string, key: string, value: unknown, remove: boolean) => {
		const change = { value, remove };
		dirty.set(key, change);
		const promise = call(operation, { key, value });
		writes.add(promise);
		void promise.then(() => {
			if (dirty.get(key) === change) { dirty.delete(key); }
		}, reportError).finally(() => { writes.delete(promise); });
	};

	return {
		getSiteData: () => call('siteData'),
		importProblem: () => call<{ count: number; error?: string; cancelled?: boolean }>('importProblem'),
		flushValues: async () => {
			while (writes.size) { await Promise.all([...writes]); }
		},
		GM_getValue: (key: string, fallback?: unknown) => Object.hasOwn(values, key) ? values[key] : fallback,
		GM_setValue: (key: string, value: unknown) => {
			values[key] = value;
			write('set', key, value, false);
		},
		GM_deleteValue: (key: string) => {
			delete values[key];
			write('delete', key, undefined, true);
		},
		GM_listValues: () => Object.keys(values),
		GM_addStyle: (css: string) => {
			const style = document.createElement('style');
			style.textContent = css;
			(document.head ?? document.documentElement).append(style);
			return style;
		},
		GM_setClipboard: (text: string) => { void call('clipboard', { text }).catch(reportError); },
		GM_xmlhttpRequest: (options: RequestOptions) => {
			const id = ++nextId;
			let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
			let response: object | undefined;
			let complete = false;
			requests.set(id, reply => {
				if (complete) {
					return;
				}
				if (reply.event === 'start') {
					const stream = new ReadableStream<Uint8Array>({ start: value => { controller = value; }, cancel: () => { binding(JSON.stringify({ id, operation: 'abort', args: {} })); } });
					response = { ...reply, readyState: 2, response: stream, context: options };
					options.onreadystatechange?.(response);
					options.onloadstart?.(response);
				} else if (reply.event === 'chunk') {
					controller?.enqueue(bytes(reply.data));
					options.onprogress?.({ ...reply, readyState: 3 });
				} else {
					complete = true;
					requests.delete(id);
					if (reply.error) {
						controller?.error(new Error(reply.error));
						const callback = reply.event === 'abort' ? options.onabort : reply.event === 'timeout' ? options.ontimeout : options.onerror;
						callback?.({ ...reply, readyState: 4 });
					} else {
						controller?.close();
						if (!response) {
							const raw = bytes(reply.data);
							const responseText = new TextDecoder().decode(raw);
							let value: unknown = responseText;
							if (options.responseType === 'json') {
								try { value = JSON.parse(responseText); } catch { value = null; }
							} else if (options.responseType === 'arraybuffer') {
								value = raw.buffer;
							} else if (options.responseType === 'blob') {
								value = new Blob([raw]);
							} else if (options.responseType === 'document') {
								value = new DOMParser().parseFromString(responseText, 'text/html');
							}
							response = { ...reply, response: value, responseText, readyState: 4, context: options };
						}
						response = { ...response, readyState: 4 };
						options.onreadystatechange?.(response);
						options.onload?.(response);
					}
					options.onloadend?.(response ?? reply);
				}
			});
			const { url, method, headers, data, timeout, responseType, anonymous } = options;
			binding(JSON.stringify({ id, operation: 'request', args: { url, method, headers, data, timeout, responseType, anonymous } }));
			return { abort: () => { if (!complete) { binding(JSON.stringify({ id, operation: 'abort', args: {} })); } } };
		}
	};
}

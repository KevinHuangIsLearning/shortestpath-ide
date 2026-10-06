/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import type { BrowserEditorInput } from '../../browserView/common/browserEditorInput.js';

export type ShortestPathMode = 'browse' | 'solve' | 'snippets' | 'settings';
export const shortestPathHome = 'https://shortestpath.cn/topics';
export const IShortestPathModeService = createDecorator<IShortestPathModeService>('shortestPathModeService');

export interface IShortestPathModeService {
	readonly _serviceBrand: undefined;
	readonly mode: ShortestPathMode;
	readonly activeBrowser: BrowserEditorInput | undefined;
	readonly onDidChangeActiveBrowser: Event<void>;
	switchMode(mode: ShortestPathMode): Promise<void>;
	openBrowser(url?: string, newTab?: boolean, preserveFocus?: boolean): Promise<BrowserEditorInput>;
	showBrowser(input: BrowserEditorInput, preserveFocus?: boolean): Promise<void>;
	notifyResult(): void;
}

export interface ShortestPathBrowserState {
	readonly urls: readonly string[];
	readonly active: number;
	readonly ids?: readonly (string | undefined)[];
}

/** Never persist connection tokens or login callbacks in the ordinary tab session. */
export function isRestorableBrowserUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return ['https:', 'http:', 'file:'].includes(parsed.protocol)
			&& !parsed.username && !parsed.password
			&& !['/ide/connect', '/login', '/logout'].includes(parsed.pathname)
			&& !parsed.searchParams.has('token');
	} catch {
		return false;
	}
}

export function parseBrowserState(raw: string | undefined): ShortestPathBrowserState {
	try {
		const state = JSON.parse(raw ?? '{}') as Partial<ShortestPathBrowserState>;
		const source = Array.isArray(state.urls) ? state.urls : [];
		const indices = source.map((url, index) => typeof url === 'string' && isRestorableBrowserUrl(url) ? index : -1).filter(index => index >= 0).slice(0, 30);
		const urls = indices.map(index => source[index] as string);
		const ids = Array.isArray(state.ids) ? indices.map(index => typeof state.ids![index] === 'string' ? state.ids![index] : undefined) : undefined;
		return { urls, active: Math.max(0, indices.indexOf(typeof state.active === 'number' ? state.active : 0)), ...(ids ? { ids } : {}) };
	} catch {
		return { urls: [], active: 0 };
	}
}

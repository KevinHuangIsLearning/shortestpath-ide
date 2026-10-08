/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import type { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import type { PreferredGroup } from '../../../services/editor/common/editorService.js';
import type { BrowserEditorInput } from '../../browserView/common/browserEditorInput.js';

export type ShortestPathPageMode = 'snippets' | 'draw' | 'settings' | 'dashboard';
export type ShortestPathMode = 'browse' | 'solve' | ShortestPathPageMode;
export const shortestPathPageCommands: Record<ShortestPathPageMode, string> = {
	dashboard: 'judger.openDashboard',
	snippets: 'shortestpath.configureCppSnippets',
	draw: 'shortestpath.draw.open',
	settings: 'shortestpath.openSettings',
};

export function isShortestPathPageMode(mode: string | undefined): mode is ShortestPathPageMode {
	return mode === 'dashboard' || mode === 'snippets' || mode === 'draw' || mode === 'settings';
}

/** Only adopt the dedicated mode page; companion sketchpads stay in editor groups. */
export function getShortestPathPageMode(extensionId: string | undefined, viewType: string | undefined): ShortestPathPageMode | undefined {
	if (extensionId?.toLowerCase() === 'shortestpath.judger' && viewType === 'judger.dashboard') { return 'dashboard'; }
	if (extensionId?.toLowerCase() === 'shortestpath.shortestpath-draw' && viewType === 'shortestpath.draw') { return 'draw'; }
	if (extensionId?.toLowerCase() !== 'shortestpath.shortestpath-setup') { return undefined; }
	return viewType === 'shortestpath.cppSnippets' ? 'snippets' : viewType === 'shortestpath.settings' ? 'settings' : undefined;
}
export const shortestPathHome = 'https://shortestpath.cn/topics';
export const IShortestPathModeService = createDecorator<IShortestPathModeService>('shortestPathModeService');

export interface IShortestPathModeService {
	readonly _serviceBrand: undefined;
	readonly mode: ShortestPathMode;
	readonly activeBrowser: BrowserEditorInput | undefined;
	readonly onDidChangeActiveBrowser: Event<void>;
	switchMode(mode: ShortestPathMode): Promise<void>;
	openBrowser(url?: string, newTab?: boolean, preserveFocus?: boolean, options?: IEditorOptions & { group?: PreferredGroup }): Promise<BrowserEditorInput>;
	/** Whether a tab belongs to the standalone browsing surface. */
	ownsBrowserTab(input: BrowserEditorInput): boolean;
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

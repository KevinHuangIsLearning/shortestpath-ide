/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface DraftSnapshot {
	readonly scene: string;
	readonly library: string;
}

export type ClientMessage =
	| { readonly type: 'ready' }
	| { readonly type: 'save'; readonly snapshot: DraftSnapshot; readonly revision: number }
	| { readonly type: 'openBeside'; readonly snapshot: DraftSnapshot }
	| { readonly type: 'openMode'; readonly snapshot: DraftSnapshot }
	| { readonly type: 'clear'; readonly snapshot: DraftSnapshot }
	| { readonly type: 'import'; readonly snapshot: DraftSnapshot }
	| { readonly type: 'export'; readonly data: string; readonly format: 'excalidraw' | 'svg' | 'png' };

export type HostMessage =
	| { readonly type: 'init' | 'replace'; readonly snapshot?: DraftSnapshot; readonly error?: string }
	| { readonly type: 'saved'; readonly revision: number; readonly error?: string }
	| { readonly type: 'theme'; readonly theme: 'light' | 'dark' };

/** Validate data at the Webview and file boundaries without rewriting user labels. */
export function isDraftSnapshot(value: unknown): value is DraftSnapshot {
	if (!value || typeof value !== 'object') { return false; }
	const snapshot = value as Partial<DraftSnapshot>;
	if (typeof snapshot.scene !== 'string' || typeof snapshot.library !== 'string') { return false; }
	try {
		const scene = JSON.parse(snapshot.scene);
		const library = JSON.parse(snapshot.library);
		return scene?.type === 'excalidraw' && Array.isArray(scene.elements)
			&& library?.type === 'excalidrawlib' && Array.isArray(library.libraryItems);
	} catch { return false; }
}

export function isClientMessage(value: unknown): value is ClientMessage {
	if (!value || typeof value !== 'object') { return false; }
	const message = value as Partial<ClientMessage>;
	if (message.type === 'ready') { return true; }
	if (message.type === 'export') {
		return typeof message.data === 'string' && ['excalidraw', 'svg', 'png'].includes(message.format ?? '');
	}
	if (!('snapshot' in message) || !isDraftSnapshot(message.snapshot)) { return false; }
	if (message.type === 'save') { return Number.isSafeInteger(message.revision) && message.revision! >= 0; }
	return message.type === 'openBeside' || message.type === 'openMode' || message.type === 'clear' || message.type === 'import';
}

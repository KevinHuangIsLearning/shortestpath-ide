/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface DraftSnapshot {
	readonly scene: string;
	readonly library: string;
}

export interface DrawingEntry {
	readonly id: string;
	readonly parent: string;
	readonly name: string;
	readonly kind: 'file' | 'folder';
}
export interface DrawingFileState {
	readonly active: string;
	readonly entries: readonly DrawingEntry[];
}
export type DrawingExportFormat = 'excalidraw' | 'svg' | 'png';
export type DocumentAction = 'clear' | 'import' | 'export' | 'openBeside' | 'openMode';

export type FileAction = 'newFile' | 'newFolder' | 'openFile' | 'rename' | 'move' | 'delete';

export type ClientMessage = (
	| { readonly type: 'ready' }
	| { readonly type: 'canvasReady' }
	| { readonly type: 'files' }
	| { readonly type: 'fileAction'; readonly action: FileAction; readonly id: string; readonly snapshot: DraftSnapshot }
	| { readonly type: 'save'; readonly snapshot: DraftSnapshot; readonly revision: number }
	| { readonly type: 'openBeside'; readonly snapshot: DraftSnapshot }
	| { readonly type: 'openMode'; readonly snapshot: DraftSnapshot }
	| { readonly type: 'clear'; readonly snapshot: DraftSnapshot }
	| { readonly type: 'import'; readonly snapshot: DraftSnapshot }
	| { readonly type: 'export'; readonly data: string; readonly format: 'excalidraw' | 'svg' | 'png' }) & { readonly fileId?: string };

export type HostMessage =
	| { readonly type: 'init' | 'replace'; readonly snapshot?: DraftSnapshot; readonly error?: string; readonly fileId?: string }
	| { readonly type: 'saved'; readonly revision: number; readonly error?: string }
	| { readonly type: 'files'; readonly state: DrawingFileState }
	| { readonly type: 'fileAction'; readonly action: FileAction; readonly id: string }
	| { readonly type: 'documentAction'; readonly action: DocumentAction; readonly format?: DrawingExportFormat }
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
	if (message.fileId !== undefined && typeof message.fileId !== 'string') { return false; }
	if (message.type === 'ready' || message.type === 'canvasReady' || message.type === 'files') { return true; }
	if (message.type === 'export') {
		return typeof message.data === 'string' && ['excalidraw', 'svg', 'png'].includes(message.format ?? '');
	}
	if (!('snapshot' in message) || !isDraftSnapshot(message.snapshot)) { return false; }
	if (message.type === 'fileAction') { return typeof message.id === 'string' && ['newFile', 'newFolder', 'openFile', 'rename', 'move', 'delete'].includes(message.action ?? ''); }
	if (message.type === 'save') { return Number.isSafeInteger(message.revision) && message.revision! >= 0; }
	return message.type === 'openBeside' || message.type === 'openMode' || message.type === 'clear' || message.type === 'import';
}

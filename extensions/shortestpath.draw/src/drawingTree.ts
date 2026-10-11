/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { DrawingEntry, DrawingFileState } from './protocol';

/** Use the native Explorer tree for selection, keyboard navigation and folder expansion. */
export class DrawingTree implements vscode.TreeDataProvider<DrawingEntry>, vscode.TreeDragAndDropController<DrawingEntry>, vscode.Disposable {
	private readonly dragSource = randomUUID();
	private creating: DrawingEntry | undefined;
	private readonly change = new vscode.EventEmitter<DrawingEntry | undefined>();
	readonly onDidChangeTreeData = this.change.event;
	readonly dragMimeTypes = ['application/vnd.code.tree.shortestpath.draw.files'];
	readonly dropMimeTypes = this.dragMimeTypes;
	constructor(private readonly read: () => Promise<DrawingFileState>, private readonly move?: (id: string, parent: string) => Promise<void>) { }

	handleDrag(source: readonly DrawingEntry[], transfer: vscode.DataTransfer): void {
		const entry = source[0];
		if (source.length === 1 && entry && entry.id !== this.creating?.id) {
			transfer.set(this.dragMimeTypes[0], new vscode.DataTransferItem({ source: this.dragSource, id: entry.id }));
		}
	}
	async handleDrop(target: DrawingEntry | undefined, transfer: vscode.DataTransfer): Promise<void> {
		const data = transfer.get(this.dragMimeTypes[0])?.value as { source?: unknown; id?: unknown } | undefined;
		if (!data || typeof data !== 'object' || data.source !== this.dragSource || typeof data.id !== 'string' || !this.move) { return; }
		const id = data.id;
		const state = await this.read();
		const entry = state.entries.find(item => item.id === id);
		const destination = target ? state.entries.find(item => item.id === target.id) : undefined;
		if (!entry || (target && !destination)) { return; }
		const parent = destination?.kind === 'folder' ? destination.id : destination?.parent ?? '';
		if (entry.parent === parent) { return; }
		for (let ancestor = parent; ancestor; ancestor = state.entries.find(item => item.id === ancestor)?.parent ?? '') {
			if (ancestor === id) { return; }
		}
		await this.move(id, parent);
	}

	beginCreate(entry: DrawingEntry): void { this.creating = entry; this.refresh(); }
	endCreate(): void { this.creating = undefined; this.refresh(); }
	refresh(): void { this.change.fire(undefined); }
	async getChildren(element?: DrawingEntry): Promise<DrawingEntry[]> {
		const state = await this.read();
		const entries = this.creating ? [...state.entries, this.creating] : state.entries;
		return entries.filter(entry => entry.parent === (element?.id ?? '')).sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1);
	}
	async getParent(element: DrawingEntry): Promise<DrawingEntry | undefined> {
		return (await this.read()).entries.find(entry => entry.id === element.parent);
	}
	getTreeItem(element: DrawingEntry): vscode.TreeItem {
		const item = new vscode.TreeItem(element.name || ' ', element.id !== this.creating?.id && element.kind === 'folder' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
		item.id = element.id;
		item.contextValue = element.id === this.creating?.id ? 'creating' : element.kind;
		item.iconPath = new vscode.ThemeIcon(element.kind === 'folder' ? 'folder' : 'file');
		if (element.kind === 'file' && element.id !== this.creating?.id) { item.command = { command: 'shortestpath.draw.openFile', title: element.name, arguments: [element] }; }
		return item;
	}
	dispose(): void { this.change.dispose(); }
}

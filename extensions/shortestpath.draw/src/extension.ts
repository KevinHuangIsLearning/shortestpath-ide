/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { DrawingTree } from './drawingTree';
import { DrawingFiles } from './drawingFiles';
import { DocumentAction, DraftSnapshot, DrawingEntry, FileAction, HostMessage, isClientMessage, isDraftSnapshot } from './protocol';
import { getDrawStrings } from './strings';
import { getDrawHtml } from './webviewHtml';

const pageType = 'shortestpath.draw';
const companionType = 'shortestpath.draw.companion';
let controller: SketchpadController | undefined;

class SketchpadController implements vscode.Disposable {
	private readonly panels = new Map<vscode.WebviewPanel, { initialized: boolean; canvasReady: boolean; actions: HostMessage[]; fileId?: string; disposables: vscode.Disposable[] }>();
	private readonly storage: DrawingFiles;
	private readonly strings = getDrawStrings(vscode.env.language);
	private loaded = false;
	private loading: Promise<void> | undefined;
	private readonly tree: DrawingTree;
	private readonly treeView: vscode.TreeView<DrawingEntry>;
	private pending: Promise<void> = Promise.resolve();

	constructor(private readonly context: vscode.ExtensionContext) {
		this.storage = new DrawingFiles(vscode.Uri.joinPath(context.storageUri ?? context.globalStorageUri, 'sketchpad').fsPath, this.strings.defaultName);
		this.tree = new DrawingTree(async () => { await this.ensureLoaded(); return this.storage.state(); }, async (id, parent) => {
			const run = this.pending.then(async () => {
				await this.storage.move(id, parent);
				this.tree.refresh();
				const moved = this.storage.state().entries.find(entry => entry.id === id);
				if (moved) { await this.treeView.reveal(moved, { select: true, focus: true }); }
			});
			this.pending = run.catch(() => { void vscode.window.showErrorMessage(this.strings.fileActionFailed); });
			await this.pending;
		});
		this.treeView = vscode.window.createTreeView('shortestpath.draw.files', { treeDataProvider: this.tree, dragAndDropController: this.tree });
		context.subscriptions.push(this.tree, this.treeView);
		for (const action of ['newFile', 'newFolder', 'openFile', 'rename', 'move', 'delete'] as const) {
			context.subscriptions.push(vscode.commands.registerCommand(`shortestpath.draw.${action}`, (entry?: DrawingEntry) => this.manageFiles(action, entry)));
		}
		for (const action of ['clear', 'import', 'export', 'openBeside', 'openMode'] as const) {
			context.subscriptions.push(vscode.commands.registerCommand(`shortestpath.draw.${action}`, (entry?: DrawingEntry) => this.manageDocument(action, entry)));
		}
	}

	async open(companion = false, fileId?: string, preserveFocus = false): Promise<void> {
		try { await this.ensureLoaded(); } catch { /* The panel reports the recoverable load error. */ }
		const id = fileId ?? (this.loaded ? this.storage.state().active : undefined);
		if (this.loaded && id) { this.storage.snapshot(id); }
		const viewType = companion ? companionType : pageType;
		const column = companion ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
		const existing = [...this.panels].find(([panel, entry]) => panel.viewType === viewType && entry.fileId === id)?.[0];
		if (existing) { existing.reveal(column, preserveFocus); return; }
		const name = this.loaded ? this.storage.state().entries.find(entry => entry.id === id)!.name : this.strings.title;
		const panel = vscode.window.createWebviewPanel(viewType, name, { viewColumn: column, preserveFocus }, { enableScripts: true, retainContextWhenHidden: true });
		this.attach(panel, companion, id);
	}

	attach(panel: vscode.WebviewPanel, companion: boolean, fileId?: string): void {
		const entry = { initialized: false, canvasReady: false, actions: [] as HostMessage[], fileId, disposables: [] as vscode.Disposable[] };
		this.panels.set(panel, entry);
		panel.title = (this.loaded ? this.storage.state().entries.find(item => item.id === fileId)?.name : undefined) ?? this.strings.title;
		const resources = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
		panel.webview.options = { enableScripts: true, localResourceRoots: [resources] };
		entry.disposables.push(panel.onDidDispose(() => {
			this.panels.delete(panel);
			for (const disposable of entry.disposables) { disposable.dispose(); }
		}));
		entry.disposables.push(panel.onDidChangeViewState(event => {
			if (!event.webviewPanel.active || !entry.fileId) { return; }
			const run = this.pending.then(async () => {
				if (this.panels.has(panel) && this.storage.state().entries.some(item => item.id === entry.fileId)) { await this.storage.open(entry.fileId!); }
			});
			this.pending = run.catch(() => { void vscode.window.showErrorMessage(this.strings.fileActionFailed); });
		}));
		entry.disposables.push(vscode.window.onDidChangeActiveColorTheme(() => {
			void this.post(panel, { type: 'theme', theme: this.theme() });
		}));
		entry.disposables.push(panel.webview.onDidReceiveMessage((value: unknown) => {
			if (!isClientMessage(value)) { return; }
			const run = this.pending.then(async () => {
				// Persist an edit already received from an initialized panel even if
				// it closes while a previous write or native file dialog is pending.
				if (!this.panels.has(panel) && value.type !== 'save') { return; }
				if (value.type === 'ready') {
					try {
						await this.ensureLoaded();
						entry.fileId ??= this.storage.state().active;
						const snapshot = this.storage.snapshot(entry.fileId);
						entry.initialized = true;
						panel.title = this.storage.state().entries.find(item => item.id === entry.fileId)!.name;
						await this.post(panel, { type: 'init', snapshot, fileId: entry.fileId });
					} catch { await this.post(panel, { type: 'init', error: this.strings.loadFailed }); }
					return;
				}
				if (!entry.initialized) { return; }
				if (value.type === 'canvasReady') {
					if (value.fileId !== entry.fileId) { return; }
					entry.canvasReady = true;
					for (const action of entry.actions.splice(0)) { await this.post(panel, action); }
					return;
				}
				if (value.type === 'files') { await this.post(panel, { type: 'files', state: this.storage.state() }); return; }
				if (value.fileId !== undefined && value.fileId !== entry.fileId) { return; }
				if (!this.storage.state().entries.some(item => item.id === entry.fileId)) { return; }
				if (value.type === 'fileAction') {
					await this.save(value.snapshot, panel, entry.fileId);
					try { await this.fileAction(value.action, value.id); }
					catch { void vscode.window.showErrorMessage(this.strings.fileActionFailed); }
					return;
				}
				if (value.type === 'save') {
					try {
						await this.save(value.snapshot, panel, entry.fileId);
						await this.post(panel, { type: 'saved', revision: value.revision });
					} catch { await this.post(panel, { type: 'saved', revision: value.revision, error: this.strings.saveFailed }); }
					return;
				}
				if (value.type === 'export') { await this.exportDrawing(value.data, value.format); return; }
				await this.save(value.snapshot, panel, entry.fileId);
				if (value.type === 'openBeside') {
					await vscode.commands.executeCommand('shortestpath.mode.solve');
					await this.open(true, entry.fileId);
				} else if (value.type === 'openMode') {
					await this.storage.open(entry.fileId!);
					await this.open(false, entry.fileId);
					await vscode.commands.executeCommand('shortestpath.mode.draw');
				} else if (value.type === 'clear') {
					const confirmed = await vscode.window.showWarningMessage(this.strings.clearPrompt, { modal: true }, this.strings.clearAction);
					if (confirmed === this.strings.clearAction) {
						await this.save({ scene: '{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}', library: value.snapshot.library }, undefined, entry.fileId);
					}
				} else if (value.type === 'import') {
					await this.importDrawing(value.snapshot.library, entry.fileId!);
				}
			});
			this.pending = run.catch(error => {
				void vscode.window.showErrorMessage(this.strings.actionFailed.replace('{0}', error instanceof Error ? error.message : String(error)));
			});
			return this.pending;
		}));
		panel.webview.html = getDrawHtml({ resourceRoot: panel.webview.asWebviewUri(resources).toString(), cspSource: panel.webview.cspSource, language: vscode.env.language, theme: this.theme(), companion, title: this.strings.title, nonce: randomUUID() });
	}

	private async ensureLoaded(): Promise<void> {
		if (this.loaded) { return; }
		this.loading ??= this.storage.load().then(() => { this.loaded = true; });
		try { await this.loading; } finally { this.loading = undefined; }
	}

	private async manageDocument(action: DocumentAction, target?: DrawingEntry): Promise<void> {
		try {
			await this.ensureLoaded();
			if (target?.kind === 'folder') { return; }
			const active = [...this.panels].find(([panel]) => panel.active);
			const fileId = target?.kind === 'file' ? target.id : active?.[1].fileId;
			if (!fileId || !this.storage.state().entries.some(entry => entry.id === fileId && entry.kind === 'file')) { return; }
			const message: Extract<HostMessage, { type: 'documentAction' }> = { type: 'documentAction', action };
			let format: 'excalidraw' | 'svg' | 'png' | undefined;
			if (action === 'export') {
				format = (await vscode.window.showQuickPick([
					{ label: this.strings.drawing, id: 'excalidraw' as const },
					{ label: this.strings.image, id: 'png' as const },
					{ label: this.strings.vector, id: 'svg' as const },
				], { title: this.strings.exportTitle }))?.id;
				if (!format) { return; }
			}
			let selected = [...this.panels].find(([panel, entry]) => entry.fileId === fileId && panel.active)
				?? [...this.panels].find(([, entry]) => entry.fileId === fileId);
			if (!selected) {
				await this.open(false, fileId, true);
				selected = [...this.panels].find(([, entry]) => entry.fileId === fileId);
			}
			if (!selected) { return; }
			const [panel, entry] = selected;
			const request = { ...message, format };
			if (entry.canvasReady) { await this.post(panel, request); }
			else { entry.actions.push(request); panel.reveal(undefined, true); }
		} catch (error) {
			void vscode.window.showErrorMessage(this.strings.actionFailed.replace('{0}', error instanceof Error ? error.message : String(error)));
		}
	}

	private async manageFiles(action: FileAction, target?: DrawingEntry): Promise<void> {
		const entry = target ?? this.treeView.selection[0];
		const id = action === 'newFile' || action === 'newFolder' ? entry?.kind === 'folder' ? entry.id : entry?.parent ?? '' : entry?.id;
		if (id === undefined) { return; }
		const panel = [...this.panels].find(([panel, entry]) => panel.active && entry.initialized)?.[0] ?? [...this.panels].find(([, entry]) => entry.initialized)?.[0];
		if (panel) {
			// Ask the live canvas to flush its latest edit before any native tree action.
			const state = this.panels.get(panel)!;
			const request: HostMessage = { type: 'fileAction', action, id };
			if (state.canvasReady) { await this.post(panel, request); }
			else { state.actions.push(request); }
			return;
		}
		const run = this.pending.then(async () => {
			await this.ensureLoaded();
			await this.fileAction(action, id);

		});
		this.pending = run.catch(() => { void vscode.window.showErrorMessage(this.strings.fileActionFailed); });
		await this.pending;
	}

	private theme(): 'light' | 'dark' {
		return vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light || vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrastLight ? 'light' : 'dark';
	}

	private async post(panel: vscode.WebviewPanel, message: HostMessage): Promise<void> {
		const entry = this.panels.get(panel);
		if (entry) {
			if (message.type === 'init' || message.type === 'replace') { entry.canvasReady = false; }
			await panel.webview.postMessage(message);
		}
	}

	private async save(snapshot: DraftSnapshot, source?: vscode.WebviewPanel, fileId = source ? this.panels.get(source)?.fileId : this.storage.state().active): Promise<void> {
		if (!fileId || !this.storage.state().entries.some(entry => entry.id === fileId)) { return; }
		const previous = this.storage.snapshot(fileId);
		if (previous?.scene === snapshot.scene && previous?.library === snapshot.library) { return; }
		await this.storage.save(snapshot, fileId);
		await Promise.all([...this.panels].filter(([panel, entry]) => panel !== source && entry.initialized && entry.fileId === fileId).map(([panel]) => this.post(panel, { type: 'replace', snapshot, fileId })));
	}

	private async fileAction(action: FileAction, id: string): Promise<void> {
		const state = this.storage.state();
		const entry = state.entries.find(entry => entry.id === id);
		let switched = false;
		if (action === 'newFile' || action === 'newFolder' || action === 'rename') {
			const parent = action === 'rename' ? entry?.parent : id;
			if (parent === undefined) { return; }
			const editing: DrawingEntry | undefined = action === 'rename' ? entry : { id: randomUUID(), parent, name: '', kind: action === 'newFolder' ? 'folder' : 'file' };
			if (!editing) { return; }
			if (action !== 'rename') { this.tree.beginCreate(editing); }
			try {
				await this.treeView.reveal(editing, { focus: true, select: true });
				const invalidNames = state.entries.filter(item => item.parent === parent && item.id !== editing.id).map(item => item.name.toLowerCase());
				const name = await vscode.commands.executeCommand<string | undefined>('_workbench.treeView.editItem.shortestpath.draw.files', editing.id, editing.name, editing.kind === 'folder', invalidNames, this.strings.invalidName);
				if (name === undefined) { return; }
				if (action === 'rename') { await this.storage.rename(id, name); }
				else { await this.storage.create(id, name, editing.kind); switched = action === 'newFile'; }
			} finally { if (action !== 'rename') { this.tree.endCreate(); } }

		} else if (action === 'openFile') { await this.storage.open(id); switched = true; }
		else if (action === 'delete') {
			if (await vscode.window.showWarningMessage(this.strings.deletePrompt, { modal: true }, this.strings.delete) !== this.strings.delete) { return; }
			switched = await this.storage.remove(id);
		} else if (action === 'move') {
			if (!entry) { return; }
			const folderPath = (folder: string): string => {
				const names: string[] = [];
				while (folder) { const ancestor = state.entries.find(item => item.id === folder)!; names.unshift(ancestor.name); folder = ancestor.parent; }
				return names.join(' / ');
			};
			const destinations = [{ label: this.strings.root, id: '' }, ...state.entries.filter(item => item.kind === 'folder').filter(item => {
				for (let parent = item.id; parent; parent = state.entries.find(item => item.id === parent)!.parent) { if (parent === id) { return false; } }
				return true;
			}).map(item => ({ label: folderPath(item.id), id: item.id }))];
			const destination = await vscode.window.showQuickPick(destinations, { placeHolder: this.strings.folderPrompt });
			if (!destination) { return; }
			await this.storage.move(id, destination.id);
		}
		const current = this.storage.state();
		for (const [panel, entry] of [...this.panels]) {
			const file = current.entries.find(item => item.id === entry.fileId);
			if (!file) { panel.dispose(); }
			else { panel.title = file.name; }
		}
		if (switched && action !== 'delete') { await this.open(false, current.active); }

		this.tree.refresh();
		await Promise.all([...this.panels].filter(([, entry]) => entry.initialized).map(([panel]) => this.post(panel, { type: 'files', state: this.storage.state() })));
	}

	private async importDrawing(library: string, fileId: string): Promise<void> {
		const files = await vscode.window.showOpenDialog({ title: this.strings.importTitle, canSelectMany: false, filters: { [this.strings.drawing]: ['excalidraw', 'json'] } });
		if (!files?.length) { return; }
		const snapshot = { scene: Buffer.from(await vscode.workspace.fs.readFile(files[0])).toString('utf8'), library };
		if (!isDraftSnapshot(snapshot)) { throw new Error(this.strings.importFailed); }
		const confirmed = await vscode.window.showWarningMessage(this.strings.importPrompt, { modal: true }, this.strings.importAction);
		if (confirmed === this.strings.importAction) { await this.save(snapshot, undefined, fileId); }
	}

	private async exportDrawing(data: string, format: 'excalidraw' | 'svg' | 'png'): Promise<void> {
		const label = format === 'png' ? this.strings.image : format === 'svg' ? this.strings.vector : this.strings.drawing;
		const uri = await vscode.window.showSaveDialog({ title: this.strings.exportTitle, defaultUri: vscode.Uri.joinPath(this.context.storageUri ?? this.context.globalStorageUri, `draft.${format}`), filters: { [label]: [format] } });
		if (uri) { await vscode.workspace.fs.writeFile(uri, format === 'png' ? Buffer.from(data, 'base64') : Buffer.from(data, 'utf8')); }
	}

	async restoreTabs(ids: readonly string[]): Promise<void> {
		await this.ensureLoaded();
		for (const id of ids) {
			if (this.storage.state().entries.some(entry => entry.kind === 'file' && entry.id === id)) { await this.open(false, id, true); }
		}
	}

	async restore(panel: vscode.WebviewPanel, companion: boolean, fileId?: string): Promise<void> {
		await this.ensureLoaded();
		const id = fileId && this.storage.state().entries.some(entry => entry.id === fileId && entry.kind === 'file') ? fileId : this.storage.state().active;
		this.attach(panel, companion, id);
	}

	async flush(): Promise<void> { await this.pending; }

	dispose(): void {
		for (const panel of [...this.panels.keys()]) { panel.dispose(); }
	}
}

export function activate(context: vscode.ExtensionContext): void {
	controller = new SketchpadController(context);
	context.subscriptions.push(controller);
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.draw.open', () => controller!.open()));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.draw.restoreTabs', (ids: unknown) => { if (Array.isArray(ids) && ids.every(id => typeof id === 'string')) { return controller!.restoreTabs(ids); } return undefined; }));
	for (const viewType of [pageType, companionType]) {
		context.subscriptions.push(vscode.window.registerWebviewPanelSerializer(viewType, { async deserializeWebviewPanel(panel, state: { fileId?: string } | undefined) { await controller!.restore(panel, viewType === companionType, state?.fileId); } }));
	}
}

export async function deactivate(): Promise<void> { await controller?.flush(); }

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { DraftStorage } from './draftStorage';
import { DraftSnapshot, HostMessage, isClientMessage, isDraftSnapshot } from './protocol';
import { getDrawStrings } from './strings';
import { getDrawHtml } from './webviewHtml';

const pageType = 'shortestpath.draw';
const companionType = 'shortestpath.draw.companion';
let controller: SketchpadController | undefined;

class SketchpadController implements vscode.Disposable {
	private readonly panels = new Map<vscode.WebviewPanel, { initialized: boolean; disposables: vscode.Disposable[] }>();
	private readonly storage: DraftStorage;
	private readonly strings = getDrawStrings(vscode.env.language);
	private snapshot: DraftSnapshot | undefined;
	private loaded = false;
	private pending: Promise<void> = Promise.resolve();

	constructor(private readonly context: vscode.ExtensionContext) {
		this.storage = new DraftStorage(vscode.Uri.joinPath(context.storageUri ?? context.globalStorageUri, 'sketchpad').fsPath);
	}

	open(companion = false): void {
		const viewType = companion ? companionType : pageType;
		const column = companion ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
		const existing = [...this.panels.keys()].find(panel => panel.viewType === viewType);
		if (existing) { existing.reveal(column); return; }
		const panel = vscode.window.createWebviewPanel(viewType, this.strings.title, column, { enableScripts: true, retainContextWhenHidden: true });
		this.attach(panel, companion);
	}

	attach(panel: vscode.WebviewPanel, companion: boolean): void {
		const entry = { initialized: false, disposables: [] as vscode.Disposable[] };
		this.panels.set(panel, entry);
		panel.title = this.strings.title;
		const resources = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
		panel.webview.options = { enableScripts: true, localResourceRoots: [resources] };
		entry.disposables.push(panel.onDidDispose(() => {
			this.panels.delete(panel);
			for (const disposable of entry.disposables) { disposable.dispose(); }
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
						if (!this.loaded) { this.snapshot = await this.storage.read(); this.loaded = true; }
						entry.initialized = true;
						await this.post(panel, { type: 'init', snapshot: this.snapshot });
					} catch { await this.post(panel, { type: 'init', error: this.strings.loadFailed }); }
					return;
				}
				if (!entry.initialized) { return; }
				if (value.type === 'save') {
					try {
						await this.save(value.snapshot, panel);
						await this.post(panel, { type: 'saved', revision: value.revision });
					} catch { await this.post(panel, { type: 'saved', revision: value.revision, error: this.strings.saveFailed }); }
					return;
				}
				if (value.type === 'export') { await this.exportDrawing(value.data, value.format); return; }
				await this.save(value.snapshot, panel);
				if (value.type === 'openBeside') {
					await vscode.commands.executeCommand('shortestpath.mode.solve');
					this.open(true);
				} else if (value.type === 'openMode') {
					await vscode.commands.executeCommand('shortestpath.mode.draw');
				} else if (value.type === 'clear') {
					const confirmed = await vscode.window.showWarningMessage(this.strings.clearPrompt, { modal: true }, this.strings.clearAction);
					if (confirmed === this.strings.clearAction) {
						await this.save({ scene: '{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}', library: value.snapshot.library });
					}
				} else if (value.type === 'import') {
					await this.importDrawing(value.snapshot.library);
				}
			});
			this.pending = run.catch(error => {
				void vscode.window.showErrorMessage(this.strings.actionFailed.replace('{0}', error instanceof Error ? error.message : String(error)));
			});
			return this.pending;
		}));
		panel.webview.html = getDrawHtml({ resourceRoot: panel.webview.asWebviewUri(resources).toString(), cspSource: panel.webview.cspSource, language: vscode.env.language, theme: this.theme(), companion, title: this.strings.title, nonce: randomUUID() });
	}

	private theme(): 'light' | 'dark' {
		return vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light || vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrastLight ? 'light' : 'dark';
	}

	private async post(panel: vscode.WebviewPanel, message: HostMessage): Promise<void> {
		if (this.panels.has(panel)) { await panel.webview.postMessage(message); }
	}

	private async save(snapshot: DraftSnapshot, source?: vscode.WebviewPanel): Promise<void> {
		if (this.snapshot?.scene === snapshot.scene && this.snapshot?.library === snapshot.library) { return; }
		await this.storage.save(snapshot);
		this.snapshot = snapshot;
		await Promise.all([...this.panels].filter(([panel, entry]) => panel !== source && entry.initialized).map(([panel]) => this.post(panel, { type: 'replace', snapshot })));
	}

	private async importDrawing(library: string): Promise<void> {
		const files = await vscode.window.showOpenDialog({ title: this.strings.importTitle, canSelectMany: false, filters: { [this.strings.drawing]: ['excalidraw', 'json'] } });
		if (!files?.length) { return; }
		const snapshot = { scene: Buffer.from(await vscode.workspace.fs.readFile(files[0])).toString('utf8'), library };
		if (!isDraftSnapshot(snapshot)) { throw new Error(this.strings.importFailed); }
		const confirmed = await vscode.window.showWarningMessage(this.strings.importPrompt, { modal: true }, this.strings.importAction);
		if (confirmed === this.strings.importAction) { await this.save(snapshot); }
	}

	private async exportDrawing(data: string, format: 'excalidraw' | 'svg' | 'png'): Promise<void> {
		const label = format === 'png' ? this.strings.image : format === 'svg' ? this.strings.vector : this.strings.drawing;
		const uri = await vscode.window.showSaveDialog({ title: this.strings.exportTitle, defaultUri: vscode.Uri.joinPath(this.context.storageUri ?? this.context.globalStorageUri, `draft.${format}`), filters: { [label]: [format] } });
		if (uri) { await vscode.workspace.fs.writeFile(uri, format === 'png' ? Buffer.from(data, 'base64') : Buffer.from(data, 'utf8')); }
	}

	async flush(): Promise<void> { await this.pending; await this.storage.flush(); }

	dispose(): void {
		for (const panel of [...this.panels.keys()]) { panel.dispose(); }
	}
}

export function activate(context: vscode.ExtensionContext): void {
	controller = new SketchpadController(context);
	context.subscriptions.push(controller);
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.draw.open', () => controller!.open()));
	for (const viewType of [pageType, companionType]) {
		context.subscriptions.push(vscode.window.registerWebviewPanelSerializer(viewType, { async deserializeWebviewPanel(panel) { controller!.attach(panel, viewType === companionType); } }));
	}
}

export async function deactivate(): Promise<void> { await controller?.flush(); }

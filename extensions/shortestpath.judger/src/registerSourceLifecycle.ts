/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import fs from 'fs';
import { readDashboard, dashboardContains } from './dashboardRepository';
import { getProbSaveLocation } from './parser';
import { getSaveLocationPref } from './preferences';
import { reconcileSourceRecords, SourceRename } from './sourceLifecycle';

/** Coalesce watcher deletes with Explorer renames before pruning any metadata. */
export function registerSourceLifecycle(context: vscode.ExtensionContext, changed: (result: { deleted: string[]; renamed: SourceRename[] }) => Promise<void>, prepare?: () => Promise<void>): void {
	let disposed = false, timeout: ReturnType<typeof setTimeout> | undefined;
	let tail = Promise.resolve();
	const renames: SourceRename[] = [];
	const identities = new Map<string, string>();
	const roots = () => vscode.workspace.workspaceFolders?.filter(folder => folder.uri.scheme === 'file').map(folder => folder.uri.fsPath) ?? [];
	const remember = (source: string) => {
		try { const stat = fs.statSync(source); if (stat.isFile()) { identities.set(`${stat.dev}:${stat.ino}`, source); } } catch { /* Deleted sources retain their last identity until reconciliation. */ }
	};
	const run = async () => {
		if (disposed) { return; }
		const folders = roots(), saveLocation = getSaveLocationPref() || undefined;
		const { records } = await readDashboard(folders, saveLocation, true);
		if (disposed) { return; }
		if (records.some(record => record.sourceMissing) || renames.length) { await prepare?.(); }
		const result = reconcileSourceRecords(records, folders, [...renames], getProbSaveLocation, saveLocation);
		renames.length = 0;
		for (const source of result.deleted) { for (const [key, value] of identities) { if (value === source) { identities.delete(key); } } }
		for (const record of records) { if (record.srcPath && record.sourceAvailable) { remember(record.srcPath); } }
		for (const rename of result.renamed) { remember(rename.newPath); }
		if (result.deleted.length || result.renamed.length) { await changed(result); }
	};
	const schedule = () => {
		if (disposed) { return; }
		if (timeout) { clearTimeout(timeout); }
		timeout = setTimeout(() => { timeout = undefined; tail = tail.then(run).catch(error => { globalThis.logger.log('Unable to reconcile source records', String(error)); if ((error as NodeJS.ErrnoException).code === 'SOURCE_RECORD_CHANGED') { schedule(); } }); }, 150);
	};
	const sourceFile = (file: string) => /\.(cpp|cc|cxx|c|py|java|rs|go|js|hs|rb|cs|cj)$/i.test(file);
	const watcher = vscode.workspace.createFileSystemWatcher('**/*');
	context.subscriptions.push(watcher, watcher.onDidDelete(uri => { if (uri.scheme === 'file' && sourceFile(uri.fsPath)) { schedule(); } }), watcher.onDidCreate(uri => {
		if (uri.scheme !== 'file' || !sourceFile(uri.fsPath) || !roots().some(root => dashboardContains(root, uri.fsPath))) { return; }
		try {
			const stat = fs.statSync(uri.fsPath), oldPath = identities.get(`${stat.dev}:${stat.ino}`);
			if (oldPath && oldPath !== uri.fsPath && !fs.existsSync(oldPath)) { renames.push({ oldPath, newPath: uri.fsPath }); schedule(); }
			remember(uri.fsPath);
		} catch { /* A short-lived temporary file is not a source move. */ }
	}), watcher.onDidChange(uri => { if (uri.scheme === 'file' && sourceFile(uri.fsPath)) { remember(uri.fsPath); } }), vscode.workspace.onDidDeleteFiles(() => schedule()), vscode.workspace.onDidRenameFiles(event => {
		for (const item of event.files) { if (item.oldUri.scheme === 'file' && item.newUri.scheme === 'file') { renames.push({ oldPath: item.oldUri.fsPath, newPath: item.newUri.fsPath }); } }
		schedule();
	}), vscode.workspace.onDidChangeWorkspaceFolders(() => schedule()), { dispose: () => { disposed = true; if (timeout) { clearTimeout(timeout); } } });
	// Existing records seed inode identities; an offline deletion is then pruned as well.
	tail = tail.then(run).catch(error => { globalThis.logger.log('Unable to reconcile source records', String(error)); if ((error as NodeJS.ErrnoException).code === 'SOURCE_RECORD_CHANGED') { schedule(); } });
}

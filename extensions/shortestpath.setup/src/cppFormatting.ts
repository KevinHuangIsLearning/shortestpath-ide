/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { EditorPreview } from './editorPreview';

export function defaultClangFormatConfig(tabSize: number): string {
	return `BasedOnStyle: Google

# --- Short statements and blocks ---
AllowShortIfStatementsOnASingleLine: AllIfsAndElse
AllowShortLoopsOnASingleLine: true
AllowShortBlocksOnASingleLine: true
AllowShortFunctionsOnASingleLine: None

# --- Line length ---
ColumnLimit: 0

# --- Indentation ---
IndentWidth: ${tabSize}
TabWidth: ${tabSize}
UseTab: Never

# --- Access modifiers ---
AccessModifierOffset: -2

# --- Braces ---
BreakBeforeBraces: Attach
AlwaysBreakTemplateDeclarations: No

# --- Pointers and comments ---
PointerAlignment: Left
SpacesBeforeTrailingComments: 4

# --- Definition spacing ---
SeparateDefinitionBlocks: Always

# --- Language standard ---
Standard: Latest
`;
}

export async function ensureGlobalCppFormatConfig(context: Pick<vscode.ExtensionContext, 'globalStorageUri'>): Promise<vscode.Uri> {
	const file = vscode.Uri.joinPath(context.globalStorageUri, '.clang-format');
	await fs.mkdir(path.dirname(file.fsPath), { recursive: true });
	try {
		await fs.writeFile(file.fsPath, defaultClangFormatConfig(vscode.workspace.getConfiguration('editor', null).get<number>('tabSize') ?? 2), { flag: 'wx' });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') { throw error; }
	}
	return file;
}

export function registerCppFormatting(context: Pick<vscode.ExtensionContext, 'subscriptions' | 'globalStorageUri'>): void {
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.formatCpp', async (file: string, source: string, tabSize: number, range?: vscode.Range | vscode.Range[]) => {
		if (EditorPreview.isPreviewFile(file)) { return undefined; }
		const config = await ensureGlobalCppFormatConfig(context);
		const preview = new EditorPreview();
		try {
			return await preview.format(source, Math.max(1, Math.min(32, Math.floor(tabSize))), range, config.fsPath);
		} finally { preview.dispose(); }
	}));
}

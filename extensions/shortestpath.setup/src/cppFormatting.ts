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

# --- 行为：尽量允许一行写完 ---
AllowShortIfStatementsOnASingleLine: AllIfsAndElse
AllowShortLoopsOnASingleLine: true
AllowShortBlocksOnASingleLine: true
AllowShortFunctionsOnASingleLine: None

# --- 行长（核心关键，不然上面全白给） ---
ColumnLimit: 0

# --- 缩进 ---
IndentWidth: ${tabSize}
TabWidth: ${tabSize}
UseTab: Never

# --- 访问修饰符 ---
AccessModifierOffset: -2

# --- 大括号风格 ---
BreakBeforeBraces: Attach
AlwaysBreakTemplateDeclarations: No

# --- 指针与注释 ---
PointerAlignment: Left
SpacesBeforeTrailingComments: 4

# --- 代码块间距 ---
SeparateDefinitionBlocks: Always

# --- 语言标准 ---
Standard: Latest
`;
}

export async function findCppFormatConfig(directory: string): Promise<string | undefined> {
	for (;;) {
		for (const name of ['.clang-format', '_clang-format']) {
			const file = path.join(directory, name);
			try {
				if ((await fs.stat(file)).isFile()) { return file; }
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
			}
		}
		const parent = path.dirname(directory);
		if (parent === directory) { return undefined; }
		directory = parent;
	}
}

export function registerCppFormatting(context: Pick<vscode.ExtensionContext, 'subscriptions'>): void {
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.formatCpp', async (file: string, source: string, tabSize: number, range?: vscode.Range | vscode.Range[]) => {
		// Explicit project rules take precedence. The temporary source also has
		// its own rule file, so the nested clangd request follows its normal path.
		if (await findCppFormatConfig(path.dirname(file))) { return undefined; }
		const preview = new EditorPreview();
		try {
			return await preview.format(source, Math.max(1, Math.min(32, Math.floor(tabSize))), range);
		} finally { preview.dispose(); }
	}));
}

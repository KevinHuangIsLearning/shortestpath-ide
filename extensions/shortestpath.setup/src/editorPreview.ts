/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { cppFallbackStyle, editorPreviewSource, type PreviewResult, type PreviewToken } from './firstRunPreview';
import { localize } from './localization';

type ClangdFormattingProvider = {
	provideDocumentFormattingEdits?: vscode.DocumentFormattingEditProvider['provideDocumentFormattingEdits'];
	provideDocumentRangeFormattingEdits?: vscode.DocumentRangeFormattingEditProvider['provideDocumentRangeFormattingEdits'];
	provideDocumentRangesFormattingEdits?: vscode.DocumentRangeFormattingEditProvider['provideDocumentRangesFormattingEdits'];
};
type ClangdFormattingApi = {
	getApi(version: 1): {
		languageClient?: {
			getFeature(method: string): { getProvider(document: vscode.TextDocument): ClangdFormattingProvider | undefined };
		};
	};
};

export class EditorPreview implements vscode.Disposable {
	private static readonly files = new Set<string>();
	private readonly files = new Set<string>();
	private directory: Promise<string> | undefined;
	private disposed = false;
	private request = 0;

	static isPreviewFile(file: string): boolean {
		return EditorPreview.files.has(file);
	}

	private async prepareDocument(source: string, tabSize: number, configPath?: string): Promise<{ document: vscode.TextDocument; directory: string }> {
		const request = ++this.request;
		this.directory ??= fs.mkdtemp(path.join(os.tmpdir(), 'shortestpath-editor-preview-'));
		const directory = path.join(await this.directory, String(request));
		// allow-any-unicode-next-line
		if (this.disposed) { throw new Error(localize('无法加载代码预览。')); }
		await fs.mkdir(directory);
		// clangd's formatting API discovers rules beside the source rather than
		// accepting clang-format's --style=file:<path> command-line argument.
		await fs.writeFile(path.join(directory, '.clang-format'), configPath ? await fs.readFile(configPath) : cppFallbackStyle(tabSize));
		const file = path.join(directory, `preview-${tabSize}.cpp`);
		await fs.writeFile(file, source);
		this.files.add(file);
		EditorPreview.files.add(file);
		const document = await vscode.workspace.openTextDocument(file);
		await vscode.extensions.getExtension('llvm-vs-code-extensions.vscode-clangd')?.activate();
		return { document, directory };
	}

	private async formatDocument(document: vscode.TextDocument, tabSize: number, range?: vscode.Range | vscode.Range[]): Promise<vscode.TextEdit[]> {
		const deadline = Date.now() + 15_000;
		const cancellation = new vscode.CancellationTokenSource();
		try {
			while (!this.disposed && Date.now() < deadline) {
				const client = vscode.extensions.getExtension<ClangdFormattingApi>('llvm-vs-code-extensions.vscode-clangd')?.exports.getApi(1).languageClient;
				const provider = client?.getFeature(range ? 'textDocument/rangeFormatting' : 'textDocument/formatting').getProvider(document);
				if (provider) {
					// Unlike executeFormatDocumentProvider, the provider distinguishes
					// an unchanged document ([]) from an unavailable/failed result.
					const options = { tabSize, insertSpaces: true };
					const edits = Array.isArray(range)
						? await provider.provideDocumentRangesFormattingEdits?.(document, range, options, cancellation.token)
						: range ? await provider.provideDocumentRangeFormattingEdits?.(document, range, options, cancellation.token)
							: await provider.provideDocumentFormattingEdits?.(document, options, cancellation.token);
					if (edits) { return edits; }
					break;
				}
				await new Promise<void>(resolve => setTimeout(resolve, 300));
			}
		} finally { cancellation.dispose(); }
		// allow-any-unicode-next-line
		throw new Error(localize('尚未获取到代码格式化结果，请稍后重试。'));
	}

	async format(source: string, tabSize: number, range?: vscode.Range | vscode.Range[], configPath?: string): Promise<vscode.TextEdit[]> {
		const { document } = await this.prepareDocument(source, tabSize, configPath);
		return this.formatDocument(document, tabSize, range);
	}

	async render(tabSize: number, typeHints: boolean, autoFormat: boolean, template?: string): Promise<PreviewResult> {
		let source = template ?? editorPreviewSource(tabSize);
		let document: vscode.TextDocument | undefined;
		if (typeHints || autoFormat) {
			const prepared = await this.prepareDocument(source, tabSize);
			document = prepared.document;
			if (autoFormat) {
				const edits = await this.formatDocument(document, tabSize);
				for (const edit of edits.sort((a, b) => document!.offsetAt(b.range.start) - document!.offsetAt(a.range.start))) {
					source = source.slice(0, document.offsetAt(edit.range.start)) + edit.newText + source.slice(document.offsetAt(edit.range.end));
				}
				const formatted = path.join(prepared.directory, `formatted-${tabSize}.cpp`);
				await fs.writeFile(formatted, source);
				document = await vscode.workspace.openTextDocument(formatted);
			}
		}
		const lines = await vscode.commands.executeCommand<PreviewToken[][]>('_shortestpath.cppPreviewTokens', source);
		// allow-any-unicode-next-line
		if (!lines) { throw new Error(localize('无法加载代码预览。')); }
		const result: PreviewResult = { source, lines, hints: [] };
		if (!typeHints || this.disposed || !document) { return result; }
		// The first request can arrive before the language server has registered.
		const deadline = Date.now() + 15_000;
		while (!this.disposed && Date.now() < deadline) {
			const hints = await vscode.commands.executeCommand<vscode.InlayHint[]>('vscode.executeInlayHintProvider', document.uri, new vscode.Range(0, 0, document.lineCount, 0));
			const types = hints?.filter(hint => hint.kind === vscode.InlayHintKind.Type);
			if (types?.length || (template !== undefined && hints !== undefined)) {
				result.hints = (types ?? []).map(hint => ({
					line: hint.position.line, character: hint.position.character,
					label: typeof hint.label === 'string' ? hint.label : hint.label.map(part => part.value).join(''), paddingLeft: hint.paddingLeft, paddingRight: hint.paddingRight
				}));
				return result;
			}
			await new Promise<void>(resolve => setTimeout(resolve, 300));
		}
		// allow-any-unicode-next-line
		result.hintError = localize('尚未获取到 clang 类型提示，请稍后重试。');
		return result;
	}

	dispose(): void {
		this.disposed = true;
		for (const file of this.files) { EditorPreview.files.delete(file); }
		this.files.clear();
		void this.directory?.then(directory => fs.rm(directory, { recursive: true, force: true })).catch(console.error);
	}
}

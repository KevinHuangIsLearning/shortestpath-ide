import { Range, Selection, window, workspace } from 'vscode';

export async function revealLineCommand(fsPath: string, [line, char]: [number, number]): Promise<void> {
	const range = new Range(line, char, line, char);
	const document = await workspace.openTextDocument(fsPath);
	const editor = await window.showTextDocument(document);
	editor.revealRange(range);
	editor.selection = new Selection(range.start.line, range.start.character, range.start.line, range.start.character);
}

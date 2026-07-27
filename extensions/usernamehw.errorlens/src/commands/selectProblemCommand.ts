import { $config } from 'src/extension';
import { extUtils } from 'src/utils/extUtils';
import { Selection, type Diagnostic, type TextEditor } from 'vscode';

/**
 * Can be used from Command Palette (arg = undefined) or from hover (arg = {code: string | undefined})
 */
export function selectProblemCommand(editor: TextEditor): void {
	let diagnostic: Diagnostic | undefined;
	if ($config.selectProblemType === 'closestProblem') {
		diagnostic = extUtils.getClosestDiagnostic(editor);
	} else if ($config.selectProblemType === 'closestSeverity') {
		diagnostic = extUtils.getClosestBySeverityDiagnostic(editor);
	} else if ($config.selectProblemType === 'activeLine') {
		diagnostic = extUtils.getDiagnosticAtLine(editor.document.uri, editor.selection.active.line);
	}

	if (!diagnostic) {
		return;
	}

	editor.selection = new Selection(diagnostic.range.start, diagnostic.range.end);
	editor.revealRange(diagnostic.range);
}

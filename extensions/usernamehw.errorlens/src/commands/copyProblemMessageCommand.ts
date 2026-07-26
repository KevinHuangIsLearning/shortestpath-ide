import { extUtils } from 'src/utils/extUtils';
import { vscodeUtils } from 'src/utils/vscodeUtils';
import { env, languages, window } from 'vscode';

export function copyProblemMessageCommand(message: string | undefined): void {
	let targetMessage = '';

	if (typeof message === 'string') {
		targetMessage = message;
	} else {
		const editor = window.activeTextEditor;
		if (!editor) {
			window.showInformationMessage('No active Text Editor.');
			return;
		}
		// TODO: use extUtils.getDiagnosticAtLine()
		const groupedDiagnostics = extUtils.groupDiagnosticsByLine(languages.getDiagnostics(editor.document.uri));

		const activeLineNumber = editor.selection.active.line;
		const diagnosticAtActiveLineNumber = groupedDiagnostics[activeLineNumber];
		if (!diagnosticAtActiveLineNumber) {
			window.showInformationMessage('There\'s no problem at the active line.');
			return;
		}

		const renderedDiagnostic = diagnosticAtActiveLineNumber[0];
		const source = renderedDiagnostic.source ? `[${renderedDiagnostic.source}] ` : '';

		targetMessage = source + renderedDiagnostic.message;
	}

	env.clipboard.writeText(targetMessage);

	vscodeUtils.showTempStatusBarNotification({
		message: `🟩 Copied 🟩`,
		timeout: 1000,
	});
}

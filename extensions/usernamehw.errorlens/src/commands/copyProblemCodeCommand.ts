import { extUtils } from 'src/utils/extUtils';
import { vscodeUtils } from 'src/utils/vscodeUtils';
import { env, window } from 'vscode';

/**
 * Can be used from Command Palette (arg = undefined) or from hover (arg = {code: string | undefined})
 */
export function copyProblemCodeCommand(arg: { code: string | undefined } | undefined): void {
	let targetMessage = '';

	if (typeof arg?.code === 'string') {
		targetMessage = arg.code;
	} else {
		const editor = window.activeTextEditor;
		if (!editor) {
			return;
		}

		const diagnosticAtActiveLineNumber = extUtils.getDiagnosticAtLine(editor.document.uri, editor.selection.active.line);

		if (!diagnosticAtActiveLineNumber) {
			return;
		}

		const codeAsString = extUtils.getDiagnosticCode(diagnosticAtActiveLineNumber);
		if (!codeAsString) {
			return;
		}

		targetMessage = codeAsString;
	}

	env.clipboard.writeText(targetMessage);

	vscodeUtils.showTempStatusBarNotification({
		message: `🟩 Copied 🟩`,
		timeout: 1000,
	});
}

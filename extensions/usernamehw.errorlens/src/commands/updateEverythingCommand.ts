import { clearDecorations, updateDecorationsForUri } from 'src/decorations';
import { $state } from 'src/extension';
import { extUtils } from 'src/utils/extUtils';
import { languages, window } from 'vscode';

interface UpdateEverythingArgs {
	kind?: 'update' | 'clear';
}

export function updateEverythingCommand(arg?: UpdateEverythingArgs): void {
	for (const editor of window.visibleTextEditors) {
		if (arg?.kind === 'clear') {
			clearDecorations({ editor });
		} else {
			updateDecorationsForUri({
				uri: editor.document.uri,
				editor,
			});
			$state.statusBarMessage.updateText(editor, extUtils.groupDiagnosticsByLine(languages.getDiagnostics(editor.document.uri)));
		}
	}

	$state.statusBarIcons.updateText();
}

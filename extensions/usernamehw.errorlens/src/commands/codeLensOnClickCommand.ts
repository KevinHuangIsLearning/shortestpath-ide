import { CommandId } from 'src/commands';
import { $config } from 'src/extension';
import { Constants } from 'src/types';
import { vscodeUtils } from 'src/utils/vscodeUtils';
import { commands, type Diagnostic } from 'vscode';

export function codeLensOnClickCommand(diagnostic: Diagnostic): void {
	switch ($config.codeLensOnClick) {
		case 'showProblemsView':
			commands.executeCommand(Constants.OpenProblemsViewCommandId);
			break;
		case 'showQuickFix':
			vscodeUtils.setCaretInEditor({
				range: diagnostic.range,
			});
			commands.executeCommand(Constants.QuickFixCommandId, diagnostic);
			break;
		case 'searchForProblem':
			vscodeUtils.setCaretInEditor({
				range: diagnostic.range,
			});
			commands.executeCommand(CommandId.SearchForProblem, diagnostic);
			break;
		case 'none':
		default:
			break;
	}
}

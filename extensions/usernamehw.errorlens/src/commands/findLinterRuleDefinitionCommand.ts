/* eslint-disable no-await-in-loop */
import { $config } from 'src/extension';
import { Constants, type ExtensionConfig } from 'src/types';
import { extUtils } from 'src/utils/extUtils';
import { vscodeUtils } from 'src/utils/vscodeUtils';
import { commands, languages, window, workspace, type Diagnostic, type QuickPickItem, type Uri } from 'vscode';

export interface RuleDefinitionArgs {
	source?: string;
	code?: string;
}

/**
 * Try to open a linter file where the lint rule is defined based on source + code of a Diagnostic,
 * for example: { source: 'eslint', code: 'padded-blocks' }.
 */
export async function findLinterRuleDefinitionCommand(args?: RuleDefinitionArgs): Promise<void> {
	let source = args?.source;
	let code = args?.code;

	if (!args) {
		const diagnostic = tryToFindDiagnosticFromActiveEditor();
		if (diagnostic) {
			code = extUtils.getDiagnosticCode(diagnostic);
			source = diagnostic.source;
		}
	}
	if (!source) {
		window.showWarningMessage(`Diagnostic has no "source".`);
		return;
	}
	if (!code) {
		window.showWarningMessage(`Diagnostic has no "code".`);
		return;
	}

	const lintFilesGlobs = $config.lintFilePaths[source];

	if (lintFilesGlobs === 'none') {
		return;
	}

	if (!lintFilesGlobs) {
		showNotificationWithOpenSettingsButton(`No linter files specified for source: "${source}".`);
		return;
	}

	const resultPromises = [];
	for (const glob of lintFilesGlobs) {
		resultPromises.push(workspace.findFiles(glob, '**/node_modules/**', 10));
	}
	const linterFilePaths = (await Promise.all(resultPromises)).flat();

	if (!linterFilePaths.length) {
		showNotificationWithOpenSettingsButton(`No linter files found that match any of the globs: ${JSON.stringify(linterFilePaths)}.`);
		return;
	}

	interface MatchResult {
		fileContents: string;
		linterFilePath: Uri;
	}
	const ruleMatchResults: MatchResult [] = [];
	for (const linterFilePath of linterFilePaths) {
		const fileContents = await vscodeUtils.readFileVscode(linterFilePath.fsPath);
		if (fileContents.includes(code)) {
			ruleMatchResults.push({
				fileContents,
				linterFilePath,
			});
		}
	}

	if (!ruleMatchResults.length) {
		const message = `No linter file with "${code}" found.`;
		if (linterFilePaths.length === 1) {
			showNotificationWithGlobalSearchButton(message, code);
			const editor = await vscodeUtils.openFileInVscode(linterFilePaths[0]);
			vscodeUtils.revealLine(editor, 0);
		} else {
			const pickedFile = await window.showQuickPick(linterFilePaths.map(filePathUri => filePathUri.fsPath), {
				title: message,
			});
			if (pickedFile) {
				vscodeUtils.openFileInVscode(pickedFile);
			}
		}
		return;
	}

	if (ruleMatchResults.length === 1) {
		const fileRuleMatch = ruleMatchResults[0];
		await openAndReveal(fileRuleMatch.linterFilePath.fsPath, fileRuleMatch.fileContents, code);
		return;
	}

	const pickedFile = await window.showQuickPick<MatchResult & QuickPickItem>(ruleMatchResults.map(matchResult => ({
		label: matchResult.linterFilePath.fsPath,
		linterFilePath: matchResult.linterFilePath,
		fileContents: matchResult.fileContents,
	} satisfies MatchResult & QuickPickItem)), {
		title: `"${code}" is found in multiple files:`,
	});

	if (!pickedFile) {
		return;
	}

	openAndReveal(pickedFile.linterFilePath, pickedFile.fileContents, code);
}

async function showNotificationWithOpenSettingsButton(message: string): Promise<void> {
	const openLinterSetting = 'Open Setting';
	const pressedButton = await window.showWarningMessage(message, openLinterSetting);
	if (pressedButton === openLinterSetting) {
		vscodeUtils.openSettingGuiAt(`@ext:${Constants.ExtensionId} ${'lintFilePaths' satisfies keyof ExtensionConfig}`);
	}
}

async function showNotificationWithGlobalSearchButton(message: string, code: string): Promise<void> {
	const runGlobalSearchButton = 'Search';
	const openLinterSetting = 'Open Setting';

	const pressedButton = await window.showWarningMessage(message, openLinterSetting, runGlobalSearchButton);

	if (pressedButton === openLinterSetting) {
		vscodeUtils.openSettingGuiAt(`@ext:${Constants.ExtensionId} ${'lintFilePaths' satisfies keyof ExtensionConfig}`);
	} else if (pressedButton === runGlobalSearchButton) {
		commands.executeCommand('workbench.action.findInFiles', {
			query: code,
			isRegex: false,
			triggerSearch: true,
			excludeSettingAndIgnoreFiles: true,
		});
	}
}

async function openAndReveal(pathOrUri: Uri | string, contents: string, needle: string): Promise<void> {
	const textEditor = await vscodeUtils.openFileInVscode(pathOrUri);
	const lineNumber = getLineNumberForMatch(contents, needle);
	if (lineNumber) {
		vscodeUtils.revealLine(textEditor, lineNumber);
	}
}

function getLineNumberForMatch(text: string, needle: string): number | undefined {
	const lines = text.split('\n');
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].includes(needle)) {
			return i;
		}
	}
}
/**
 * Command was called from Command Palette or keybinding.
 * This function needs to find diagnostic with the highest priority at
 * the line where the cursor is.
 */
function tryToFindDiagnosticFromActiveEditor(): Diagnostic | undefined {
	const editor = window.activeTextEditor;
	if (!editor) {
		return;
	}

	const activeLineNumber = editor.selection.active.line;
	const diagnosticsForUri = languages.getDiagnostics(editor.document.uri);
	const groupedDiagnostics = extUtils.groupDiagnosticsByLine(diagnosticsForUri);

	return groupedDiagnostics[activeLineNumber]?.[0];
}

import { $config } from 'src/extension';
import { Constants, type ExtensionConfig } from 'src/types';
import { vscodeUtils } from 'src/utils/vscodeUtils';
import { window, workspace } from 'vscode';

export async function toggleWorkspaceCommand(): Promise<void> {
	const activeTextEditor = window.activeTextEditor;

	let workspaceFsPath: string | undefined;
	if (activeTextEditor) {
		workspaceFsPath = workspace.getWorkspaceFolder(activeTextEditor?.document?.uri)?.uri.fsPath;
		if (!workspaceFsPath) {
			window.showWarningMessage(`Counldn't find workspace folder for "${activeTextEditor.document.uri.toString()}".`);
		}
	} else {
		workspaceFsPath = await tryToGuessWorkspaceFolder();
		if (!workspaceFsPath) {
			window.showWarningMessage(`No opened/picked workspace folder.`);
		}
	}
	if (!workspaceFsPath) {
		return;
	}

	let newExcludeWorkspaceList: string[];
	if ($config.excludeWorkspaces?.includes(workspaceFsPath)) {
		newExcludeWorkspaceList = $config.excludeWorkspaces.filter(workspacePath => workspacePath !== workspaceFsPath);
		showResultNotification(`"${workspaceFsPath}" - Removed from "errorLens.excludeWorkspaces"`);
	} else {
		newExcludeWorkspaceList = [...($config.excludeWorkspaces || []), workspaceFsPath];
		showResultNotification(`"${workspaceFsPath}" - Added to "errorLens.excludeWorkspaces" (now ignored)`);
	}

	vscodeUtils.updateGlobalSetting('errorLens.excludeWorkspaces', newExcludeWorkspaceList);
}

async function showResultNotification(message: string): Promise<void> {
	const buttonToOpenSettings = 'Open Settings UI';
	const pressedButton = await window.showInformationMessage(message, buttonToOpenSettings);
	if (!pressedButton) {
		return;
	}

	vscodeUtils.openSettingGuiAt(`@ext:${Constants.ExtensionId} ${'excludeWorkspaces' satisfies keyof ExtensionConfig}`);
}

async function tryToGuessWorkspaceFolder(): Promise<string | undefined> {
	const workspaceFolders = workspace.workspaceFolders;

	if (!workspaceFolders?.length) {
		return;
	}

	if (workspaceFolders.length === 1) {
		return workspaceFolders[0].uri.fsPath;
	}

	const pickedFsPath = await window.showQuickPick(workspaceFolders.map(workspaceFolder => workspaceFolder.uri.fsPath), {
		title: 'Pick workspace folder to include/exclude:',
	});

	return pickedFsPath;
}

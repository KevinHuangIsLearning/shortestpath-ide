/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import localize from './i18n';

/** Upgrade explicit legacy values, then remove only successfully handled old entries. */
export async function migrateSettings(
	context: vscode.ExtensionContext,
): Promise<void> {
	const properties = context.extension.packageJSON.contributes.configuration
		.properties as Record<string, { scope?: string }>;
	const keys = Object.keys(properties).filter((key) =>
		key.startsWith('judger.'),
	);
	const scopes = [
		{
			target: vscode.ConfigurationTarget.Global,
			field: 'globalValue' as const,
			uri: undefined,
		},
		...(vscode.workspace.workspaceFolders
			? [
					{
						target: vscode.ConfigurationTarget.Workspace,
						field: 'workspaceValue' as const,
						uri: undefined,
					},
			  ]
			: []),
		...(vscode.workspace.workspaceFolders || []).map((folder) => ({
			target: vscode.ConfigurationTarget.WorkspaceFolder,
			field: 'workspaceFolderValue' as const,
			uri: folder.uri,
		})),
	];
	const hasLegacySettings = scopes.some(scope => keys.some(key => {
		if (properties[key].scope === 'application' && scope.target !== vscode.ConfigurationTarget.Global) { return false; }
		const legacyKey = `cph.${key.slice('judger.'.length)}`;
		const old = vscode.workspace.getConfiguration(undefined, scope.uri).inspect(legacyKey);
		if (old?.[scope.field] !== undefined) { return true; }
		const languageField = scope.field === 'globalValue' ? 'globalLanguageValue'
			: scope.field === 'workspaceValue' ? 'workspaceLanguageValue' : 'workspaceFolderLanguageValue';
		return properties[key].scope === 'language-overridable' && (old?.languageIds ?? []).some(languageId =>
			vscode.workspace.getConfiguration(undefined, { uri: scope.uri, languageId }).inspect(legacyKey)?.[languageField] !== undefined);
	}));
	if (!hasLegacySettings) { return; }
	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: localize('judger.migration.progress', 'Migrating configuration'),
		cancellable: false,
	}, async () => {
		// Inspect on every activation, including profiles migrated by the old copy-only implementation.
		// Successful removal makes this idempotent; failed writes/deletes remain retryable.
		for (const scope of scopes) {
			const configuration = vscode.workspace.getConfiguration(
				undefined,
				scope.uri,
			);
			for (const key of keys) {
				if (
					properties[key].scope === 'application' &&
					scope.target !== vscode.ConfigurationTarget.Global
				) {
					continue;
				}
				try {
					const legacyKey = `cph.${key.slice('judger.'.length)}`;
					const old = configuration.inspect(legacyKey);
					const current = configuration.inspect(key);
					if (old?.[scope.field] !== undefined) {
						if (current?.[scope.field] === undefined) {
							await configuration.update(
								key,
								old[scope.field],
								scope.target,
							);
						}
						await configuration.update(legacyKey, undefined, scope.target);
					}
					const languageField =
						scope.field === 'globalValue'
							? 'globalLanguageValue'
							: scope.field === 'workspaceValue'
							  ? 'workspaceLanguageValue'
							  : 'workspaceFolderLanguageValue';
					for (const languageId of properties[key].scope ===
					'language-overridable'
						? old?.languageIds ?? []
						: []) {
						const languageConfiguration = vscode.workspace.getConfiguration(
							undefined,
							{ uri: scope.uri, languageId },
						);
						const legacy =
							languageConfiguration.inspect(legacyKey)?.[languageField];
						if (legacy !== undefined) {
							if (
								languageConfiguration.inspect(key)?.[languageField] ===
								undefined
							) {
								await languageConfiguration.update(
									key,
									legacy,
									scope.target,
									true,
								);
							}
							await languageConfiguration.update(
								legacyKey,
								undefined,
								scope.target,
								true,
							);
						}
					}
				} catch (error) {
					// A locked or malformed settings file must not disable the extension.
					// Leave unhandled values intact and retry them on the next activation.
					console.warn('Judger settings migration failed', key, scope.target, error);
				}
			}
		}
	});
}

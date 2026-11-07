/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { basename } from '../../../../base/common/resources.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IWorkspacesService, isRecentFile, isRecentFolder, isRecentWorkspace, IRecent } from '../../../../platform/workspaces/common/workspaces.js';
import { getColorRegistry } from '../../../../platform/theme/common/colorRegistry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { isDark } from '../../../../platform/theme/common/theme.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { BrowserFavoritesStore } from '../../browserView/electron-browser/features/browserFavoritesFeature.js';
import { IShortestPathModeService } from '../common/shortestPathMode.js';

function recentResource(item: IRecent): URI {
	return isRecentFile(item) ? item.fileUri : isRecentFolder(item) ? item.folderUri : item.workspace.configPath;
}

CommandsRegistry.registerCommand('shortestpath.homepage.isDevelopment', accessor => !accessor.get(IWorkbenchEnvironmentService).isBuilt);

CommandsRegistry.registerCommand('shortestpath.homepage.getContext', async accessor => {
	const workspaces = accessor.get(IWorkspacesService);
	const favorites = new BrowserFavoritesStore(accessor.get(IStorageService));
	let entries: { url: string; name: string; favicon?: string }[];
	try {
		entries = favorites.entries.map(item => {
			let hostname: string | undefined;
			try {
				const url = new URL(item.url);
				hostname = url.hostname;
			} catch { /* Keep a saved custom URL readable. */ }
			const favicon = item.favicon?.startsWith('data:image/') ? item.favicon : undefined;
			return { url: item.url, name: item.name || item.title || hostname || item.url, favicon };
		});
	} finally { favorites.dispose(); }
	const recent = await workspaces.getRecentlyOpened().catch(() => ({ workspaces: [], files: [] }));
	return {
		recent: [...recent.workspaces, ...recent.files].slice(0, 6).map(item => ({ uri: recentResource(item).toString(), name: item.label || basename(recentResource(item)), path: recentResource(item).fsPath, kind: isRecentFile(item) ? 'file' : 'workspace' })),
		favorites: entries,
	};
});

CommandsRegistry.registerCommand('shortestpath.homepage.getTheme', accessor => {
	const theme = accessor.get(IThemeService).getColorTheme();
	const root = accessor.get(IWorkbenchLayoutService).mainContainer;
	const computed = root.ownerDocument.defaultView!.getComputedStyle(root);
	const colors = getColorRegistry().getColors().flatMap(color => {
		const value = theme.getColor(color.id);
		return value ? [`--vscode-${color.id.replaceAll('.', '-')}:${value.toString()};`] : [];
	});
	const mono = accessor.get(IConfigurationService).getValue<string>('editor.fontFamily');
	const radius = computed.getPropertyValue('--vscode-cornerRadius-medium') || '6px';
	return `:root{color-scheme:${isDark(theme.type) ? 'dark' : 'light'};--homepage-font:${computed.fontFamily};--homepage-font-size:${computed.fontSize};--vscode-editor-font-family:${mono};--vscode-cornerRadius-medium:${radius};${colors.join('')}}`;
});

CommandsRegistry.registerCommand('shortestpath.homepage.openRecent', async (accessor, resource?: string) => {
	const commands = accessor.get(ICommandService);
	const workspaces = accessor.get(IWorkspacesService);
	const modes = accessor.get(IShortestPathModeService);
	const editors = accessor.get(IEditorService);
	const host = accessor.get(IHostService);
	if (!resource) { await commands.executeCommand('workbench.action.openRecent'); return; }
	const recent = await workspaces.getRecentlyOpened();
	const item = [...recent.workspaces, ...recent.files].find(item => recentResource(item).toString() === resource);
	if (!item) { throw new Error('Resource is not in recently opened items'); }
	if (isRecentFile(item)) {
		await modes.switchMode('solve');
		await editors.openEditor({ resource: item.fileUri });
	} else {
		await host.openWindow([isRecentWorkspace(item) ? { workspaceUri: item.workspace.configPath } : { folderUri: item.folderUri }], { remoteAuthority: item.remoteAuthority });
	}
});

CommandsRegistry.registerCommand('shortestpath.homepage.openFavorite', async (accessor, url?: string) => {
	const favorites = new BrowserFavoritesStore(accessor.get(IStorageService));
	try {
		if (!url || !favorites.entries.some(item => item.url === url)) { throw new Error('URL is not in browser favorites'); }
	} finally { favorites.dispose(); }
	const modes = accessor.get(IShortestPathModeService);
	await modes.switchMode('browse');
	await modes.openBrowser(url);
});

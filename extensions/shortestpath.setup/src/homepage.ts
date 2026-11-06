/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { createHomepageServer, type HomepageServer } from '../homepage/server.cjs';
import { localize } from './localization';

// Build-time configuration. GitCode requires publishing the same HTML in its repository.
const homepageSource = {
	owner: 'KevinHuangIsLearning',
	repository: 'shortestpath-ide',
	ref: 'main',
	file: 'extensions/shortestpath.setup/homepage/public/index.html',
};
const homepageSourceUrls = {
	github: `https://raw.githubusercontent.com/${homepageSource.owner}/${homepageSource.repository}/${homepageSource.ref}/${homepageSource.file}`,
	gitcode: `https://raw.gitcode.com/${homepageSource.owner}/${homepageSource.repository}/raw/${homepageSource.ref}/${homepageSource.file}`,
};

/** Own the loopback server per extension host; start it only when Home is opened. */
export function registerHomepage(context: vscode.ExtensionContext): void {
	let instance: Promise<{ server: HomepageServer; origin: string }> | undefined;
	let disposed = false;
	let themeRevision = 0;
	let data: Promise<object> | undefined;
	let dataTime = 0;
	const commands = new Map<string, (args: readonly string[]) => PromiseLike<unknown>>([
		['workbench.action.files.newUntitledFile', async () => {
			await vscode.commands.executeCommand('shortestpath.mode.solve');
			return vscode.commands.executeCommand('workbench.action.files.newUntitledFile', { languageId: vscode.workspace.getConfiguration('shortestpath.newFile').get<string>('defaultLanguage', 'cpp') || 'cpp' });
		}],
		...['workbench.action.files.openFolder', 'workbench.action.files.openFile', 'shortestpath.mode.browse', 'shortestpath.mode.dashboard', 'shortestpath.openSettings', 'shortestpath.action.checkForUpdates', 'shortestpath.homepage.documentation'].map(command => [command, () => vscode.commands.executeCommand(command)] as const),
		...['shortestpath.homepage.openRecent', 'shortestpath.homepage.openFavorite'].map(command => [command, (args: readonly string[]) => vscode.commands.executeCommand(command, args[0])] as const),
	]);
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.homepage.documentation', () => vscode.env.openExternal(vscode.Uri.parse('https://kevinhuang.feishu.cn/wiki/LLBBwJQQGil2NnkJXWxcAeaLndd'))));
	const getData = async () => {
		if (!data || Date.now() - dataTime > 30_000) {
			dataTime = Date.now();
			data = (async () => {
				const [context, heatmap] = await Promise.allSettled([
					vscode.commands.executeCommand<object>('shortestpath.homepage.getContext'),
					vscode.commands.executeCommand<object>('judger.getHomepageHeatmap'),
				]);
				if (context.status === 'rejected') { dataTime = 0; }
				return { ...(context.status === 'fulfilled' ? context.value : {}), heatmap: heatmap.status === 'fulfilled' ? heatmap.value : null, contextError: context.status === 'rejected' };
			})();
		}
		const now = new Date();
		const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
		return { ...await data, themeRevision, locale: vscode.env.language, hour: now.getHours(), date: now.toLocaleDateString(vscode.env.language), today };
	};
	context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(() => { themeRevision++; }));
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration('editor.fontFamily') || event.affectsConfiguration('workbench.colorCustomizations')) { themeRevision++; }
	}));
	context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { data = undefined; }));
	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(() => { data = undefined; }));
	const start = async () => {
		const server = await createHomepageServer({
			dataDir: path.join(context.globalStorageUri.fsPath, 'homepage-html'),
			sourceUrl: homepageSourceUrls.github,
			fallbackSourceUrl: homepageSourceUrls.gitcode,
			getData,
			getTheme: () => vscode.commands.executeCommand<string>('shortestpath.homepage.getTheme'),
			executeCommand: async (command, args) => {
				const run = commands.get(command);
				if (args.length > 1 || args.some(arg => typeof arg !== 'string')) { throw new Error('Invalid homepage command arguments'); }
				if (!run || !(await vscode.commands.getCommands()).includes(command)) {
					throw new Error(localize('当前 IDE 版本不支持此功能，请升级 IDE。'));
				}
				await run(args);
			},
		});
		try {
			const origin = await server.listen(0);
			if (disposed) { await server.close(); throw new Error('Homepage service disposed'); }
			return { server, origin };
		} catch (error) {
			await server.close().catch(() => undefined);
			throw error;
		}
	};
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.homepage.getUrl', async () => {
		if (disposed) { return; }
		instance ??= start().catch(error => { instance = undefined; throw error; });
		const { origin } = await instance;
		return `${origin}/?shortestpath-home=1`;
	}));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.homepage.open', () => vscode.commands.executeCommand('shortestpath.mode.home')));
	context.subscriptions.push({
		dispose: () => {
			disposed = true;
			void instance?.then(({ server }) => server.close()).catch(error => console.error('Failed to close homepage server', error));
		}
	});
}

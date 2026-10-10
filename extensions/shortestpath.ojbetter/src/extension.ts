/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { join } from 'path';
import { Assets } from './assets';
import { connect, Integration } from './integration';
import { platformForUrl, Platform } from './sites';
import { Preferences } from './storage';

/** Attach only to the selected OJ tabs; browser and Judger continue to own their sessions. */
export function activate(context: vscode.ExtensionContext): void {
	const log = vscode.window.createOutputChannel('OJBetter');
	context.subscriptions.push(log);
	if (!vscode.window.browserTabs || !vscode.window.onDidOpenBrowserTab) {
		log.appendLine('Integrated browser API unavailable');
		return;
	}
	let assets: Assets;
	try {
		assets = new Assets(join(context.extensionPath, 'resources'));
	} catch (error) {
		log.appendLine(`Cannot load bundled OJBetter: ${error.message}`);
		return;
	}
	const storage = new Preferences(context.globalState);
	const tabs = new Map<string, Integration>();
	const starting = new Set<string>();
	let generation = 0;
	let stopped = false;
	const enabled = (): Record<Platform, boolean> => ({
		atcoder: vscode.workspace.getConfiguration('shortestpath.ojbetter').get('atcoder', true),
		codeforces: vscode.workspace.getConfiguration('shortestpath.ojbetter').get('codeforces', true)
	});
	const attach = async (tab: vscode.BrowserTab) => {
		const platform = platformForUrl(tab.url);
		if (stopped || !platform || !enabled()[platform] || tabs.has(tab.id) || starting.has(tab.id)) {
			return;
		}
		starting.add(tab.id);
		const startedGeneration = generation;
		try {
			const integration = await connect(tab, assets, {
				storage,
				fetch,
				clipboard: text => vscode.env.clipboard.writeText(text),
				log: message => log.appendLine(message),
				changed: platform => {
					for (const integration of tabs.values()) {
						void integration.synchronize(platform).catch(error => log.appendLine(`Preference synchronization failed: ${error.message}`));
					}
				}
			}, enabled());
			if (integration.isDisposed || stopped || startedGeneration !== generation || !vscode.window.browserTabs.some(candidate => candidate.id === tab.id)) {
				integration.dispose();
			} else {
				tabs.set(tab.id, integration);
				integration.onDidDispose = () => {
					if (tabs.get(tab.id) === integration) { tabs.delete(tab.id); }
				};
				log.appendLine(`${assets.manifest.scripts[platform].name} ${assets.manifest.scripts[platform].version}: attached`);
			}
		} catch (error) {
			log.appendLine(`OJBetter attachment failed: ${error.message}`);
		} finally {
			starting.delete(tab.id);
			if (!stopped && startedGeneration !== generation) {
				const current = vscode.window.browserTabs.find(candidate => candidate.id === tab.id);
				if (current) { void attach(current); }
			}
		}
	};
	const reset = () => {
		generation++;
		for (const integration of tabs.values()) {
			integration.dispose();
		}
		tabs.clear();
	};
	context.subscriptions.push(
		vscode.window.onDidOpenBrowserTab(tab => { void attach(tab); }),
		vscode.window.onDidChangeBrowserTabState(tab => { void attach(tab); }),
		vscode.window.onDidCloseBrowserTab(tab => {
			tabs.get(tab.id)?.dispose();
			tabs.delete(tab.id);
		}),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('shortestpath.ojbetter')) {
				reset();
				for (const tab of vscode.window.browserTabs) {
					void attach(tab);
				}
			}
		}),
		{ dispose: () => { stopped = true; reset(); } }
	);
	for (const tab of vscode.window.browserTabs) {
		void attach(tab);
	}
}

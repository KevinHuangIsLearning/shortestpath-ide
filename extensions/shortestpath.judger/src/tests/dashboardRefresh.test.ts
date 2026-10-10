/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
const mockCommands = new Map<string, (...args: any[]) => any>();
let stateChanged: () => void;
let receive: (message: any) => Promise<void>;
let disposed: () => void;
const mockRead = jest.fn(async () => ({ records: [], skipped: 0 }));
const mockPanel = { active: true, reveal: jest.fn(() => { if (!mockPanel.active) { mockPanel.active = true; stateChanged(); } }),
	webview: { postMessage: jest.fn(async (_message: any) => true), asWebviewUri: () => 'resource', cspSource: 'resource', html: '', onDidReceiveMessage: (callback: typeof receive) => { receive = callback; return { dispose() {} }; } },
	onDidChangeViewState: (callback: typeof stateChanged) => { stateChanged = callback; return { dispose() {} }; },
	onDidDispose: (callback: typeof disposed) => { disposed = callback; }, dispose() {},
};
jest.mock('vscode', () => ({ window: { registerTreeDataProvider: () => ({ dispose() {} }), createWebviewPanel: () => mockPanel }, commands: { registerCommand: (name: string, callback: any) => { mockCommands.set(name, callback); return { dispose() {} }; } }, workspace: { workspaceFolders: [], onDidChangeWorkspaceFolders: () => ({ dispose() {} }) }, env: { language: 'en' }, Uri: { joinPath: () => ({}) }, ViewColumn: { Active: 1 } }), { virtual: true });
jest.mock('../dashboardRepository', () => ({ readDashboard: (...args: any[]) => mockRead(...args as []), dashboardContains: () => true }));
jest.mock('../preferences', () => ({ getSaveLocationPref: () => '', getVjudgeOjNames: () => ({}) }));
jest.mock('../i18n', () => ({ __esModule: true, default: (_key: string, fallback: string) => fallback }));
import { registerDashboard } from '../webview/DashboardView';
const settle = () => new Promise(resolve => setImmediate(resolve));
test('opening and reactivating Dashboard refreshes once while retaining selected filters and range', async () => {
	registerDashboard({ subscriptions: [], extensionUri: {} } as unknown as import('vscode').ExtensionContext);
	mockCommands.get('judger.openDashboard')!();
	await receive({ command: 'dashboard-load', range: { start: '2024-01-01', end: '2024-01-31' }, filter: { status: 'accepted', source: 'local' } });
	expect(mockRead).toHaveBeenCalledTimes(1);
	mockCommands.get('judger.openDashboard')!(); await settle();
	expect(mockRead).toHaveBeenCalledTimes(2);
	mockPanel.active = false; stateChanged(); await settle();
	expect(mockRead).toHaveBeenCalledTimes(2);
	mockCommands.get('judger.openDashboard')!(); await settle();
	expect(mockRead).toHaveBeenCalledTimes(3);
	stateChanged(); await settle(); expect(mockRead).toHaveBeenCalledTimes(3);
	const data = mockPanel.webview.postMessage.mock.calls.at(-1)?.[0];
	expect(data.data.days[0].date).toBe('2024-01-01');
	expect(data.data.days.at(-1).date).toBe('2024-01-31');
	mockPanel.active = false; stateChanged(); mockPanel.active = true; stateChanged(); await settle();
	expect(mockRead).toHaveBeenCalledTimes(4);
	disposed(); mockCommands.get('judger.refreshDashboard')!(); await settle(); expect(mockRead).toHaveBeenCalledTimes(4);
});

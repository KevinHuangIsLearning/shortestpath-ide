/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('vscode', () => {
	const configuration = { get: (_key: string, fallback: unknown) => fallback };
	return {
		window: { createOutputChannel: () => ({ appendLine() { }, show() { }, hide() { } }) },
		workspace: { getConfiguration: () => configuration },
		env: { language: 'en' },
	};
}, { virtual: true });

test('the real extension entry loads in a fresh host before any commands initialize globals', () => {
	const previousLogger = globalThis.logger;
	const previousLogs = globalThis.storedLogs;
	Reflect.deleteProperty(globalThis, 'logger');
	Reflect.deleteProperty(globalThis, 'storedLogs');
	const log = jest.spyOn(console, 'log').mockImplementation(() => { });
	const vscode = require('vscode') as { workspace: { getConfiguration: () => { get: (key: string, fallback: unknown) => unknown } } };
	const get = jest.spyOn(vscode.workspace.getConfiguration(), 'get');
	try {
		jest.isolateModules(() => {
			const extension = require('../extension') as typeof import('../extension');
			expect(typeof extension.activate).toBe('function');
			expect(get.mock.calls.some(([key]) => key === 'general.defaultOnlineJudge')).toBe(true);
		});
	} finally {
		get.mockRestore();
		log.mockRestore();
		globalThis.logger = previousLogger;
		globalThis.storedLogs = previousLogs;
	}
});

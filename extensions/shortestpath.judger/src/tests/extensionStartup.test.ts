/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('vscode', () => ({
    window: { createOutputChannel: () => ({ appendLine() {}, show() {}, hide() {} }) },
    workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
    env: { language: 'en' },
}), { virtual: true });

test('the real extension entry loads in a fresh host before any commands initialize globals', () => {
    const previousLogger = globalThis.logger;
    const previousLogs = globalThis.storedLogs;
    Reflect.deleteProperty(globalThis, 'logger');
    Reflect.deleteProperty(globalThis, 'storedLogs');
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
        jest.isolateModules(() => {
            const extension = require('../extension') as typeof import('../extension');
            expect(typeof extension.activate).toBe('function');
            expect(globalThis.storedLogs).toContain('general.defaultOnlineJudge');
        });
    } finally {
        log.mockRestore();
        globalThis.logger = previousLogger;
        globalThis.storedLogs = previousLogs;
    }
});

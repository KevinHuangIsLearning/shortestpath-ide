/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import vm from 'vm';
import { webviewBootstrap } from '../webviewBootstrap';

test('webview bootstrap preserves quotes and Windows paths without emitting script terminators or host-only globals', () => {
	const values = { remoteMessage: "'中文</script><script>oops</script>", pythonCommand: 'C:\\Program Files\\Python\\python.exe', translations: { text: '\u2028\u2029' } };
	const window: Record<string, unknown> = {};
	const script = webviewBootstrap(values);
	expect(script).not.toContain('</script>');
	expect(script).not.toContain('logger');
	vm.runInNewContext(script, { window, acquireVsCodeApi: () => ({ postMessage: () => undefined }) });
	expect(JSON.stringify({ ...window, vscodeApi: undefined })).toBe(JSON.stringify(values));
});

import { connectJudgeMessages } from '../webviewBootstrap';
test('first-load handshake receives an immediate reply and disposes the listener', () => {
	const listeners = new Set<(event: MessageEvent) => void>();
	const target = {
		addEventListener: (_name: string, listener: (event: MessageEvent) => void) => listeners.add(listener),
		removeEventListener: (_name: string, listener: (event: MessageEvent) => void) => listeners.delete(listener),
	} as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>;
	const receive = jest.fn();
	const api = { postMessage: jest.fn(() => { for (const listener of listeners) { listener({ data: { command: 'new-problem', problem: { srcPath: '/main.cpp' } } } as MessageEvent); } }) };
	const disconnect = connectJudgeMessages(target, receive, api);
	expect(receive).toHaveBeenCalledTimes(1);
	expect(receive.mock.calls[0][0].data.problem.srcPath).toBe('/main.cpp');
	disconnect();
	expect(listeners.size).toBe(0);
});

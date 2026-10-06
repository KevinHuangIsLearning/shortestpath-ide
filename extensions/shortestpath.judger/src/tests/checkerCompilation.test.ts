jest.mock('vscode', () => ({}), { virtual: true });
jest.mock('../compiler', () => ({ compileFile: jest.fn(async () => false), runningCompilers: [] }));
jest.mock('../preferences', () => ({}));
jest.mock('../config', () => ({ __esModule: true, default: {} }));
jest.mock('../telmetry', () => ({}));
jest.mock('../i18n', () => ({ __esModule: true, default: (_key: string, text: string) => text }));
import { runCustomChecker } from '../executions';
import * as vscode from 'vscode';

test('failed C++ checker compilation returns CE without running the checker', async () => {
	globalThis.extensionContext = { extensionPath: '/extension' } as vscode.ExtensionContext;
	const result = await runCustomChecker('/checker.cpp', '', '', '');
	expect(result.verdict).toBe('CE');
	expect(result.stderr).toBe('Checker compilation failed.');
});

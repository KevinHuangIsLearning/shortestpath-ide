/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('vscode', () => ({ window: {}, workspace: { getConfiguration: jest.fn() } }), { virtual: true });
jest.mock('../i18n', () => ({ __esModule: true, default: (_key: string, fallback: string) => fallback }));

import { workspace } from 'vscode';
import { getCppTemplate, getDefaultLanguageTemplateFileLocation, getShortestPathImportPrefix, getShortestPathImportCategoryEnabled } from '../preferences';

globalThis.logger = { ...console, log: jest.fn() };

test('an unset inline template preserves the legacy template file even when schema lookup returns an empty string', () => {
	(workspace.getConfiguration as jest.Mock).mockReturnValue({
		inspect: () => ({ defaultValue: '' }),
		get: (key: string) => key === 'general.defaultLanguageTemplateFileLocation' ? '/templates/main.cpp' : ''
	});
	expect(getCppTemplate()).toBeNull();
	expect(getDefaultLanguageTemplateFileLocation()).toBe('/templates/main.cpp');
});

test.each(['', 'int main() {}\n'])('an explicitly configured inline template takes precedence, including deliberate emptiness (%p)', template => {
	(workspace.getConfiguration as jest.Mock).mockReturnValue({ inspect: () => ({ globalValue: template }), get: () => template });
	expect(getCppTemplate()).toBe(template);
});


test.each([
	[undefined, undefined, ''],
	[false, 'ShortestPath', ''],
	[true, undefined, ''],
	[true, '', ''],
	[true, 'ShortestPath/solutions', 'ShortestPath/solutions'],
])('ShortestPath import prefix is disabled by default (%p, %p)', (enabled, prefix, expected) => {
	(workspace.getConfiguration as jest.Mock).mockReturnValue({ get: (key: string) => key === 'general.shortestPathImportPrefixEnabled' ? enabled : prefix });
	expect(getShortestPathImportPrefix()).toBe(expected);
});


test.each([[undefined, true], [true, true], [false, false]])('category directories default on and respect an explicit %p', (configured, expected) => {
	(workspace.getConfiguration as jest.Mock).mockReturnValue({ get: () => configured });
	expect(getShortestPathImportCategoryEnabled()).toBe(expected);
});

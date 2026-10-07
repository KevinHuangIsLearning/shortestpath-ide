/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('vscode', () => ({ window: {}, workspace: { getConfiguration: jest.fn() } }), { virtual: true });
jest.mock('../i18n', () => ({ __esModule: true, default: (_key: string, fallback: string) => fallback }));

import { workspace } from 'vscode';
import { getCppTemplate, getDefaultLanguageTemplateFileLocation, getShortestPathFixedTemplate } from '../preferences';

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


test.each([[undefined, true], [true, true], [false, false]])('ShortestPath fixed template defaults to enabled (%p)', (configured, expected) => {
	(workspace.getConfiguration as jest.Mock).mockReturnValue({ get: () => configured });
	expect(getShortestPathFixedTemplate()).toBe(expected);
});

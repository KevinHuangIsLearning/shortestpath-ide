/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('vscode', () => ({ window: {}, workspace: { getConfiguration: jest.fn() } }), { virtual: true });
jest.mock('../i18n', () => ({ __esModule: true, default: (_key: string, fallback: string) => fallback }));

import { workspace } from 'vscode';
import { readFileSync } from 'fs';
import path from 'path';
import { getCppTemplate, getDefaultLanguageTemplateFileLocation, getDefaultProblemSource, getShortestPathFixedTemplate } from '../preferences';
import { getProblemDisplayTarget, getProblemSourceForUrl } from '../problemDisplay';

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

describe('default problem source preferences', () => {
	const originalUrl = 'https://codeforces.com/problemset/problem/1/A';
	const vjudgeUrl = 'https://vjudge.net/problem/CodeForces-1A';

	test('extension and first-run defaults open the original OJ even when VJudge is available', () => {
		const manifest = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
		const defaults = JSON.parse(readFileSync(path.resolve(__dirname, '../../../shortestpath.setup/resources/cph-defaults.json'), 'utf8'));
		const key = 'judger.general.defaultProblemSource';
		expect([
			manifest.contributes.configuration.properties[key].default,
			defaults[key],
		].map(configured => {
			(workspace.getConfiguration as jest.Mock).mockReturnValue({ get: () => configured });
			return getProblemDisplayTarget(true, getDefaultProblemSource(), originalUrl, vjudgeUrl);
		})).toEqual([
			{ source: 'original', url: originalUrl },
			{ source: 'original', url: originalUrl },
		]);
	});

	test.each([undefined, '', 'original'])('uses the original webpage when no VJudge preference is set (%p)', configured => {
		(workspace.getConfiguration as jest.Mock).mockReturnValue({ get: () => configured });
		expect(getProblemDisplayTarget(true, getDefaultProblemSource(), originalUrl, vjudgeUrl)).toEqual({ source: 'original', url: originalUrl });
	});

	test('explicit VJudge mode opens VJudge', () => {
		(workspace.getConfiguration as jest.Mock).mockReturnValue({ get: () => 'vjudge' });
		expect(getProblemDisplayTarget(true, getDefaultProblemSource(), originalUrl, vjudgeUrl)).toEqual({ source: 'vjudge', url: vjudgeUrl });
	});

	test('an OJ can override the original-page default with VJudge', () => {
		(workspace.getConfiguration as jest.Mock).mockReturnValue({ get: () => undefined });
		const source = getProblemSourceForUrl(originalUrl, { 'codeforces.com': { problemSource: 'vjudge' } }, getDefaultProblemSource());
		expect(getProblemDisplayTarget(true, source, originalUrl, vjudgeUrl)).toEqual({ source: 'vjudge', url: vjudgeUrl });
	});
});

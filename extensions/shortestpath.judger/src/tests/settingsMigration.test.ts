/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
jest.mock(
	'vscode',
	() => ({
		workspace: {
			workspaceFolders: [
				{ uri: { toString: () => 'file:///workspace' } },
			],
			getConfiguration: jest.fn(),
		},
		window: { withProgress: jest.fn(async (_options, task) => task()) },
		ProgressLocation: { Notification: 15 },
		ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
	}),
	{ virtual: true },
);
jest.mock('../i18n', () => ({ __esModule: true, default: (_key: string, message: string) => message }));
import * as vscode from 'vscode';
import { migrateSettings } from '../settingsMigration';

describe('settings migration', () => {
	function fixture() {
		const entries = new Map<string, Record<string, unknown>>([
			[
				'cph.general.timeOut',
				{
					globalValue: 4000,
					workspaceValue: 5000,
					workspaceFolderValue: 6000,
				},
			],
			['judger.general.timeOut', { workspaceValue: 7000 }],
		]);
		const languageEntries = new Map<string, Record<string, unknown>>();
		const update = jest.fn(
			async (
				key: string,
				value: unknown,
				target: number,
				override?: boolean,
				languageId?: string,
			) => {
				const field = (
					override
						? [
								'globalLanguageValue',
								'workspaceLanguageValue',
								'workspaceFolderLanguageValue',
						  ]
						: [
								'globalValue',
								'workspaceValue',
								'workspaceFolderValue',
						  ]
				)[target - 1];
				const values = override ? languageEntries : entries;
				const entryKey = override ? `${languageId}:${key}` : key;
				values.set(entryKey, {
					...values.get(entryKey),
					[field]: value,
				});
			},
		);
		(vscode.workspace.getConfiguration as jest.Mock).mockImplementation(
			(_section, scope) => ({
				inspect: (key: string) =>
					scope?.languageId
						? languageEntries.get(`${scope.languageId}:${key}`)
						: entries.get(key),
				update: (
					key: string,
					value: unknown,
					target: number,
					override?: boolean,
				) => update(key, value, target, override, scope?.languageId),
			}),
		);
		const state = { get: jest.fn(() => true), update: jest.fn() };
		const context = {
			globalState: state,
			workspaceState: state,
			extension: {
				packageJSON: {
					contributes: {
						configuration: {
							properties: {
								'judger.general.timeOut': {},
								'judger.general.firstTime': {},
							},
						},
					},
				},
			},
		} as unknown as vscode.ExtensionContext;
		return { context, entries, languageEntries, update, state };
	}
	test('upgrades all scopes despite old markers, preserves newer values, removes old keys and does not restore reset values', async () => {
		const f = fixture();
		await migrateSettings(f.context);
		expect(f.entries.get('judger.general.timeOut')).toEqual({
			globalValue: 4000,
			workspaceValue: 7000,
			workspaceFolderValue: 6000,
		});
		expect(f.entries.get('cph.general.timeOut')).toEqual({
			globalValue: undefined,
			workspaceValue: undefined,
			workspaceFolderValue: undefined,
		});
		expect(f.entries.has('judger.general.firstTime')).toBe(false);
		const calls = f.update.mock.calls.length;
		f.entries.delete('judger.general.timeOut');
		await migrateSettings(f.context);
		expect(f.update).toHaveBeenCalledTimes(calls);
		expect(f.entries.has('judger.general.timeOut')).toBe(false);
	});

	test('a failed new write retains the legacy value for retry', async () => {
		const f = fixture();
		f.update.mockRejectedValueOnce(new Error('write failed'));
		await expect(migrateSettings(f.context)).resolves.toBeUndefined();
		expect(f.entries.get('cph.general.timeOut')?.globalValue).toBe(4000);
		expect(f.entries.get('judger.general.timeOut')?.workspaceFolderValue).toBe(6000);
		await migrateSettings(f.context);
		expect(f.entries.get('judger.general.timeOut')?.globalValue).toBe(4000);
		expect(
			f.entries.get('cph.general.timeOut')?.globalValue,
		).toBeUndefined();
	});

	test('failed cleanup retries without overwriting an updated new value', async () => {
		const f = fixture();
		const original = f.update.getMockImplementation()!;
		f.update
			.mockImplementationOnce(original)
			.mockRejectedValueOnce(new Error('delete failed'));
		await expect(migrateSettings(f.context)).resolves.toBeUndefined();
		expect(f.entries.get('judger.general.timeOut')?.globalValue).toBe(4000);
		expect(f.entries.get('cph.general.timeOut')?.globalValue).toBe(4000);
		f.entries.get('judger.general.timeOut')!.globalValue = 8000;
		await migrateSettings(f.context);
		expect(f.entries.get('judger.general.timeOut')?.globalValue).toBe(8000);
		expect(
			f.entries.get('cph.general.timeOut')?.globalValue,
		).toBeUndefined();
	});

	test('migrates legacy values introduced after an earlier activation', async () => {
		const f = fixture();
		await migrateSettings(f.context);
		f.entries.set('cph.general.firstTime', { globalValue: false });
		await migrateSettings(f.context);
		expect(f.entries.get('judger.general.firstTime')?.globalValue).toBe(
			false,
		);
		expect(
			f.entries.get('cph.general.firstTime')?.globalValue,
		).toBeUndefined();
	});

	test('migrates and cleans language overrides independently at each scope', async () => {
		const f = fixture();
		f.context.extension.packageJSON.contributes.configuration.properties = {
			'judger.compiler': { scope: 'language-overridable' },
		};
		f.entries.set('cph.compiler', { languageIds: ['cpp', 'c'] });
		f.languageEntries.set('cpp:cph.compiler', {
			globalLanguageValue: 'g++',
			workspaceLanguageValue: 'clang++',
			workspaceFolderLanguageValue: 'custom++',
		});
		f.languageEntries.set('cpp:judger.compiler', {
			workspaceLanguageValue: 'new++',
		});
		f.languageEntries.set('c:cph.compiler', { globalLanguageValue: 'gcc' });
		await migrateSettings(f.context);
		expect(f.languageEntries.get('cpp:judger.compiler')).toEqual({
			globalLanguageValue: 'g++',
			workspaceLanguageValue: 'new++',
			workspaceFolderLanguageValue: 'custom++',
		});
		expect(f.languageEntries.get('cpp:cph.compiler')).toEqual({
			globalLanguageValue: undefined,
			workspaceLanguageValue: undefined,
			workspaceFolderLanguageValue: undefined,
		});
		expect(
			f.languageEntries.get('c:judger.compiler')?.globalLanguageValue,
		).toBe('gcc');
		expect(
			f.languageEntries.get('c:cph.compiler')?.globalLanguageValue,
		).toBeUndefined();
	});

	test('retains language values when their new write fails', async () => {
		const f = fixture();
		f.context.extension.packageJSON.contributes.configuration.properties = {
			'judger.compiler': { scope: 'language-overridable' },
		};
		f.entries.set('cph.compiler', { languageIds: ['cpp'] });
		f.languageEntries.set('cpp:cph.compiler', {
			globalLanguageValue: 'clang++',
		});
		f.update.mockRejectedValueOnce(new Error('language write failed'));
		await expect(migrateSettings(f.context)).resolves.toBeUndefined();
		expect(
			f.languageEntries.get('cpp:cph.compiler')?.globalLanguageValue,
		).toBe('clang++');
		await migrateSettings(f.context);
		expect(
			f.languageEntries.get('cpp:cph.compiler')?.globalLanguageValue,
		).toBeUndefined();
	});

	test('does not delete unsupported scopes or unknown legacy settings', async () => {
		const f = fixture();
		f.context.extension.packageJSON.contributes.configuration.properties = {
			'judger.app': { scope: 'application' },
			'judger.resource': { scope: 'resource' },
		};
		f.entries.set('cph.app', {
			globalValue: 'app',
			workspaceValue: 'unsupported',
		});
		f.entries.set('cph.resource', { languageIds: ['cpp'] });
		f.languageEntries.set('cpp:cph.resource', {
			globalLanguageValue: 'unsupported',
		});
		f.entries.set('cph.unknown', { globalValue: 'preserve' });
		await migrateSettings(f.context);
		expect(f.entries.get('judger.app')?.globalValue).toBe('app');
		expect(f.entries.get('cph.app')).toEqual({
			globalValue: undefined,
			workspaceValue: 'unsupported',
		});
		expect(
			f.languageEntries.get('cpp:cph.resource')?.globalLanguageValue,
		).toBe('unsupported');
		expect(f.entries.get('cph.unknown')?.globalValue).toBe('preserve');
	});
	test('shows notification progress only when legacy settings exist', async () => {
		const f = fixture();
		const progress = vscode.window.withProgress as jest.Mock;
		progress.mockClear();
		await migrateSettings(f.context);
		expect(progress).toHaveBeenCalledTimes(1);
		expect(progress.mock.calls[0][0]).toEqual({ location: 15, title: 'Migrating configuration', cancellable: false });
		progress.mockClear();
		await migrateSettings(f.context);
		expect(progress).not.toHaveBeenCalled();
	});

});

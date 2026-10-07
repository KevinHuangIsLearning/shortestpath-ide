/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { createHash } from 'crypto';
import { promises } from 'fs';
import { tmpdir } from 'os';
import { ILanguagePacks } from '../../../nls.js';
import { join } from '../../common/path.js';
import { IResolveNLSConfigurationContext, resolveNLSConfiguration } from '../../node/nls.js';
import { Promises } from '../../node/pfs.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../common/utils.js';
import { getRandomTestPath } from './testUtils.js';

type NLSMetadata = Pick<IResolveNLSConfigurationContext, 'nlsMetadataPath' | 'nlsMetadataHash'>;

suite('NLS configuration', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const commit = 'test-commit';
	const languagePackId = 'test-language-pack.de';
	let testDir: string;
	let userDataPath: string;
	let vscodeDev: string | undefined;

	setup(async () => {
		vscodeDev = process.env['VSCODE_DEV'];
		delete process.env['VSCODE_DEV'];

		testDir = getRandomTestPath(tmpdir(), 'vsctests', 'nls');
		userDataPath = join(testDir, 'user');
		await promises.mkdir(userDataPath, { recursive: true });

		const translationsFile = join(testDir, 'main.i18n.json');
		const languagePacks: ILanguagePacks = {
			de: {
				hash: 'test-language-pack',
				label: 'Deutsch',
				extensions: [],
				translations: { vscode: translationsFile }
			}
		};
		await Promise.all([
			promises.writeFile(join(userDataPath, 'languagepacks.json'), JSON.stringify(languagePacks)),
			promises.writeFile(translationsFile, JSON.stringify({
				contents: {
					'vs/base/test': { first: 'Erste', second: 'Zweite' },
					'vs/workbench/api/common/extHostLogService': { remote: 'Entfernt' }
				}
			}))
		]);
	});

	teardown(async () => {
		if (vscodeDev === undefined) {
			delete process.env['VSCODE_DEV'];
		} else {
			process.env['VSCODE_DEV'] = vscodeDev;
		}
		await Promises.rm(testDir);
	});

	async function writeMetadata(name: string, keys: Array<[string, string[]]>, messages: string[]): Promise<NLSMetadata> {
		const nlsMetadataPath = join(testDir, name);
		await promises.mkdir(nlsMetadataPath, { recursive: true });
		await Promise.all([
			promises.writeFile(join(nlsMetadataPath, 'nls.keys.json'), JSON.stringify(keys)),
			promises.writeFile(join(nlsMetadataPath, 'nls.messages.json'), JSON.stringify(messages))
		]);
		return {
			nlsMetadataPath,
			nlsMetadataHash: createHash('sha256').update(JSON.stringify({ commit, keys, messages })).digest('hex')
		};
	}

	async function resolveMessages(metadata: NLSMetadata) {
		const configuration = await resolveNLSConfiguration({
			userLocale: 'de',
			osLocale: 'de',
			userDataPath,
			commit,
			...metadata
		});
		assert.ok(configuration.languagePack);
		const messages: string[] = JSON.parse(await promises.readFile(configuration.languagePack.messagesFile, 'utf8'));
		return { ...configuration.languagePack, messages };
	}

	async function writeBundledLanguagePack(languageId: string, translatedMessage: string): Promise<string> {
		const extensionsPath = join(testDir, 'extensions');
		const extensionPath = join(extensionsPath, `test-language-pack-${languageId}`);
		await promises.mkdir(extensionPath, { recursive: true });
		await Promise.all([
			promises.writeFile(join(extensionPath, 'package.json'), JSON.stringify({
				publisher: 'test', name: `language-pack-${languageId}`, version: '1.0.0',
				contributes: { localizations: [{ languageId, translations: [{ id: 'vscode', path: './main.i18n.json' }] }] }
			})),
			promises.writeFile(join(extensionPath, 'main.i18n.json'), JSON.stringify({ contents: { 'vs/base/test': { first: translatedMessage } } }))
		]);
		return extensionsPath;
	}

	test('first launch loads the bundled language pack without a user index', async () => {
		await promises.unlink(join(userDataPath, 'languagepacks.json'));
		const builtInExtensionsPath = await writeBundledLanguagePack('zh-cn', '第一');
		const metadata = await writeMetadata('desktop', [['vs/base/test', ['first', 'missing']]], ['First', 'Fallback']);
		const result = await resolveNLSConfiguration({ userLocale: 'zh-cn', osLocale: 'zh-cn', userDataPath, commit, builtInExtensionsPath, ...metadata });
		assert.ok(result.languagePack);
		assert.deepStrictEqual({
			language: result.resolvedLanguage,
			messages: JSON.parse(await promises.readFile(result.languagePack.messagesFile, 'utf8')),
			translations: JSON.parse(await promises.readFile(result.languagePack.translationsConfigFile, 'utf8'))
		}, {
			language: 'zh-cn',
			messages: ['第一', 'Fallback'],
			translations: { vscode: join(builtInExtensionsPath, 'test-language-pack-zh-cn', 'main.i18n.json') }
		});
	});

	test('uses a bundled language absent from an existing index', async () => {
		const builtInExtensionsPath = await writeBundledLanguagePack('zh-cn', '第一');
		const metadata = await writeMetadata('desktop', [['vs/base/test', ['first']]], ['First']);
		const result = await resolveNLSConfiguration({ userLocale: 'zh-cn', osLocale: 'zh-cn', userDataPath, commit, builtInExtensionsPath, ...metadata });
		assert.strictEqual(result.resolvedLanguage, 'zh-cn');
	});

	test('reuses bundled caches and refreshes them when translations change at the same version', async () => {
		await promises.unlink(join(userDataPath, 'languagepacks.json'));
		const builtInExtensionsPath = await writeBundledLanguagePack('zh-cn', '第一');
		const metadata = await writeMetadata('desktop', [['vs/base/test', ['first']]], ['First']);
		const context = { userLocale: 'zh-cn', osLocale: 'zh-cn', userDataPath, commit, builtInExtensionsPath, ...metadata };
		const original = await resolveNLSConfiguration(context);
		assert.ok(original.languagePack);
		await promises.writeFile(original.languagePack.messagesFile, JSON.stringify(['Cached translation']));
		const cached = await resolveNLSConfiguration(context);
		assert.ok(cached.languagePack);
		await writeBundledLanguagePack('zh-cn', '新版翻译');
		const updated = await resolveNLSConfiguration(context);
		assert.ok(updated.languagePack);
		assert.deepStrictEqual({
			reusedCache: original.languagePack.messagesFile === cached.languagePack.messagesFile,
			updatedCache: original.languagePack.messagesFile !== updated.languagePack.messagesFile,
			messages: await Promise.all([cached, updated].map(async result => JSON.parse(await promises.readFile(result.languagePack!.messagesFile, 'utf8'))))
		}, {
			reusedCache: true,
			updatedCache: true,
			messages: [['Cached translation'], ['新版翻译']]
		});
	});

	test('prefers an installed language pack over a bundled one', async () => {
		const builtInExtensionsPath = await writeBundledLanguagePack('de', 'Bundled');
		const metadata = await writeMetadata('desktop', [['vs/base/test', ['first']]], ['First']);
		const result = await resolveNLSConfiguration({ userLocale: 'de-DE', osLocale: 'de', userDataPath, commit, builtInExtensionsPath, ...metadata });
		assert.ok(result.languagePack);
		assert.deepStrictEqual(JSON.parse(await promises.readFile(result.languagePack.messagesFile, 'utf8')), ['Erste']);
	});

	test('falls back to English when bundled language packs are unavailable', async () => {
		await promises.unlink(join(userDataPath, 'languagepacks.json'));
		const metadata = await writeMetadata('desktop', [['vs/base/test', ['first']]], ['First']);
		const builtInExtensionsPath = await writeBundledLanguagePack('zh-cn', '第一');
		await promises.writeFile(join(builtInExtensionsPath, 'test-language-pack-zh-cn', 'package.json'), 'invalid');
		const results = await Promise.all([
			builtInExtensionsPath, join(testDir, 'missing-extensions')
		].map(builtInExtensionsPath => resolveNLSConfiguration({ userLocale: 'zh-cn', osLocale: 'zh-cn', userDataPath, commit, builtInExtensionsPath, ...metadata })));
		assert.deepStrictEqual(results.map(result => [result.userLocale, result.resolvedLanguage]), [['zh-cn', 'en'], ['zh-cn', 'en']]);
	});

	test('an explicit English locale does not load the bundled Chinese pack', async () => {
		const builtInExtensionsPath = await writeBundledLanguagePack('zh-cn', '第一');
		const result = await resolveNLSConfiguration({ userLocale: 'en', osLocale: 'zh-cn', userDataPath, commit, builtInExtensionsPath, nlsMetadataPath: join(testDir, 'missing') });
		assert.deepStrictEqual([result.userLocale, result.resolvedLanguage, result.languagePack], ['en', 'en', undefined]);
	});

	test('switches between server and server-web tables at the same commit', async () => {
		const serverMetadata = await writeMetadata('server', [
			['vs/workbench/api/common/extHostLogService', ['remote']]
		], ['Remote']);
		const serverWebMetadata = await writeMetadata('server-web', [
			['vs/base/test', ['first', 'missing']],
			['vs/workbench/api/common/extHostLogService', ['remote']]
		], ['First', 'Fallback', 'Remote']);

		const server = await resolveMessages(serverMetadata);
		const serverWeb = await resolveMessages(serverWebMetadata);
		const serverAgain = await resolveMessages(serverMetadata);

		assert.deepStrictEqual({
			messages: [server.messages, serverWeb.messages, serverAgain.messages],
			distinctTargetCaches: server.messagesFile !== serverWeb.messagesFile,
			reusedServerCache: server.messagesFile === serverAgain.messagesFile
		}, {
			messages: [['Entfernt'], ['Erste', 'Fallback', 'Entfernt'], ['Entfernt']],
			distinctTargetCaches: true,
			reusedServerCache: true
		});
	});

	test('distinguishes key order when the default messages are identical', async () => {
		const firstMetadata = await writeMetadata('first', [['vs/base/test', ['first', 'second']]], ['Same', 'Same']);
		const secondMetadata = await writeMetadata('second', [['vs/base/test', ['second', 'first']]], ['Same', 'Same']);

		const first = await resolveMessages(firstMetadata);
		const second = await resolveMessages(secondMetadata);

		assert.deepStrictEqual([first.messages, second.messages], [['Erste', 'Zweite'], ['Zweite', 'Erste']]);
	});

	test('refreshes fallback messages after rebuilding at the same commit', async () => {
		const originalMetadata = await writeMetadata('server', [['vs/base/test', ['missing']]], ['Original']);
		const original = await resolveMessages(originalMetadata);
		const updatedMetadata = await writeMetadata('server', [['vs/base/test', ['missing']]], ['Updated']);
		const updated = await resolveMessages(updatedMetadata);

		assert.deepStrictEqual([original.messages, updated.messages], [['Original'], ['Updated']]);
	});

	test('reuses the cache for identical tables in different locations', async () => {
		const firstMetadata = await writeMetadata('first', [['vs/base/test', ['first']]], ['First']);
		const secondMetadata = await writeMetadata('second', [['vs/base/test', ['first']]], ['First']);
		const first = await resolveMessages(firstMetadata);
		await promises.writeFile(first.messagesFile, JSON.stringify(['Cached translation']));
		const second = await resolveMessages(secondMetadata);

		assert.deepStrictEqual({
			sameCache: first.messagesFile === second.messagesFile,
			messages: second.messages
		}, {
			sameCache: true,
			messages: ['Cached translation']
		});
	});

	test('a cache hit does not read the NLS tables', async () => {
		const metadata = await writeMetadata('server', [['vs/base/test', ['first']]], ['First']);
		const first = await resolveMessages(metadata);
		await Promise.all([
			promises.unlink(join(metadata.nlsMetadataPath, 'nls.keys.json')),
			promises.unlink(join(metadata.nlsMetadataPath, 'nls.messages.json'))
		]);
		const cached = await resolveMessages(metadata);

		assert.deepStrictEqual({
			sameCache: first.messagesFile === cached.messagesFile,
			messages: cached.messages
		}, {
			sameCache: true,
			messages: ['Erste']
		});
	});

	test('does not reuse or overwrite a legacy commit-only cache', async () => {
		const legacyCachePath = join(userDataPath, 'clp', languagePackId, commit);
		await promises.mkdir(legacyCachePath, { recursive: true });
		const legacyMessagesFile = join(legacyCachePath, 'nls.messages.json');
		await promises.writeFile(legacyMessagesFile, JSON.stringify(['Legacy translation']));
		const metadata = await writeMetadata('server', [['vs/base/test', ['first']]], ['First']);
		const result = await resolveMessages(metadata);

		assert.deepStrictEqual({
			messages: result.messages,
			separateCache: result.messagesFile !== legacyMessagesFile,
			legacy: JSON.parse(await promises.readFile(legacyMessagesFile, 'utf8'))
		}, {
			messages: ['Erste'],
			separateCache: true,
			legacy: ['Legacy translation']
		});
	});

	test('preserves the legacy cache path for products without an identity', async () => {
		const metadata = await writeMetadata('server', [['vs/base/test', ['first']]], ['First']);
		const result = await resolveMessages({ nlsMetadataPath: metadata.nlsMetadataPath });

		assert.deepStrictEqual({
			messages: result.messages,
			messagesFile: result.messagesFile
		}, {
			messages: ['Erste'],
			messagesFile: join(userDataPath, 'clp', languagePackId, commit, 'nls.messages.json')
		});
	});

	test('regenerates all table caches after a corruption marker', async () => {
		const firstMetadata = await writeMetadata('first', [['vs/base/test', ['first']]], ['First']);
		const secondMetadata = await writeMetadata('second', [['vs/base/test', ['second']]], ['Second']);
		const first = await resolveMessages(firstMetadata);
		const second = await resolveMessages(secondMetadata);
		await promises.writeFile(first.corruptMarkerFile, 'corrupt');
		const regenerated = await resolveMessages(firstMetadata);

		assert.deepStrictEqual({
			messages: regenerated.messages,
			secondCacheExists: await Promises.exists(second.messagesFile),
			translationsConfigExists: await Promises.exists(regenerated.translationsConfigFile)
		}, {
			messages: ['Erste'],
			secondCacheExists: false,
			translationsConfigExists: true
		});
	});

	test('does not require NLS metadata for the default locale', async () => {
		const nlsMetadataPath = join(testDir, 'missing');
		const result = await resolveNLSConfiguration({ userLocale: 'en', osLocale: 'en', userDataPath, commit, nlsMetadataPath });

		assert.deepStrictEqual(result, {
			userLocale: 'en',
			osLocale: 'en',
			resolvedLanguage: 'en',
			defaultMessagesFile: join(nlsMetadataPath, 'nls.messages.json'),
			locale: 'en',
			availableLanguages: {}
		});
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, notStrictEqual, strictEqual } from 'assert';
import { promises } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../common/path.js';
import { resolveNLSConfiguration } from '../../node/nls.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../common/utils.js';

suite('Development NLS configuration', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('invalidates translated caches when development keys, fallback messages or bundled translations change', async () => {
		const root = await promises.mkdtemp(join(tmpdir(), 'spide-nls-'));
		try {
			const metadata = join(root, 'out');
			const extension = join(root, 'extensions', 'MS-CEINTL.vscode-language-pack-zh-hans');
			await promises.mkdir(metadata, { recursive: true });
			await promises.mkdir(extension, { recursive: true });
			await promises.writeFile(join(extension, 'package.json'), JSON.stringify({ version: '1.0.0', contributes: { localizations: [{ languageId: 'zh-cn', translations: [{ id: 'vscode', path: 'main.json' }] }] } }));
			const writeMetadata = async (keys: string[], messages: string[]) => {
				await promises.writeFile(join(metadata, 'nls.keys.json'), JSON.stringify([['module', keys]]));
				await promises.writeFile(join(metadata, 'nls.messages.json'), JSON.stringify(messages));
			};
			const writeTranslations = (value: string) => promises.writeFile(join(extension, 'main.json'), JSON.stringify({ contents: { module: { translated: value } } }));
			const context = { userLocale: 'zh-cn', osLocale: 'zh-cn', userDataPath: join(root, 'profile'), nlsMetadataPath: metadata, commit: undefined };
			const read = async () => {
				const config = await resolveNLSConfiguration(context);
				strictEqual(config.resolvedLanguage, 'zh-cn');
				const file = config.languagePack!.messagesFile;
				return { file, messages: JSON.parse(await promises.readFile(file, 'utf8')) };
			};
			await writeMetadata(['translated', 'fallback'], ['Translated', 'Fallback']);
			await writeTranslations('中文');
			const first = await read();
			deepStrictEqual(first.messages, ['中文', 'Fallback']);
			strictEqual((await read()).file, first.file);
			await writeMetadata(['fallback', 'translated'], ['Updated fallback', 'Translated']);
			const reordered = await read();
			notStrictEqual(reordered.file, first.file);
			deepStrictEqual(reordered.messages, ['Updated fallback', '中文']);
			await writeTranslations('新版中文');
			const updated = await read();
			notStrictEqual(updated.file, reordered.file);
			deepStrictEqual(updated.messages, ['Updated fallback', '新版中文']);
			const english = await resolveNLSConfiguration({ ...context, userLocale: 'en' });
			strictEqual(english.resolvedLanguage, 'en');
			strictEqual(english.languagePack, undefined);
		} finally {
			await promises.rm(root, { recursive: true, force: true });
		}
	});
});

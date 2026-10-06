/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import type { Plugin } from 'vite';
import { analyzeLocalizeCalls, parseLocalizeKeyOrValue, TextModel } from '../lib/nls-analysis.ts';

/** Use the desktop build's NLS indices while Vite serves TypeScript sources. */
export function desktopNlsPlugin(root: string): Plugin {
	const readMetadata = () => {
		const keySource = readFileSync(join(root, 'out/nls.keys.json'), 'utf8');
		const messageSource = readFileSync(join(root, 'out/nls.messages.json'), 'utf8');
		const keys: [string, (string | { key: string })[]][] = JSON.parse(keySource);
		const messages: string[] = JSON.parse(messageSource);
		const indices = new Map<string, number>();
		let index = 0;
		for (const [moduleId, moduleKeys] of keys) {
			for (const key of moduleKeys) {
				indices.set(`${moduleId}#${typeof key === 'string' ? key : key.key}`, index++);
			}
		}
		if (index !== messages.length) { throw new Error('Development NLS metadata is incomplete'); }
		return { keys, messages, indices, hash: createHash('sha256').update(keySource).update(messageSource).digest('hex') };
	};
	let metadata = readMetadata();

	return {
		name: 'desktop-nls',
		enforce: 'pre',
		configureServer(server) {
			server.middlewares.use((request, response, next) => {
				const url = new URL(request.url ?? '/', 'http://localhost');
				if (url.pathname !== '/@shortestpath/nls') { next(); return; }
				try {
					// Electron's main process retains its startup message table across window reloads.
					// Refresh both Vite transforms and renderer messages from the same build metadata.
					const updated = readMetadata();
					if (updated.hash !== metadata.hash) {
						metadata = updated;
						server.moduleGraph.invalidateAll();
					}
					const language = url.searchParams.get('language') ?? 'en';
					const translations = readTranslations(root, language);
					const messages = metadata.messages.slice();
					let index = 0;
					for (const [moduleId, keys] of metadata.keys) {
						for (const key of keys) {
							messages[index] = translations[moduleId]?.[typeof key === 'string' ? key : key.key] || messages[index];
							index++;
						}
					}
					response.setHeader('Content-Type', 'application/json');
					response.setHeader('Cache-Control', 'no-store');
					response.end(JSON.stringify({ messages, language }));
				} catch {
					response.statusCode = 503;
					response.end('Development NLS metadata is unavailable. Wait for the build to finish.');
				}
			});
		},
		transform(source, id) {
			if (!id.endsWith('.ts') || !source.includes('localize')) {
				return;
			}
			const moduleId = relative(join(root, 'src'), id).replaceAll('\\', '/').replace(/\.ts$/, '');
			const calls = [...analyzeLocalizeCalls(source, 'localize'), ...analyzeLocalizeCalls(source, 'localize2')];
			calls.sort((a, b) => b.keySpan.start.line - a.keySpan.start.line || b.keySpan.start.character - a.keySpan.start.character);
			const model = new TextModel(source);
			let changed = false;
			for (const call of calls) {
				const key = parseLocalizeKeyOrValue(call.key);
				const index = metadata.indices.get(`${moduleId}#${typeof key === 'string' ? key : key.key}`);
				// New or changed messages use their source fallback until the next localized build.
				if (index !== undefined && metadata.messages[index] === parseLocalizeKeyOrValue(call.value)) {
					model.apply(call.keySpan, String(index));
					changed = true;
				}
			}
			return changed ? { code: model.toString(), map: null } : undefined;
		}
	};
}

function readTranslations(root: string, language: string): Record<string, Record<string, string>> {
	if (language === 'en' || language === 'pseudo' || language.startsWith('en-')) { return {}; }
	for (const extension of readdirSync(join(root, 'extensions'), { withFileTypes: true })) {
		if (!extension.isDirectory() || !extension.name.includes('language-pack')) { continue; }
		try {
			const extensionRoot = join(root, 'extensions', extension.name);
			const manifest = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8'));
			const localization = manifest.contributes?.localizations?.find((item: { languageId: string }) => item.languageId.toLowerCase() === language.toLowerCase());
			const translation = localization?.translations?.find((item: { id: string }) => item.id === 'vscode');
			if (translation) { return JSON.parse(readFileSync(join(extensionRoot, translation.path), 'utf8')).contents ?? {}; }
		} catch {
			// Other extensions and unavailable language packs use source fallback messages.
		}
	}
	return {};
}

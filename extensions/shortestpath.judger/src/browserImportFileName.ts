/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import path from 'path';
import localize from './i18n';

/** Browser imports request one filename, rather than an arbitrary path. */
export function normalizeBrowserImportFileName(value: string, extension: string): string {
	const trimmed = value.trim();
	return path.extname(trimmed) ? trimmed : `${trimmed}.${extension}`;
}

export function validateBrowserImportFileName(value: string, extension: string): string | undefined {
	const trimmed = value.trim();
	if (!trimmed || trimmed === '.' || trimmed === '..' || /[\\/:<>"|?*\x00-\x1f]/.test(trimmed) || /[. ]$/.test(trimmed) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(trimmed)) {
		return localize('judger.browserImport.invalidFileName', 'Enter a valid filename without a directory.');
	}
	if (path.extname(trimmed) && path.extname(trimmed) !== `.${extension}`) {
		return localize('judger.browserImport.fileExtension', 'Use the .{0} extension for the selected language.', extension);
	}
	return undefined;
}

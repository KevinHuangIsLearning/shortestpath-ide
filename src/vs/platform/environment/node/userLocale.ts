/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Language tags are case insensitive, but the ESM loader is case sensitive.
 * Normalize them while preserving the command-line, persisted, default priority.
 */
export function resolveUserLocale(commandLineLocale: string | undefined, configuredLocale: unknown, defaultLocale: string): string {
	if (commandLineLocale) {
		return commandLineLocale.toLowerCase();
	}

	if (typeof configuredLocale === 'string' && configuredLocale) {
		return configuredLocale.toLowerCase();
	}

	return defaultLocale.toLowerCase();
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
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

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const browserDarkReaderModeSetting = 'workbench.browser.darkReader.mode';
export const browserDarkReaderDetectDarkThemeSetting = 'workbench.browser.darkReader.detectDarkTheme';
export const browserDarkReaderExcludedHostsSetting = 'workbench.browser.darkReader.excludedHosts';

export type BrowserDarkReaderMode = 'off' | 'on' | 'auto';

export interface IBrowserDarkReaderConfiguration {
	readonly enabled: boolean;
	readonly detectDarkTheme?: boolean;
	readonly excludedHosts: readonly string[];
}

export interface IBrowserDarkReaderResource {
	readonly body: Uint8Array;
	readonly contentType: string;
}

/** Exact hostname matching keeps a site's choice independent of its subdomains. */
export function browserDarkReaderHostname(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.hostname.toLowerCase().replace(/\.$/, '') : undefined;
	} catch {
		return undefined;
	}
}

export function isBrowserDarkReaderEnabled(url: string, configuration: IBrowserDarkReaderConfiguration): boolean {
	const hostname = browserDarkReaderHostname(url);
	return !!hostname && configuration.enabled && !configuration.excludedHosts.some(host => host.trim().toLowerCase().replace(/\.$/, '') === hostname);
}

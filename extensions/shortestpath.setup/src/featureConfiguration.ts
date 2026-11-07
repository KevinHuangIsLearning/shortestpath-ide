/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface RemoteFeatureConfiguration {
	homepage: boolean;
}

/** A valid response owns the flags, including false; only failed sources fall back. */
export async function fetchFeatureConfiguration(urls: readonly string[]): Promise<RemoteFeatureConfiguration> {
	for (const url of urls) {
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
			if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
			const value: unknown = await response.json();
			if (!value || typeof value !== 'object' || Array.isArray(value)) { throw new Error('Invalid feature configuration'); }
			return { homepage: (value as Record<string, unknown>).homepage === true };
		} catch { /* Try the next source; failure never enables a feature. */ }
	}
	return { homepage: false };
}

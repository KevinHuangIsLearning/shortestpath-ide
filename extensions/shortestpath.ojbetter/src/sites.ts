/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type Platform = 'atcoder' | 'codeforces';

/** Match only the upstream sites, including Codeforces' official mirror. */
export function platformForUrl(value: string): Platform | undefined {
	try {
		const url = new URL(value);
		if (!['http:', 'https:'].includes(url.protocol)) {
			return undefined;
		}
		if (url.hostname === 'atcoder.jp') {
			return 'atcoder';
		}
		if (['codeforces.com', 'codeforc.es'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
			return 'codeforces';
		}
	} catch { /* Not a web URL. */ }
	return undefined;
}

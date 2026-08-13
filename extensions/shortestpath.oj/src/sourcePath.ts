/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Checks whether a source path can safely be sent as an HTTP header value.
 *
 * Windows paths may contain a drive-letter colon and backslashes, both of which
 * are valid header-value characters. Node rejects HTTP control characters and
 * characters outside Latin-1 before the request is sent.
 */
export function isHeaderSafeSourcePath(value: string): boolean {
	return !/[\u0000-\u0008\u000A-\u001F\u007F-\u009F\u0100-\uFFFF]/.test(value);
}

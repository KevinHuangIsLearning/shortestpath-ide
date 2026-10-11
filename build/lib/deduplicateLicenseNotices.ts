/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Keep every distinct Chromium notice verbatim and link identical notices to it. */
export function deduplicateLicenseNotices(contents: Buffer): Buffer {
	const source = contents.toString('utf8');
	// Do not collide with IDs supplied by a future upstream credits generator.
	if (source.includes('shortestpath-license-')) { return contents; }
	const notices = new Map<string, string>();
	const output = source.replace(/<pre>([\s\S]*?)<\/pre>/g, (_block: string, notice: string) => {
		const existing = notices.get(notice);
		if (existing) {
			// The link label is an unchanged line from the upstream notice. No
			// attribution or license text is synthesized or combined here.
			const label = notice.split('\n').find(line => line.trim()) ?? '';
			return `<a href="#${existing}"><pre>${label}</pre></a>`;
		}
		const id = `shortestpath-license-${notices.size}`;
		notices.set(notice, id);
		return `<pre id="${id}">${notice}</pre>`;
	});
	const result = Buffer.from(output);
	return result.length < contents.length ? result : contents;
}

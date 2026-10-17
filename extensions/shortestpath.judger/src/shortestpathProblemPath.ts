/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';

/** Fixed workspace-relative C++ paths for supported ShortestPath pages. */
export function getShortestPathProblemPath(problemUrl: string, title: string, prefix = '', includeCategory = true, developmentOrigin?: string): string | undefined {
	let url: URL;
	try { url = new URL(problemUrl); } catch { return undefined; }
	const isDevelopmentOrigin = url.origin === developmentOrigin && ['http:', 'https:'].includes(url.protocol)
		&& ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
	if (url.origin !== 'https://shortestpath.cn' && !isDevelopmentOrigin) { return undefined; }
	let parts: string[];
	try { parts = url.pathname.replace(/\/$/, '').split('/').slice(1).map(decodeURIComponent); } catch { return undefined; }
	let directories: string[];
	let label: string;
	if (parts.length === 4 && parts[0] === 'problem' && ['found', 'adv', 'chal', 'past'].includes(parts[2])) {
		directories = includeCategory ? [parts[1], parts[2]] : [parts[1]];
		label = parts[3];
	} else if (parts.length === 4 && parts[0] === 'upsolving' && ['at', 'cf'].includes(parts[1])) {
		directories = ['contest', parts[2]];
		label = parts[3];
	} else if (parts.length === 3 && parts[0] === 'upsolving' && parts[1] === 'id' && /^[1-9]\d*$/.test(parts[2])) {
		directories = ['upsolving'];
		label = parts[2];
	} else {
		return undefined;
	}
	const prefixDirectories = prefix.trim().split(/[/\\]/).filter(Boolean).map(fileComponent);
	return path.join(...prefixDirectories, ...directories.map(fileComponent), `${fileComponent(label)}_${fileComponent(title)}.cpp`);
}

// Keep Chinese and spaces, replacing only characters unusable on Windows/macOS.
function fileComponent(value: string): string {
	const component = value.replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/g, '_').replace(/[ .]+$/, '') || '_';
	return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(component) ? `_${component}` : component;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface HomepageServer {
	listen(port: number): Promise<string>;
	close(): Promise<void>;
}

export function createHomepageServer(options: {
	dataDir: string;
	sourceUrl: string;
	fallbackSourceUrl?: string;
	localHtmlPath?: string;
	getData(): Promise<object>;
	getTheme(): PromiseLike<string | undefined>;
	executeCommand(command: string, args: readonly string[]): Promise<void>;
}): Promise<HomepageServer>;

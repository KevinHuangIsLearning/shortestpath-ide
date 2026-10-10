/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Memento } from 'vscode';
import type { Storage } from './integration';
import type { Platform } from './sites';

/** Keep userscript preferences outside site localStorage and workspace-controlled settings. */
export class Preferences implements Storage {
	private readonly values: Record<Platform, Record<string, unknown>>;
	private queue: Promise<void> = Promise.resolve();

	constructor(private readonly memento: Memento) {
		this.values = {
			atcoder: Object.assign(Object.create(null), memento.get('atcoder', {})),
			codeforces: Object.assign(Object.create(null), memento.get('codeforces', {}))
		};
	}

	get(platform: Platform): Record<string, unknown> {
		return { ...this.values[platform] };
	}

	write(platform: Platform, key: string, value: unknown, remove: boolean): Promise<void> {
		const write = async () => {
			const updated = { ...this.values[platform] };
			if (remove) {
				delete updated[key];
			} else {
				updated[key] = value;
			}
			await this.memento.update(platform, updated);
			this.values[platform] = updated;
		};
		const result = this.queue.then(write);
		this.queue = result.catch(() => { });
		return result;
	}
}

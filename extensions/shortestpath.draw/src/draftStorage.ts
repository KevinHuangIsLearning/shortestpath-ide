/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DraftSnapshot, isDraftSnapshot } from './protocol';

/** A failed write must leave the previous draft intact and must not poison later saves. */
export class DraftStorage {
	private pending: Promise<void> = Promise.resolve();
	constructor(private readonly folder: string) { }

	async read(): Promise<DraftSnapshot | undefined> {
		await this.pending;
		try {
			const snapshot = JSON.parse(await fs.readFile(path.join(this.folder, 'draft.json'), 'utf8'));
			if (!isDraftSnapshot(snapshot)) { throw new Error('Invalid sketchpad data'); }
			return snapshot;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return undefined; }
			throw error;
		}
	}

	save(snapshot: DraftSnapshot): Promise<void> {
		const write = this.pending.then(async () => {
			if (!isDraftSnapshot(snapshot)) { throw new Error('Invalid sketchpad data'); }
			await fs.mkdir(this.folder, { recursive: true });
			const temporary = path.join(this.folder, `draft-${randomUUID()}.tmp`);
			try {
				await fs.writeFile(temporary, JSON.stringify(snapshot), 'utf8');
				await fs.rename(temporary, path.join(this.folder, 'draft.json'));
			} finally {
				await fs.rm(temporary, { force: true });
			}
		});
		this.pending = write.catch(() => { });
		return write;
	}

	flush(): Promise<void> { return this.pending; }
}

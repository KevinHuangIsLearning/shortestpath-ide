/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DraftStorage } from './draftStorage';
import { DraftSnapshot, DrawingEntry, DrawingFileState, isDraftSnapshot } from './protocol';

interface StoredEntry extends DrawingEntry { readonly snapshot?: DraftSnapshot }
interface Catalog { readonly version: 1; readonly active: string; readonly entries: readonly StoredEntry[] }

/** An atomic catalog keeps folder operations and drawings together inside IDE storage. */
export class DrawingFiles {
	private catalog: Catalog | undefined;
	constructor(private readonly folder: string, private readonly defaultName: string) { }

	async load(): Promise<DraftSnapshot | undefined> {
		if (!this.catalog) {
			try {
				const data = JSON.parse(await fs.readFile(path.join(this.folder, 'files.json'), 'utf8')) as Catalog;
				this.validate(data);
				this.catalog = data;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
				// Read the legacy draft before writing anything; damaged drafts remain recoverable.
				const snapshot = await new DraftStorage(this.folder).read();
				await this.commit({ version: 1, active: 'draft', entries: [{ id: 'draft', parent: '', name: this.defaultName, kind: 'file', snapshot }] });
			}
		}
		return this.catalog!.entries.find(entry => entry.id === this.catalog!.active)!.snapshot;
	}

	state(): DrawingFileState {
		return { active: this.catalog!.active, entries: this.catalog!.entries.map(({ id, parent, name, kind }) => ({ id, parent, name, kind })) };
	}

	snapshot(id = this.catalog!.active): DraftSnapshot | undefined {
		const entry = this.entry(id);
		if (entry.kind !== 'file') { throw new Error('Invalid drawing'); }
		return entry.snapshot;
	}

	async save(snapshot: DraftSnapshot, id = this.catalog!.active): Promise<void> {
		this.snapshot(id);
		if (!isDraftSnapshot(snapshot)) { throw new Error('Invalid drawing'); }
		await this.commit({ ...this.catalog!, entries: this.catalog!.entries.map(entry => entry.id === id ? { ...entry, snapshot } : entry) });
	}

	async open(id: string): Promise<DraftSnapshot | undefined> {
		const entry = this.entry(id);
		if (entry.kind !== 'file') { throw new Error('Invalid drawing'); }
		await this.commit({ ...this.catalog!, active: id });
		return entry.snapshot;
	}

	async create(parent: string, name: string, kind: 'file' | 'folder', snapshot?: DraftSnapshot): Promise<void> {
		this.checkParent(parent);
		this.checkName(name, parent);
		const id = randomUUID();
		await this.commit({ ...this.catalog!, active: kind === 'file' ? id : this.catalog!.active, entries: [...this.catalog!.entries, { id, parent, name, kind, snapshot }] });
	}

	async rename(id: string, name: string): Promise<void> {
		const entry = this.entry(id);
		this.checkName(name, entry.parent, id);
		await this.commit({ ...this.catalog!, entries: this.catalog!.entries.map(entry => entry.id === id ? { ...entry, name } : entry) });
	}

	async move(id: string, parent: string): Promise<void> {
		const entry = this.entry(id);
		this.checkParent(parent);
		for (let ancestor = parent; ancestor; ancestor = this.entry(ancestor).parent) {
			if (ancestor === id) { throw new Error('Invalid folder'); }
		}
		this.checkName(entry.name, parent, id);
		await this.commit({ ...this.catalog!, entries: this.catalog!.entries.map(entry => entry.id === id ? { ...entry, parent } : entry) });
	}

	async remove(id: string): Promise<boolean> {
		this.entry(id);
		const removed = new Set([id]);
		for (let changed = true; changed;) {
			changed = false;
			for (const entry of this.catalog!.entries) {
				if (removed.has(entry.parent) && !removed.has(entry.id)) { removed.add(entry.id); changed = true; }
			}
		}
		const entries = this.catalog!.entries.filter(entry => !removed.has(entry.id));
		const switched = removed.has(this.catalog!.active);
		let active = this.catalog!.active;
		if (switched) {
			active = entries.find(entry => entry.kind === 'file')?.id ?? randomUUID();
			if (!entries.some(entry => entry.id === active)) {
				let name = this.defaultName;
				for (let suffix = 2; entries.some(entry => entry.parent === '' && entry.name.toLowerCase() === name.toLowerCase()); suffix++) { name = `${this.defaultName} ${suffix}`; }
				entries.push({ id: active, parent: '', name, kind: 'file' });
			}
		}
		await this.commit({ ...this.catalog!, active, entries });
		return switched;
	}

	private entry(id: string): StoredEntry {
		const entry = this.catalog!.entries.find(entry => entry.id === id);
		if (!entry) { throw new Error('Drawing no longer exists'); }
		return entry;
	}
	private checkParent(id: string): void { if (id && this.entry(id).kind !== 'folder') { throw new Error('Invalid folder'); } }
	private checkName(name: string, parent: string, except?: string): void {
		if (!name.trim() || name !== name.trim() || name.length > 128 || /[\\/\x00-\x1f]/.test(name) || name === '.' || name === '..') { throw new Error('Invalid name'); }
		if (this.catalog!.entries.some(entry => entry.parent === parent && entry.id !== except && entry.name.toLowerCase() === name.toLowerCase())) { throw new Error('Name already exists'); }
	}
	private validate(data: Catalog): void {
		if (data?.version !== 1 || !Array.isArray(data.entries) || !data.entries.length) { throw new Error('Invalid drawing catalog'); }
		const ids = new Set<string>();
		const names = new Set<string>();
		for (const entry of data.entries) {
			if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id) || typeof entry.parent !== 'string' || typeof entry.name !== 'string' || !['file', 'folder'].includes(entry.kind) || (entry.snapshot !== undefined && (entry.kind !== 'file' || !isDraftSnapshot(entry.snapshot)))) { throw new Error('Invalid drawing catalog'); }
			const key = JSON.stringify([entry.parent, entry.name.toLowerCase()]);
			if (!entry.name.trim() || entry.name !== entry.name.trim() || entry.name.length > 128 || /[\\/\x00-\x1f]/.test(entry.name) || entry.name === '.' || entry.name === '..' || names.has(key)) { throw new Error('Invalid drawing catalog'); }
			ids.add(entry.id); names.add(key);
		}
		for (const entry of data.entries) {
			const seen = new Set([entry.id]);
			for (let parent = entry.parent; parent;) {
				const folder = data.entries.find(candidate => candidate.id === parent);
				if (!folder || folder.kind !== 'folder' || seen.has(parent)) { throw new Error('Invalid drawing catalog'); }
				seen.add(parent); parent = folder.parent;
			}
		}
		if (!data.entries.some(entry => entry.id === data.active && entry.kind === 'file')) { throw new Error('Invalid drawing catalog'); }
	}
	private async commit(catalog: Catalog): Promise<void> {
		await fs.mkdir(this.folder, { recursive: true });
		const temporary = path.join(this.folder, `files-${randomUUID()}.tmp`);
		try {
			await fs.writeFile(temporary, JSON.stringify(catalog), 'utf8');
			await fs.rename(temporary, path.join(this.folder, 'files.json'));
			this.catalog = catalog;
		} finally { await fs.rm(temporary, { force: true }); }
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type WorkspaceCacheMigration<T> = {
	readLegacy(): Promise<T | undefined>;
	readCurrent(): Promise<T>;
	merge(current: T, legacy: T): T;
	writeCurrent(cache: T): Promise<void>;
	deleteLegacy(): Promise<void>;
};

export async function migrateLegacyWorkspaceCache<T>(migration: WorkspaceCacheMigration<T>): Promise<boolean> {
	const current = await migration.readCurrent();
	const legacy = await migration.readLegacy();
	if (!legacy) {
		return false;
	}
	const merged = migration.merge(current, legacy);
	await migration.writeCurrent(merged);
	await migration.deleteLegacy();
	return true;
}

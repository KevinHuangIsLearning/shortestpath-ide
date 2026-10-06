/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger. Licensed under GPL-3.0-or-later.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';

type Lease = { users: number; timer?: NodeJS.Timeout };
const leases = new Map<string, Lease>();

/** Hold generated artifacts throughout compilation and the entire run, including run-all. */
export function retainExecutable(binary: string, source: string): { dispose(): void } {
	if (path.resolve(binary) === path.resolve(source)) { return { dispose() {} }; }
	const lease = leases.get(binary) ?? { users: 0 };
	leases.set(binary, lease);
	clearTimeout(lease.timer);
	lease.users++;
	let disposed = false;
	return { dispose() {
		if (disposed) { return; }
		disposed = true;
		if (--lease.users > 0) { return; }
		const config = vscode.workspace.getConfiguration('shortestpath', vscode.Uri.file(source));
		if (!config.get<boolean>('executableCleanupEnabled', true)) { leases.delete(binary); return; }
		const seconds = config.get<number>('executableCleanupDelaySeconds', 60);
		const delay = Math.max(0, Math.min(86400, Number.isFinite(seconds) ? Math.floor(seconds) : 60)) * 1000;
		const files = binary.endsWith('*.class')
			? fs.existsSync(path.dirname(binary)) ? fs.readdirSync(path.dirname(binary)).filter(name => name === `${path.parse(source).name}.class` || name.startsWith(`${path.parse(source).name}$`) && name.endsWith('.class')).map(name => path.join(path.dirname(binary), name)) : []
			: [binary];
		const versions = files.flatMap(file => {
			try { const stat = fs.statSync(file); return [{ file, mtimeMs: stat.mtimeMs, size: stat.size, ino: stat.ino }]; }
			catch { return []; }
		});
		const remove = () => {
			if (lease.users > 0) { return; }
			if (!vscode.workspace.getConfiguration('shortestpath', vscode.Uri.file(source)).get<boolean>('executableCleanupEnabled', true)) { leases.delete(binary); return; }
			for (const version of versions) {
				try {
					const stat = fs.statSync(version.file);
					if (stat.mtimeMs !== version.mtimeMs || stat.size !== version.size || stat.ino !== version.ino) { continue; }
					fs.rmSync(version.file, { recursive: stat.isDirectory(), force: true });
					fs.rmSync(`${version.file}.dSYM`, { recursive: true, force: true });
				} catch (error) {
					const code = (error as NodeJS.ErrnoException).code;
					if (['EBUSY', 'EPERM', 'EACCES'].includes(code ?? '')) { lease.timer = setTimeout(remove, 2000); lease.timer.unref(); return; }
					if (code !== 'ENOENT') { globalThis.logger?.warn('Could not clean generated executable', error); }
				}
			}
			leases.delete(binary);
		};
		lease.timer = setTimeout(remove, delay);
		lease.timer.unref();
	} };
}

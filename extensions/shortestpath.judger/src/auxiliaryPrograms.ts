/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import os from 'os';
import path from 'path';
import { compileFile } from './compiler';

/** Run-scoped artifacts, following CPH-NG's compile-once judge preparation. */
export class AuxiliaryPrograms {
	private directory?: string;
	private readonly programs = new Map<string, Promise<string>>();

	public prepare(source: string, checkCancelled?: () => void): Promise<string> {
		checkCancelled?.();
		if (!/\.(cpp|cc|cxx)$/i.test(source)) { return Promise.resolve(source); }
		let program = this.programs.get(source);
		if (!program) {
			this.directory ??= fs.mkdtempSync(path.join(os.tmpdir(), 'judger-tools-'));
			const binary = path.join(this.directory, `tool-${this.programs.size}${process.platform === 'win32' ? '.exe' : ''}`);
			program = (async () => {
				if (!await compileFile(source, { outputPath: binary, silent: true, additionalArgs: ['-I', path.join(globalThis.extensionContext.extensionPath, 'dist/static/testlib')] })) {
					checkCancelled?.();
					throw new Error('CE');
				}
				checkCancelled?.();
				return binary;
			})();
			this.programs.set(source, program);
		}
		return program;
	}

	public dispose(): void {
		if (this.directory) { fs.rmSync(this.directory, { recursive: true, force: true }); }
	}
}

/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
jest.mock('../compiler', () => ({ compileFile: jest.fn() }));
import { compileFile } from '../compiler';
import { AuxiliaryPrograms } from '../auxiliaryPrograms';

test('one run shares each auxiliary compilation and deletes its artifacts on disposal', async () => {
	globalThis.extensionContext = { extensionPath: '/extension' } as typeof globalThis.extensionContext;
	(compileFile as jest.Mock).mockImplementation(async (_source, options) => { fs.writeFileSync(options.outputPath, 'binary'); return true; });
	const programs = new AuxiliaryPrograms();
	let binary = '';
	try {
		binary = await programs.prepare('/checker.cpp');
		expect(await programs.prepare('/checker.cpp')).toBe(binary);
		await Promise.all([programs.prepare('/interactor.cpp'), programs.prepare('/interactor.cpp')]);
		expect(compileFile).toHaveBeenCalledTimes(2);
		expect(fs.existsSync(binary)).toBe(true);
	} finally { programs.dispose(); }
	expect(fs.existsSync(binary)).toBe(false);
});

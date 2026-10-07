/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { initializeProblemSourceFile } from '../problemSourceFile';

describe('CPH problem source templates', () => {
	let directory: string;
	beforeEach(() => { directory = mkdtempSync(path.join(os.tmpdir(), 'cph-template-test-')); });
	afterEach(() => { rmSync(directory, { recursive: true, force: true }); });
	test('new nested problem files receive the template verbatim', () => {
		const file = path.join(directory, '比赛', 'A.cpp');
		const template = '#include <bits/stdc++.h>\nusing i64 = long long;\nint main() {\n  return 0;\n}\n';
		expect(initializeProblemSourceFile(file, template)).toBe(true);
		expect(readFileSync(file, 'utf8')).toBe(template);
	});
	test('reimporting a problem preserves edited source', () => {
		const file = path.join(directory, 'A.cpp');
		writeFileSync(file, 'user solution');
		expect(initializeProblemSourceFile(file, 'new template')).toBe(false);
		expect(readFileSync(file, 'utf8')).toBe('user solution');
	});
	test('explicit replacement writes the new template over an existing source', () => {
		const file = path.join(directory, 'A.cpp');
		writeFileSync(file, 'old source');
		expect(initializeProblemSourceFile(file, 'new template', true)).toBe(true);
		expect(readFileSync(file, 'utf8')).toBe('new template');
	});
	test.each([null, ''])('missing or deliberately empty templates create an empty new file (%p)', template => {
		const file = path.join(directory, 'A.cpp');
		expect(initializeProblemSourceFile(file, template)).toBe(true);
		expect(readFileSync(file, 'utf8')).toBe('');
	});
});

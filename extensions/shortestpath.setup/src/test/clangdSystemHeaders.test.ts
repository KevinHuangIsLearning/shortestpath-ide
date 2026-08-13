/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { diagnoseClangdSystemHeaders } from '../clangdSystemHeaders';

suite('clangd system header diagnostics', () => {
	test('reports failed query-driver system include extraction', () => {
		assert.deepStrictEqual(
			diagnoseClangdSystemHeaders('E[20:50:12.126] System include extraction: driver clang not found in PATH'),
			{
				status: 'error',
				detail: 'clangd 无法从当前 C++ 编译器提取系统头文件：driver clang not found in PATH'
			}
		);
	});

	test('reports a missing GNU umbrella header', () => {
		assert.strictEqual(
			diagnoseClangdSystemHeaders('error: <bits/stdc++.h> file not found').status,
			'error'
		);
	});

	test('accepts a successful clangd check', () => {
		assert.strictEqual(diagnoseClangdSystemHeaders('ASTWorker building file').status, 'ok');
	});

	test('reports an unsuccessful clangd check without a recognized header error', () => {
		assert.strictEqual(diagnoseClangdSystemHeaders('clangd exited after checking the file', false).status, 'error');
	});
});

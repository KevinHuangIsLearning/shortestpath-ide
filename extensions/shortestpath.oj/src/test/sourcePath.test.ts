/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { isHeaderSafeSourcePath } from '../sourcePath';

test('accepts ordinary Windows source paths for HTTP headers', () => {
	assert.equal(isHeaderSafeSourcePath('C:\\Users\\Kevin\\OI\\H.cpp'), true);
});

test('rejects source paths containing HTTP control characters', () => {
	assert.equal(isHeaderSafeSourcePath('C:\\OI\\H.cpp\r\nInjected: value'), false);
	assert.equal(isHeaderSafeSourcePath('C:\\OI\\H.cpp\u0000'), false);
});

test('rejects source paths outside the HTTP header Latin-1 range', () => {
	assert.equal(isHeaderSafeSourcePath('C:\\用户\\H.cpp'), false);
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { diffOutputPreview } from '../utils/diffOutput';

test('large output previews stay bounded by ten rows and a per-line length', () => {
	const text = ('x'.repeat(10000) + '\n').repeat(100);
	const preview = diffOutputPreview(text, text.replace(/^x/, 'y'));
	expect(preview.preview).toBe(true);
	expect(preview.lines).toHaveLength(10);
	expect(preview.lines[0].type).toBe('changed');
	expect(preview.lines.every(line => (line.expected?.length ?? 0) <= 1025 && (line.received?.length ?? 0) <= 1025)).toBe(true);
	expect(preview.tokenDiff).toEqual([]);
});

test('includes differences through line ten and excludes line eleven', () => {
	const expected = Array.from({ length: 11 }, (_, index) => `expected ${index + 1}`).join('\n');
	const received = Array.from({ length: 11 }, (_, index) => index < 5 ? `expected ${index + 1}` : `received ${index + 1}`).join('\n');
	const preview = diffOutputPreview(expected, received);
	expect(preview.lines.slice(5)).toEqual(Array.from({ length: 5 }, (_, index) => ({
		lineNumber: index + 6, expected: `expected ${index + 6}`, received: `received ${index + 6}`, type: 'changed',
	})));
});

test('a matching prefix does not claim that the complete outputs match', () => {
	const prefix = 'same\n'.repeat(10);
	const preview = diffOutputPreview(prefix + 'a', prefix + 'b');
	expect(preview.isMatch).toBe(false);
	expect(preview.lines.every(line => line.type === 'match')).toBe(true);
	expect(diffOutputPreview('a\nb', 'a').lines[1].type).toBe('missing');
});

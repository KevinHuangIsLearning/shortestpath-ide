import { diffOutputPreview } from '../utils/diffOutput';

test('large output previews stay bounded by five rows and a per-line length', () => {
    const text = ('x'.repeat(10000) + '\n').repeat(100);
    const preview = diffOutputPreview(text, text.replace(/^x/, 'y'));
    expect(preview.preview).toBe(true);
    expect(preview.lines).toHaveLength(5);
    expect(preview.lines[0].type).toBe('changed');
    expect(preview.lines.every(line => (line.expected?.length ?? 0) <= 1025 && (line.received?.length ?? 0) <= 1025)).toBe(true);
    expect(preview.tokenDiff).toEqual([]);
});

test('a matching prefix does not claim that the complete outputs match', () => {
    const prefix = 'same\n'.repeat(10);
    const preview = diffOutputPreview(prefix + 'a', prefix + 'b');
    expect(preview.isMatch).toBe(false);
    expect(preview.lines.every(line => line.type === 'match')).toBe(true);
    expect(diffOutputPreview('a\nb', 'a').lines[1].type).toBe('missing');
});

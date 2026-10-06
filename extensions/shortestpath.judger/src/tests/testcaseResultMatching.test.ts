import { sameTestcase } from '../testcasePresentation';

test('stored field order and optional false flags do not discard a completed result', () => {
    const frontend = { input: '41', output: '42', id: 1 };
    const stored = { id: 1, disabled: false, input: '41', output: '42' };
    expect(JSON.stringify(frontend)).not.toBe(JSON.stringify(stored));
    expect(sameTestcase(frontend, stored)).toBe(true);
});

test('edited data, replaced references and disabled cases still reject stale results', () => {
    const testcase = { input: '41', output: '42', id: 1 };
    expect(sameTestcase(testcase, { ...testcase, output: '43' })).toBe(false);
    expect(sameTestcase(testcase, { ...testcase, input: '40' })).toBe(false);
    expect(sameTestcase(testcase, { ...testcase, disabled: true })).toBe(false);
    expect(sameTestcase(testcase, { ...testcase, id: 2 })).toBe(false);
    expect(sameTestcase(testcase, undefined)).toBe(false);
    const file = { ...testcase, inputPath: '/a.in' };
    expect(sameTestcase(file, { ...file, input: '' })).toBe(true);
    expect(sameTestcase(file, { ...file, inputPath: '/b.in' })).toBe(false);
});

globalThis.logger = { ...console };
import { Problem } from '../types';
import { appendShortestPathTestCase } from '../shortestpathOj';

const problem = (): Problem => ({
    name: 'A',
    url: 'https://shortestpath.cn/problem/DSU/found/A',
    interactive: false,
    memoryLimit: 256,
    timeLimit: 1000,
    group: 'DSU/found',
    srcPath: '/workspace/a.cpp',
    tests: [{ input: 'sample\n', output: 'sample output\n', id: 1 }],
});

describe('ShortestPath OJ test import', () => {
    test('appends a counterexample while preserving existing tests', () => {
        const value = problem();
        expect(appendShortestPathTestCase(value, 'counterexample\n', 'expected\n', 2)).toBe(true);
        expect(value.tests).toEqual([
            { input: 'sample\n', output: 'sample output\n', id: 1 },
            { input: 'counterexample\n', output: 'expected\n', id: 2 },
        ]);
    });

    test('does not add the same input and expected output twice', () => {
        const value = problem();
        expect(appendShortestPathTestCase(value, 'sample\n', 'sample output\n', 2)).toBe(false);
        expect(value.tests).toHaveLength(1);
    });
});

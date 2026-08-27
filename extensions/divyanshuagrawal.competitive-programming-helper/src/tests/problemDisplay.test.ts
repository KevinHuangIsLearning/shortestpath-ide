/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    appendVjudgeUrlSuffix,
    getProblemDisplayTarget,
    getProblemSourceForUrl,
    restoreOriginalProblemUrl,
} from '../problemDisplay';

describe('problem display target', () => {
    test('uses VJudge by default when a VJudge route is available', () => {
        expect(
            getProblemDisplayTarget(
                true,
                'vjudge',
                'https://codeforces.com/problemset/problem/1/A',
                'https://vjudge.net/problem/CodeForces-1A',
            ),
        ).toEqual({
            source: 'vjudge',
            url: 'https://vjudge.net/problem/CodeForces-1A',
        });
    });

    test('uses the original OJ when its mapping overrides the default', () => {
        expect(
            getProblemDisplayTarget(
                true,
                'original',
                'https://codeforces.com/problemset/problem/1/A',
                'https://vjudge.net/problem/CodeForces-1A',
            ),
        ).toEqual({
            source: 'original',
            url: 'https://codeforces.com/problemset/problem/1/A',
        });
    });

    test('falls back to the original OJ when VJudge has no route', () => {
        expect(
            getProblemDisplayTarget(
                true,
                'vjudge',
                'https://example.test/problem/1',
                undefined,
            ),
        ).toEqual({
            source: 'original',
            url: 'https://example.test/problem/1',
        });
    });

    test('retains an imported VJudge URL when VJudge is selected', () => {
        expect(
            getProblemDisplayTarget(
                true,
                'vjudge',
                'https://codeforces.com/problemset/problem/1/A',
                'https://vjudge.net/problem/CodeForces-1A',
            )?.url,
        ).toBe('https://vjudge.net/problem/CodeForces-1A');
    });

    test('uses the restored original OJ mapping to select the source', () => {
        const originalUrl = restoreOriginalProblemUrl(
            'https://vjudge.net/problem/CodeForces-1A',
            {
                CodeForces: {
                    urlTemplate: 'https://codeforces.com/problemset/problem/{contestId}/{problemId}',
                    problemIdRegex: '^(\\d+)([A-Z]\\d*)$',
                },
            },
        );
        expect(originalUrl).toBe('https://codeforces.com/problemset/problem/1/A');
        expect(
            getProblemSourceForUrl(
                originalUrl,
                { 'codeforces.com': { problemSource: 'original' } },
                'vjudge',
            ),
        ).toBe('original');
    });

    test('preserves an imported VJudge hash instead of creating a second hash', () => {
        expect(
            appendVjudgeUrlSuffix(
                'https://vjudge.net/problem/CodeForces-1A#problem',
                '#author=translator:1281309:zh',
            ),
        ).toBe('https://vjudge.net/problem/CodeForces-1A#problem');
    });

    test('applies the configured VJudge suffix when the imported URL has no hash', () => {
        expect(
            appendVjudgeUrlSuffix(
                'https://vjudge.net/problem/CodeForces-1A',
                '#author=translator:1281309:zh',
            ),
        ).toBe(
            'https://vjudge.net/problem/CodeForces-1A#author=translator:1281309:zh',
        );
    });

    test('does not display a page when legacy automatic opening is disabled', () => {
        expect(
            getProblemDisplayTarget(
                false,
                'vjudge',
                'https://codeforces.com/problemset/problem/1/A',
                'https://vjudge.net/problem/CodeForces-1A',
            ),
        ).toBeUndefined();
    });
});

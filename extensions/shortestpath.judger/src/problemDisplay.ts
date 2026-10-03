/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type ProblemSource = 'vjudge' | 'original' | 'none';

export type ProblemDisplayTarget = {
    source: ProblemSource;
    url: string;
};

/**
 * Selects the page to display after a problem is imported. A missing VJudge
 * route deliberately falls back to the original OJ instead of suppressing the
 * problem statement.
 */
export const getProblemDisplayTarget = (
    openInBrowser: boolean,
    preferredSource: ProblemSource,
    originalUrl: string,
    vjudgeUrl: string | undefined,
): ProblemDisplayTarget | undefined => {
    if (!openInBrowser || preferredSource === 'none') {
        return undefined;
    }
    if (preferredSource === 'vjudge' && vjudgeUrl) {
        return { source: 'vjudge', url: vjudgeUrl };
    }
    return { source: 'original', url: originalUrl };
};

export const getProblemSourceForUrl = (
    urlStr: string,
    mapping: Record<string, { oj?: unknown; problemSource?: unknown }> | null,
    defaultSource: ProblemSource,
): ProblemSource => {
    if (!mapping) {
        return defaultSource;
    }
    try {
        const hostname = new URL(urlStr).hostname;
        for (const [pattern, entry] of Object.entries(mapping)) {
            if (!hostname.includes(pattern) && !pattern.includes(hostname)) {
                continue;
            }
            if (entry.oj === 'ShortestPath') {
                return 'none';
            }
            if (entry.problemSource === 'original' || entry.problemSource === 'vjudge' || entry.problemSource === 'none') {
                return entry.problemSource;
            }
            return defaultSource;
        }
    } catch {
        // The caller already handles invalid problem URLs; retain the default.
    }
    return defaultSource;
};

export const restoreOriginalProblemUrl = (
    receivedUrl: string,
    vjudgeMapping: Record<string, { urlTemplate: string; problemIdRegex?: string }> | null,
): string => {
    try {
        const url = new URL(receivedUrl);
        if (!url.hostname.endsWith('vjudge.net')) {
            return receivedUrl;
        }
        const match = decodeURIComponent(url.pathname).match(/\/problem\/(.+?)-(.+)/);
        if (!match || !vjudgeMapping) {
            return receivedUrl;
        }
        const [, innerOj, rawProblemId] = match;
        const entry = Object.entries(vjudgeMapping).find(
            ([key]) => key.toLowerCase() === innerOj.toLowerCase(),
        )?.[1];
        if (!entry?.urlTemplate) {
            return receivedUrl;
        }
        const rawId = rawProblemId.replace(/[?#].*$/, '');
        const parsed = entry.problemIdRegex ? rawId.match(entry.problemIdRegex) : undefined;
        return replacePlaceholders(entry.urlTemplate, {
            contestId: parsed?.[1] ?? '',
            problemId: parsed?.[2] ?? rawId,
        });
    } catch {
        return receivedUrl;
    }
};

export const appendVjudgeUrlSuffix = (url: string, suffix: string): string => {
    if (!suffix) {
        return url;
    }
    try {
        const parsed = new URL(url);
        if (suffix.startsWith('#') && parsed.hash) {
            return url;
        }
    } catch {
        // Preserve legacy concatenation for invalid URLs; the browser command
        // remains responsible for reporting an unusable problem URL.
    }
    return url + suffix;
};

const replacePlaceholders = (
    template: string,
    values: Record<string, string>,
): string => {
    let result = template;
    for (const [key, value] of Object.entries(values)) {
        result = result.split(`{${key}}`).join(value);
    }
    return result;
};

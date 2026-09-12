/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type SubmissionTemplate = { urlTemplate: string; script: string };
export type SubmissionValues = Record<string, string>;
export type OjMappingEntry = { oj?: string; ojName?: string; contestIdRegex?: string; problemIdRegex?: string };
export type VjudgeMappingEntry = { vjudgeUrlKey?: string; compositeFormat?: string; problemIdRegex?: string; urlTemplate: string };

// Only opens the form and fills code. The final submit button is deliberately untouched.
export const vjudgeSubmitScript = `const waitFor = async (find) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        const value = find();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('VJudge submission form unavailable. Check that you are signed in.');
};
(await waitFor(() => document.getElementById('btn-submit'))).click();
(await waitFor(() => document.querySelector('label[for="submitter-type1"]'))).click();
const editor = await waitFor(() => document.querySelector('.CodeMirror')?.CodeMirror);
editor.setValue({code});`;

/** Replace once: inserted code or identifiers must never be interpreted as more placeholders. */
export function replaceSubmissionPlaceholders(template: string, values: SubmissionValues, javascript = false): string {
	return template.replace(/\{(oj|ojName|contestId|problemId|url|vjudgeUrl|code|language|fileName)\}/g, (token, key: string) => {
		if (!(key in values)) { return token; }
		return javascript ? JSON.stringify(values[key]) : encodeURIComponent(values[key]);
	});
}

export function submissionUrl(template: string, values: SubmissionValues): string {
	// A whole URL placeholder is already a URL; URL components are encoded individually.
	const resolved = template.trim().replace(/\{(oj|ojName|contestId|problemId|url|vjudgeUrl|code|language|fileName)\}/g, (token, key: string) => {
		if (!(key in values)) { return token; }
		return key === 'url' || key === 'vjudgeUrl' ? values[key] : encodeURIComponent(values[key]);
	});
	const url = new URL(resolved);
	if (!['https:', 'http:'].includes(url.protocol) || /\{[\w]+\}/.test(resolved)) {
		throw new Error('Invalid submission URL');
	}
	return url.href;
}

export function defaultSubmissionTemplates(mapping: Record<string, VjudgeMappingEntry>): Record<string, SubmissionTemplate> {
	const result: Record<string, SubmissionTemplate> = Object.create(null);
	for (const [key, entry] of Object.entries(mapping)) {
		result[key] = { urlTemplate: `https://vjudge.net/problem/${encodeURIComponent(entry.vjudgeUrlKey || key)}-${entry.compositeFormat || '{contestId}{problemId}'}`, script: vjudgeSubmitScript };
	}
	return result;
}

/** Stable identity for short names and display names, shared with the settings page. */
export function submissionAliases(ojMapping: Record<string, OjMappingEntry>, vjudgeMapping: Record<string, VjudgeMappingEntry>): Record<string, string> {
	const parents = new Map<string, string>();
	const root = (name: string): string => {
		const key = name.toLowerCase();
		if (!parents.has(key)) { parents.set(key, key); }
		const parent = parents.get(key)!;
		if (parent === key) { return key; }
		const result = root(parent); parents.set(key, result); return result;
	};
	const join = (left: string, right: string) => { parents.set(root(right), root(left)); };
	for (const [key, entry] of Object.entries(vjudgeMapping)) { join(key, entry.vjudgeUrlKey || key); }
	for (const entry of Object.values(ojMapping)) {
		const canonical = entry.ojName || entry.oj;
		if (canonical) { join(canonical, entry.ojName || canonical); }
	}
	const names = new Map<string, string>();
	for (const key of Object.keys(vjudgeMapping).sort()) { if (!names.has(root(key))) { names.set(root(key), key); } }
	for (const entry of Object.values(ojMapping)) {
		const canonical = entry.ojName || entry.oj;
		if (canonical) { names.set(root(canonical), canonical); }
	}
	const aliases: Record<string, string> = Object.create(null);
	for (const key of parents.keys()) { aliases[key] = names.get(root(key)) || key; }

	return aliases;
}

export function resolveSubmission(url: string, ojMapping: Record<string, OjMappingEntry>, vjudgeMapping: Record<string, VjudgeMappingEntry>, custom: Record<string, SubmissionTemplate>): { template: SubmissionTemplate; values: SubmissionValues; kind: 'custom' | 'vjudge' } | undefined {
	const parsed = new URL(url);
	const aliases = submissionAliases(ojMapping, vjudgeMapping);
	const values: SubmissionValues = { oj: '', ojName: '', contestId: '', problemId: '', url, vjudgeUrl: '' };
	let vjudgeKey: string | undefined;
	if (parsed.hostname === 'vjudge.net' || parsed.hostname.endsWith('.vjudge.net')) {
		const match = decodeURIComponent(parsed.pathname).match(/^\/problem\/(.+?)-(.+?)\/?$/);
		if (!match) { return undefined; }
		vjudgeKey = Object.keys(vjudgeMapping).find(key => [key, vjudgeMapping[key].vjudgeUrlKey].some(name => name?.toLowerCase() === match[1].toLowerCase()));
		const canonicalName = aliases[(vjudgeKey || match[1]).toLowerCase()] || match[1];
		const mappedOj = Object.values(ojMapping).find(entry => [entry.oj, entry.ojName].some(name => name && (aliases[name.toLowerCase()] || name).toLowerCase() === canonicalName.toLowerCase()));
		values.oj = mappedOj?.oj || canonicalName;
		values.ojName = mappedOj?.ojName || canonicalName;
		const ids = vjudgeKey && vjudgeMapping[vjudgeKey].problemIdRegex ? match[2].match(vjudgeMapping[vjudgeKey].problemIdRegex!) : null;
		values.contestId = ids?.[1] || ''; values.problemId = ids?.[2] || match[2]; values.vjudgeUrl = url;
	} else {
		const entry = Object.entries(ojMapping).find(([host]) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))?.[1];
		if (!entry) { return undefined; }
		values.oj = entry.oj || '';
		values.ojName = aliases[(entry.ojName || entry.oj || '').toLowerCase()] || entry.ojName || entry.oj || '';
		values.contestId = entry.contestIdRegex ? url.match(entry.contestIdRegex)?.[1] || '' : '';
		values.problemId = entry.problemIdRegex ? url.match(entry.problemIdRegex)?.[1] || '' : '';
		// Older bundled CF mappings captured the literal /problem/ segment.
		if ((parsed.hostname === 'codeforces.com' || parsed.hostname.endsWith('.codeforces.com')) && values.problemId === 'problem') {
			values.problemId = parsed.pathname.match(/^\/(?:contest|gym)\/\d+\/problem\/(\w+)\/?$/)?.[1] || '';
		}
		vjudgeKey = [values.ojName, values.oj].map(name => Object.keys(vjudgeMapping).find(key => name.toLowerCase() === key.toLowerCase())).find(Boolean);
	}
	const defaults = defaultSubmissionTemplates(vjudgeMapping);
	if (vjudgeKey && !values.vjudgeUrl && values.problemId) { values.vjudgeUrl = submissionUrl(defaults[vjudgeKey].urlTemplate, values); }
	const customKey = Object.keys(custom).sort((a, b) => Number(b === values.ojName) - Number(a === values.ojName) || a.localeCompare(b)).find(key => key !== '*' && (aliases[key.toLowerCase()] || key).toLowerCase() === values.ojName.toLowerCase());
	const template = customKey
		? custom[customKey]
		: values.vjudgeUrl
			? custom['*'] || { urlTemplate: '{vjudgeUrl}', script: vjudgeSubmitScript }
			: undefined;
	return template ? { template, values, kind: customKey ? 'custom' : 'vjudge' } : undefined;
}

/* Copyright (c) 2026 ShortestPath IDE contributors. Licensed under GPL-3.0-or-later. */
import { parsers } from 'upstream/parsers/parsers';
import { Contest } from 'upstream/models/Contest';

function inspectPage() {
	const url = location.href;
	return parsers.map(parser => {
		let matched = false;
		try {
			matched = parser.getRegularExpressions().some(pattern => pattern.test(url))
				&& !parser.getExcludedRegularExpressions().some(pattern => pattern.test(url)) && parser.canHandlePage();
		} catch { /* A page-specific predicate must not break the other parsers. */ }
		const id = parser.constructor.name;
		return { id, name: id.replace(/Parser$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2'), patterns: parser.getMatchPatterns(), matched };
	});
}

async function parsePage(parserId?: string) {
	const url = location.href;
	const parser = parserId ? parsers.find(candidate => candidate.constructor.name === parserId) : parsers.find(candidate => candidate.getRegularExpressions().some(pattern => pattern.test(url))
		&& !candidate.getExcludedRegularExpressions().some(pattern => pattern.test(url)) && candidate.canHandlePage());
	if (!parser) { throw new Error('Competitive Companion has no parser for this page.'); }
	window.nanoBar = { total: 0, advance() {}, go() {} };
	const parsed = await parser.parse(url, document.documentElement.outerHTML);
	return parsed instanceof Contest ? parsed.tasks : [parsed];
}

globalThis.ShortestPathCompanionParse = parsePage;

globalThis.ShortestPathCompanionInspect = inspectPage;

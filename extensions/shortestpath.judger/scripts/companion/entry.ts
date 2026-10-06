/* Copyright (c) 2026 ShortestPath IDE contributors. Licensed under GPL-3.0-or-later. */
import { parsers } from 'upstream/parsers/parsers';
import { Contest } from 'upstream/models/Contest';

async function parsePage() {
	const url = location.href;
	const parser = parsers.find(candidate => candidate.getRegularExpressions().some(pattern => pattern.test(url))
		&& !candidate.getExcludedRegularExpressions().some(pattern => pattern.test(url)) && candidate.canHandlePage());
	if (!parser) { throw new Error('Competitive Companion has no parser for this page.'); }
	window.nanoBar = { total: 0, advance() {}, go() {} };
	const parsed = await parser.parse(url, document.documentElement.outerHTML);
	return parsed instanceof Contest ? parsed.tasks : [parsed];
}

globalThis.ShortestPathCompanionParse = parsePage;

/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import type { ScriptResource } from './userScriptResources';

export type UserScript = {
	namespace: string;
	connects: string[];
	requires: string[];
	resources: Record<string, string>;
	name: string;
	matches: string[];
	includes: string[];
	excludes: string[];
	grants: string[];
	runAt: 'document-start' | 'document-end' | 'document-idle';
	source: string;
};

export function parseUserScript(source: string): UserScript {
	const header = source.match(
		/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/,
	);
	if (!header) {
		throw new Error('Missing userscript metadata');
	}
	const metadata = new Map<string, string[]>();
	for (const line of header[1].split(/\r?\n/)) {
		const match = line.match(/^\s*\/\/\s*@([\w-]+)\s+(.+?)\s*$/);
		if (match) {
			metadata.set(match[1], [
				...(metadata.get(match[1]) ?? []),
				match[2],
			]);
		}
	}
	const resources: Record<string, string> = Object.create(null);
	for (const resource of metadata.get('resource') ?? []) {
		const match = resource.match(/^(\S+)\s+(https?:\/\/\S+)$/);
		if (!match) {
			throw new Error('Invalid @resource');
		}
		resources[match[1]] = match[2];
	}
	const runAt = metadata.get('run-at')?.[0] ?? 'document-idle';
	if (!['document-start', 'document-end', 'document-idle'].includes(runAt)) {
		throw new Error('Unsupported @run-at');
	}
	const grants = metadata.get('grant') ?? ['none'];
	const allowed = [
		'none',
		'unsafeWindow',
		'GM_addStyle',
		'GM.addStyle',
		'GM_getValue',
		'GM.getValue',
		'GM_setValue',
		'GM.setValue',
		'GM_deleteValue',
		'GM.deleteValue',
		'GM_listValues',
		'GM.listValues',
		'GM_setClipboard',
		'GM.setClipboard',
		'GM_notification',
		'GM.notification',
		'GM_getResourceText',
		'GM.getResourceText',
		'GM_getResourceURL',
		'GM.getResourceUrl',
		'GM_xmlhttpRequest',
		'GM.xmlHttpRequest',
	];
	if (grants.some((grant) => !allowed.includes(grant))) {
		throw new Error('Unsupported userscript grant');
	}
	if (
		grants.includes('unsafeWindow') &&
		grants.some((grant) => !['none', 'unsafeWindow'].includes(grant))
	) {
		throw new Error(
			'unsafeWindow cannot be combined with privileged grants in submission scripts',
		);
	}
	const script: UserScript = {
		namespace: metadata.get('namespace')?.[0] ?? '',
		connects: metadata.get('connect') ?? [],
		requires: metadata.get('require') ?? [],
		resources,
		name: metadata.get('name')?.[0] ?? 'Submission script',
		matches: metadata.get('match') ?? [],
		includes: metadata.get('include') ?? [],
		excludes: metadata.get('exclude') ?? [],
		grants,
		runAt: runAt as UserScript['runAt'],
		source,
	};
	if (!script.matches.length && !script.includes.length) {
		throw new Error('A submission script needs @match or @include');
	}
	return script;
}

function glob(pattern: string): RegExp {
	return new RegExp(
		'^' +
			pattern
				.split('*')
				.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
				.join('.*') +
			'$',
	);
}
export function matchesUserScript(script: UserScript, url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (!['http:', 'https:'].includes(parsed.protocol)) {
		return false;
	}
	const matches = script.matches.some((pattern) => {
		const match = pattern.match(/^(\*|https?):\/\/([^/]+)(\/.*)$/);
		if (!match) {
			return false;
		}
		const [, scheme, host, pathname] = match;
		const hostMatches =
			host === '*' ||
			host === parsed.hostname ||
			(host.startsWith('*.') &&
				(parsed.hostname === host.slice(2) ||
					parsed.hostname.endsWith(host.slice(1))));
		return (
			(scheme === '*' || `${scheme}:` === parsed.protocol) &&
			hostMatches &&
			glob(pathname).test(parsed.pathname + parsed.search)
		);
	});
	return (
		(matches ||
			script.includes.some((pattern) => glob(pattern).test(url))) &&
		!script.excludes.some((pattern) => glob(pattern).test(url))
	);
}

/** Script values are encoded as JSON, never substituted into user source. */
export function userScriptBootstrap(
	script: UserScript,
	values: Record<string, string>,
	stateKey: string,
	assets: {
		requirements: string;
		resources: Record<string, ScriptResource>;
	} = { requirements: '', resources: {} },
	bridge?: { name: string; storage: Record<string, unknown> },
): string {
	const rules = script.matches.flatMap((pattern) => {
		const match = pattern.match(/^(\*|https?):\/\/([^/]+)(\/.*)$/);
		return match
			? [
					{
						scheme: match[1],
						host: match[2],
						path: glob(match[3]).source,
					},
			  ]
			: [];
	});
	return `(() => {
const metadata = ${JSON.stringify({ ...script, source: '' })};
const page = new URL(location.href);
const rules = ${JSON.stringify(rules)};
const matches = rules.some(rule => (rule.scheme === '*' || rule.scheme + ':' === page.protocol) && (rule.host === '*' || rule.host === page.hostname || (rule.host.startsWith('*.') && (page.hostname === rule.host.slice(2) || page.hostname.endsWith(rule.host.slice(1))))) && new RegExp(rule.path).test(page.pathname + page.search));
const includes = ${JSON.stringify(
		script.includes.map((pattern) => glob(pattern).source),
	)};
const excludes = ${JSON.stringify(
		script.excludes.map((pattern) => glob(pattern).source),
	)};
if (window.top !== window || !['https:', 'http:'].includes(page.protocol) || !(matches || includes.some(pattern => new RegExp(pattern).test(location.href))) || excludes.some(pattern => new RegExp(pattern).test(location.href))) { console.info('[Judger submission] Bootstrap skipped: frame, protocol or URL rules did not match'); return; }
console.info('[Judger submission] Bootstrap matched; run-at=' + metadata.runAt + '; readyState=' + document.readyState);
const key = ${JSON.stringify(stateKey)};
if (window[key]) return;
const previous = sessionStorage.getItem(key);
if (previous) {
 const saved = JSON.parse(previous);
 if (saved.state === 'done' || saved.state === 'error') { window[key] = saved; console.info('[Judger submission] Bootstrap restored prior state: ' + saved.state); return; }
 console.info('[Judger submission] Bootstrap restarting unfinished state: ' + saved.state);
}
window[key] = { state: 'waiting' };
const run = async () => {
 window[key] = { state: 'running' };
 sessionStorage.setItem(key, JSON.stringify(window[key]));
 try {
 const Judger = Object.freeze({ ...${JSON.stringify(values)}, registerSubmit: action => { window[key + '_submit'] = action; } });
 const unsafeWindow = window;
 const resources = ${JSON.stringify(assets.resources)};
 const GM_getResourceText = name => resources[name]?.text;
 const GM_getResourceURL = name => resources[name]?.dataUrl;
 const bridgeName = ${JSON.stringify(bridge?.name ?? '')};
 const storage = Object.assign(Object.create(null), ${JSON.stringify(
		bridge?.storage ?? {},
 )});
 let nextRequest = 0;
 const pending = new Map();
 const jobs = [];
 window[key + '_reply'] = (id, error, value) => { const call = pending.get(id); if (!call) return; pending.delete(id); error ? call.reject(new Error(error)) : call.resolve(value); };
 const request = (operation, args) => {
   const promise = new Promise((resolve, reject) => { const id = ++nextRequest; pending.set(id, { resolve, reject }); window[bridgeName](JSON.stringify({ id, operation, args })); });
   jobs.push(promise); return promise;
 };
 const GM_xmlhttpRequest = details => {
   const promise = request('request', { url: details.url, method: details.method, headers: details.headers, data: details.data, responseType: details.responseType, timeout: details.timeout });
   promise.then(value => details.onload?.(value), error => details.onerror?.(error));
   return promise;
 };
 const GM_addStyle = css => { const style = document.createElement('style'); style.textContent = css; (document.head || document.documentElement).append(style); return style; };
 const GM_getValue = (name, fallback) => Object.prototype.hasOwnProperty.call(storage, name) ? storage[name] : fallback;
 const GM_setValue = (name, value) => { storage[name] = value; return request('setValue', { name, value }); };
 const GM_deleteValue = name => { delete storage[name]; return request('deleteValue', { name }); };
 const GM_listValues = () => Object.keys(storage);
 const GM_setClipboard = text => request('clipboard', { text: String(text) });
 const GM_notification = text => request('notification', { text: typeof text === 'string' ? text : text.text });
 const GM = { getResourceText: async name => GM_getResourceText(name), getResourceUrl: async name => GM_getResourceURL(name), xmlHttpRequest: GM_xmlhttpRequest, addStyle: async css => GM_addStyle(css), getValue: async (name, fallback) => GM_getValue(name, fallback), setValue: async (name, value) => GM_setValue(name, value), deleteValue: async name => GM_deleteValue(name), listValues: async () => GM_listValues(), setClipboard: GM_setClipboard, notification: async text => GM_notification(text) };
 await (async () => {\n${assets.requirements}\n${script.source}\n})();
 await Promise.all(jobs);
 window[key] = { state: 'done', ...(typeof window[key + '_submit'] === 'function' ? { canSubmit: true } : {}) };
 sessionStorage.setItem(key, JSON.stringify(window[key]));
 } catch (error) { window[key] = { state: 'error', message: String(error) }; sessionStorage.setItem(key, JSON.stringify(window[key])); }
};
if (metadata.runAt === 'document-start') void run();
else if (metadata.runAt === 'document-end' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void run(), { once: true });
else if (metadata.runAt === 'document-idle' && document.readyState !== 'complete') window.addEventListener('load', () => void run(), { once: true });
else void run();
})();`;
}

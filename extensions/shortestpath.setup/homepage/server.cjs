/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const http = require('node:http');
const { readFile, writeFile, mkdir, rename, rm, stat, readdir } = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const hash = data => createHash('sha256').update(data).digest('hex');
const validId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** The remotely distributed artifact is one HTML file; IDE data and CSS stay local. */
async function createHomepageServer({ dataDir, sourceUrl = '', fallbackSourceUrl = '', localHtmlPath, intervalMs = 12 * 60 * 60_000, getData = async () => ({}), getTheme = async () => '', executeCommand = async () => { throw new Error('Command bridge unavailable'); } }) {
	const releases = path.join(dataDir, 'releases');
	await mkdir(releases, { recursive: true });
	const fallback = await readFile(path.join(__dirname, 'public', 'index.html'));
	const builtin = hash(fallback);
	let saved;
	try { saved = JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8')); } catch { saved = {}; }
	const exists = async id => validId(id) && await stat(path.join(releases, id, 'index.html')).then(value => value.isFile(), () => false);
	let current = await exists(saved.current) ? saved.current : builtin;
	let pending = await exists(saved.pending) && saved.pending !== current ? saved.pending : null;
	let etag = saved.sourceUrl === sourceUrl ? saved.etag : undefined;
	let etagSource = saved.etagSource || saved.sourceUrl;
	let message = '主页已就绪。', checking, origin, timer;
	if (current === builtin) { await mkdir(path.join(releases, builtin), { recursive: true }); await writeFile(path.join(releases, builtin, 'index.html'), fallback); }
	const persist = async () => {
		const file = path.join(dataDir, 'state-' + randomUUID() + '.tmp');
		await writeFile(file, JSON.stringify({ current, pending, sourceUrl, etag, etagSource }));
		await rename(file, path.join(dataDir, 'state.json'));
	};
	const clean = async () => {
		for (const entry of await readdir(releases, { withFileTypes: true })) {
			if (entry.isDirectory() && validId(entry.name) && entry.name !== current && entry.name !== pending) {await rm(path.join(releases, entry.name), { recursive: true, force: true });}
		}
	};
	const status = () => ({ current, pending: localHtmlPath ? null : pending, message, configured: !localHtmlPath && !!sourceUrl });
	async function download() {
		let failure;
		for (const url of [sourceUrl, fallbackSourceUrl].filter(Boolean)) {
			try {
				if (new URL(url).protocol !== 'https:') {throw new Error('主页更新地址必须使用 HTTPS');}
				const response = await fetch(url, { headers: etag && etagSource === url ? { 'If-None-Match': etag } : {}, signal: AbortSignal.timeout(15_000), redirect: 'error' });
				if (response.status === 304) {return { response, url };}
				if (!response.ok) {throw new Error('HTTP ' + response.status);}
				const chunks = []; let length = 0;
				for await (const chunk of response.body) { length += chunk.length; if (length > 2 * 1024 * 1024) {throw new Error('HTML 超过 2 MiB');} chunks.push(chunk); }
				const bytes = Buffer.concat(chunks);
				if (!/<html[\s>]/i.test(bytes.toString()) || !/<\/html\s*>/i.test(bytes.toString())) {throw new Error('下载内容不是完整 HTML');}
				return { response, bytes, url };
			} catch (error) { failure = error; }
		}
		throw failure;
	}
	async function performCheck() {
		if (localHtmlPath || !sourceUrl) { message = '尚未配置主页更新地址。'; return; }
		let staging;
		try {
			const { response, bytes, url } = await download();
			if (response.status === 304) { message = pending ? '新版主页已就绪，下次进入时启用。' : '主页已是最新版本。'; return; }
			const id = hash(bytes);
			if (id === current) { pending = null; }
			else if (id !== pending) {
				staging = path.join(dataDir, 'staging-' + randomUUID()); await mkdir(staging);
				await writeFile(path.join(staging, 'index.html'), bytes);
				await rename(staging, path.join(releases, id)); staging = undefined; pending = id;
			}
			etag = response.headers.get('etag') || undefined;
			etagSource = url;
			await persist();
			// A superseded pending download is not kept as another cached version.
			await clean();
			message = pending ? '新版主页已就绪，下次进入时启用。' : '主页已是最新版本。';
		} catch (error) { message = '更新失败，继续使用当前主页：' + error.message; }
		finally { if (staging) {await rm(staging, { recursive: true, force: true });} }
	}
	const check = () => { if (!checking) {checking = performCheck().finally(() => { checking = undefined; });} return checking; };
	const json = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
	const server = http.createServer(async (req, res) => {
		try {
			if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin) {return json(res, 403, { error: 'Invalid origin' });}
			const url = new URL(req.url, origin);
			if (req.method === 'POST') {
				if (req.headers['x-shortestpath-homepage'] !== '1') {return json(res, 403, { error: 'Missing homepage header' });}
				if (url.pathname === '/api/command') {
					let body = '';
					for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 16 * 1024) {return json(res, 413, { error: 'Command request too large' });} }
					const request = JSON.parse(body);
					if (typeof request.command !== 'string' || !Array.isArray(request.args) || request.args.length > 1 || request.args.some(arg => typeof arg !== 'string')) {return json(res, 400, { error: 'Invalid command request' });}
					await executeCommand(request.command, request.args);
					return json(res, 200, { ok: true });
				}
				if (url.pathname !== '/api/check') {return json(res, 404, { error: 'Not found' });}
				await check(); return json(res, 200, status());
			}
			if (req.method !== 'GET') {return json(res, 405, { error: 'Method not allowed' });}
			if (url.pathname === '/api/ide') {return json(res, 200, await getData());}
			if (url.pathname === '/api/status') {return json(res, 200, status());}
			if (url.pathname === '/ide-theme.css') {
				res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' });
				return res.end(await getTheme());
			}
			if (url.pathname === '/') {
				if (localHtmlPath) { res.writeHead(302, { Location: '/debug/index.html?shortestpath-home=1', 'Cache-Control': 'no-store' }); return res.end(); }
				if (pending) { const previous = current; current = pending; pending = null; try { await persist(); } catch (error) { pending = current; current = previous; throw error; } await clean(); }
				res.writeHead(302, { Location: '/releases/' + current + '/index.html?shortestpath-home=1', 'Cache-Control': 'no-store' }); return res.end();
			}
			const match = /^\/releases\/([a-f0-9]{64})\/index\.html$/.exec(url.pathname);
			const debug = localHtmlPath && url.pathname === '/debug/index.html';
			if (!match && !debug) {return json(res, 404, { error: 'Not found' });}
			const html = await readFile(debug ? localHtmlPath : path.join(releases, match[1], 'index.html'), 'utf8');
			const [data, css] = await Promise.all([getData(), getTheme()]);
			const safeData = JSON.stringify(data).replaceAll('<', '\\u003c');
			const bootstrap = '<script>window.shortestpath={initialData:' + safeData + ',executeCommand:async function(command,...args){const response=await fetch("/api/command",{method:"POST",headers:{"Content-Type":"application/json","X-ShortestPath-Homepage":"1"},body:JSON.stringify({command,args})});const value=await response.json();if(!response.ok)throw new Error(value.error);return value;}};</script>';
			const injection = '<style id="ide-initial-theme">' + String(css || '').replaceAll('<', '\\3c ') + '</style><link id="ide-theme" rel="stylesheet" href="/ide-theme.css">' + bootstrap;
			const result = /<head(?:\s[^>]*)?>/i.test(html)
				? html.replace(/<head(?:\s[^>]*)?>/i, match => match + injection)
				: html.replace(/<html(?:\s[^>]*)?>/i, match => match + '<head>' + injection + '</head>');
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
			res.end(result);
		} catch (error) { json(res, error.code === 'ENOENT' ? 404 : 500, { error: error.message }); }
	});
	return {
		async listen(port = 0) {
			await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
			origin = 'http://127.0.0.1:' + server.address().port;
			if (sourceUrl && !localHtmlPath) { void check(); timer = setInterval(check, intervalMs); timer.unref(); }
			return origin;
		},
		async close() { clearInterval(timer); if (checking) {await checking;} server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
	};
}
module.exports = { createHomepageServer };

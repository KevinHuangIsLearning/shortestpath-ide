/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Run after webpack-production. Requires the repository's Playwright Chromium runtime.
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const fs = require('node:fs'),
	assert = require('node:assert'),
	ts = require('typescript');
const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'dist/extension.js'), 'utf8');
const ast = ts.createSourceFile(
	'extension.js',
	source,
	ts.ScriptTarget.Latest,
	true,
	ts.ScriptKind.JS
);
const candidates: string[] = [];
function visit(node) {
	if (
		(ts.isFunctionDeclaration(node) ||
			ts.isFunctionExpression(node) ||
			ts.isArrowFunction(node)) &&
		node.getText(ast).includes('new CSSStyleSheet') &&
		node.getText(ast).includes('window.top')
	) {
		candidates.push(node.getText(ast));
	}
	ts.forEachChild(node, visit);
}
visit(ast);
candidates.sort((a, b) => a.length - b.length);
assert(candidates.length, 'Missing production import control');
const mountImportControl = Function('return (' + candidates[0] + ')')();
const runtime = fs.readFileSync(
	path.join(root, 'dist/static/competitive-companion/parsers.runtime.txt'),
	'utf8'
);
const labels = {
	add: '+ 添加题目',
	choose: '选择 Parser…',
	search: '搜索 Parser 名称或域名',
	empty: '没有匹配的 Parser。',
	importing: '正在导入…',
	success: '已导入 {0} 道题。',
	cancelled: '已取消导入。',
	matched: '自动匹配',
	close: '关闭',
	collapse: '收起导入控件',
	expand: '展开导入控件',
	drag: '拖动以移动'
};
(async () => {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({
			viewport: { width: 900, height: 700 }
		});
		await page.route('https://example.com/**', (r) =>
			r.fulfill({
				body: '<!doctype html><title>Parser test</title><h1>Unsupported site</h1>',
				headers: {
					'content-type': 'text/html',
					'content-security-policy':
						"default-src 'none'; style-src 'none'; script-src 'none'"
				}
			})
		);
		await page.goto('https://example.com/task');
		const cdp = await page.context().newCDPSession(page);
		const tree = await cdp.send('Page.getFrameTree');
		const { executionContextId } = await cdp.send(
			'Page.createIsolatedWorld',
			{
				frameId: tree.frameTree.frame.id,
				worldName: 'shortestpath-import-button'
			}
		);
		const evaluate = async (expression) => {
			const r = await cdp.send('Runtime.evaluate', {
				expression,
				contextId: executionContextId,
				returnByValue: true,
				awaitPromise: true
			});
			if (r.exceptionDetails)
				throw Error(
					r.exceptionDetails.exception?.description ||
						r.exceptionDetails.text
				);
			return r.result.value;
		};
		await evaluate(
			`globalThis.__requests=[]; globalThis.__shortestpathImportProblem=p=>__requests.push(JSON.parse(p)); const attach=Element.prototype.attachShadow; Element.prototype.attachShadow=function(options){ const r=attach.call(this,options); globalThis.__root=r; return r; }; ${runtime}; (${mountImportControl.toString()})(${JSON.stringify(
				labels
			)});`
		);
		assert.equal(
			await evaluate('__root.querySelector(".add").hidden'),
			true
		);
		assert.equal(
			await evaluate(
				'getComputedStyle(__root.querySelector(".panel")).borderRadius'
			),
			'8px'
		);
		const click = async (selector) => {
			const p = await evaluate(
				`(()=>{const r=__root.querySelector(${JSON.stringify(
					selector
				)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`
			);
			await page.mouse.click(p.x, p.y);
		};
		await click('.toggle');
		assert.equal(await evaluate('__root.querySelector(".choose").hidden'), true);
		assert.equal(await evaluate('__root.querySelector(".status").hidden'), true);
		assert.equal(await evaluate('__root.querySelector(".toggle").getAttribute("aria-expanded")'), 'false');
		assert.equal(await evaluate('[...__root.querySelectorAll(".bar button")].filter(button => !button.hidden).length'), 1);
		assert.equal(await evaluate('getComputedStyle(__root.querySelector(".toggle")).opacity'), '0.8');
		await page.mouse.move(1, 1);
		await evaluate('__root.querySelector(".toggle").blur()');
		assert.equal(await evaluate('getComputedStyle(__root.querySelector(".toggle")).opacity'), '0.4');
		const compact = await evaluate('(()=>{const r=__root.querySelector(".toggle").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
		await page.mouse.move(compact.x, compact.y); await page.mouse.down(); await page.mouse.move(compact.x - 80, compact.y - 80, { steps: 5 }); await page.mouse.up();
		assert.equal(await evaluate('__root.querySelector(".toggle").getAttribute("aria-expanded")'), 'false');
		await click('.toggle');
		assert.equal(await evaluate('__root.querySelector(".choose").hidden'), false);
		await click('.choose');
		await page.keyboard.type('cses.fi');
		assert((await evaluate('__root.querySelectorAll(".item").length')) > 0);
		await click('.item');
		assert.equal(
			await evaluate('__root.querySelector(".add").hidden'),
			false
		);
		assert(
			(
				await evaluate('__root.querySelector(".add").textContent')
			).includes('CSES')
		);
		await click('.add');
		await click('.add');
		assert.equal(await evaluate('__requests.length'), 1);
		await evaluate(
			'__shortestpathImportButtonResult({count:2,error:"解析失败"}); __shortestpathImportButtonBusy(false)'
		);
		assert.equal(
			await evaluate('__root.querySelector(".status").textContent'),
			'已导入 2 道题。\n解析失败'
		);
		assert.equal(await evaluate('__root.querySelector(".toggle").getAttribute("aria-expanded")'), 'false');
		await click('.toggle');
		const before = await evaluate(
			'document.getElementById("shortestpath-import-button").getBoundingClientRect().x'
		);
		const handle = await evaluate(
			'(()=>{const r=__root.querySelector(".drag").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()'
		);
		await page.mouse.move(handle.x, handle.y);
		await page.mouse.down();
		await page.mouse.move(handle.x - 200, handle.y - 100, { steps: 8 });
		await page.mouse.up();
		assert(
			(await evaluate(
				'document.getElementById("shortestpath-import-button").getBoundingClientRect().x'
			)) <
				before - 150
		);
		assert.equal(await evaluate('__requests.length'), 1);
		await click('.choose');
		await page.screenshot({ path: '/tmp/browser-import-picker.png' });
		await page.setViewportSize({ width: 320, height: 600 });
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(resolve))
				)
		);
		await evaluate('__root.querySelector(".panel").hidden=false');
		assert(
			(await evaluate(
				'__root.querySelector(".panel").getBoundingClientRect().left'
			)) >= 0
		);
		await evaluate('__shortestpathImportButtonCleanup()');
		assert.equal(
			await evaluate(
				'document.getElementById("shortestpath-import-button")'
			),
			null
		);
		const live = await browser.newPage();
		await live.goto('https://cses.fi/problemset/task/1068/', {
			waitUntil: 'domcontentloaded',
			timeout: 30000
		});
		const liveCDP = await live.context().newCDPSession(live);
		const liveTree = await liveCDP.send('Page.getFrameTree');
		const liveWorld = await liveCDP.send('Page.createIsolatedWorld', {
			frameId: liveTree.frameTree.frame.id,
			worldName: 'shortestpath-companion'
		});
		const liveResult = await liveCDP.send('Runtime.evaluate', {
			expression: `${runtime}; (async()=>{const matched=ShortestPathCompanionInspect().filter(p=>p.matched);const tasks=await ShortestPathCompanionParse(matched[0].id);return {matched:matched.map(p=>p.id),name:tasks[0].name,tests:tasks[0].tests.length};})()`,
			contextId: liveWorld.executionContextId,
			returnByValue: true,
			awaitPromise: true
		});
		if (liveResult.exceptionDetails)
			throw Error(
				liveResult.exceptionDetails.exception?.description ||
					liveResult.exceptionDetails.text
			);
		assert(liveResult.result.value.tests > 0);
		console.log('PASS live CSES', JSON.stringify(liveResult.result.value));
		console.log(
			'PASS strict CSP, real trusted clicks, registry search/manual Parser, busy guard, partial error feedback, collapse/expand, pointer dragging, narrow layout, cleanup'
		);
	} finally {
		await browser.close();
	}
})().catch((e) => {
	console.error(e);
	process.exit(1);
});

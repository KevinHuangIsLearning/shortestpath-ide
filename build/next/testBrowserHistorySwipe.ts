/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as esbuild from 'esbuild';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';

// Run with node build/next/testBrowserHistorySwipe.ts on macOS.
const root = path.resolve(import.meta.dirname, '../..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'shortestpath-history-swipe-tests-'));
try {
	const product = JSON.parse(await fs.readFile(path.join(root, 'product.json'), 'utf8'));
	const executable = path.join(root, '.build/electron', `${product.nameLong}.app`, 'Contents/MacOS', product.nameShort);
	const preload = path.join(temporary, 'preload.cjs');
	await esbuild.build({
		entryPoints: [path.join(root, 'src/vs/platform/browserView/electron-browser/preload-browserView.ts')],
		outfile: preload, platform: 'node', format: 'cjs', bundle: false,
	});
	// Exercise the real isolated preload and DOM without requiring foreground OS
	// input. Only this test preload exposes simulated wheel callbacks to the suite.
	await fs.writeFile(preload, `
const testWheelListeners = [];
const testShadows = new WeakMap();
const originalAddListener = window.addEventListener;
window.addEventListener = (...args) => {
	if (args[0] === 'wheel') testWheelListeners.push(args[1]);
	return Reflect.apply(originalAddListener, window, args);
};
const originalAttachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function(options) {
	const shadow = Reflect.apply(originalAttachShadow, this, [options]);
	testShadows.set(this, shadow);
	return shadow;
};
require('electron').contextBridge.exposeInMainWorld('__historySwipeTest', {
	wheel: (deltaX, deltaY, targetId, prevented = false, trusted = true, control = false) => {
		const target = targetId ? document.getElementById(targetId) : document.body;
		const path = [];
		for (let el = target; el; el = el.parentElement) path.push(el);
		const event = {deltaX, deltaY, isTrusted: trusted, timeStamp: performance.now(), deltaMode: 0, defaultPrevented: prevented,
			ctrlKey: control, metaKey: false, altKey: false, shiftKey: false, composedPath: () => path};
		for (const listener of testWheelListeners) listener(event);
	},
	hint: () => {
		const host = document.querySelector('[data-vscode-history-swipe]');
		if (!host) return {visible: false};
		const root = testShadows.get(host);
		const circle = root.querySelector('.circle');
		return {visible: true, opacity: getComputedStyle(circle).opacity,
			left: circle.style.left, right: circle.style.right,
			transform: root.querySelector('svg').style.transform, sheets: root.adoptedStyleSheets.length};
	}
});
` + await fs.readFile(preload, 'utf8'));
	const suite = path.join(temporary, 'suite.cjs');
	const report = path.join(temporary, 'result.txt');
	await esbuild.build({
		entryPoints: [path.join(root, 'test/integration/browserView/browserViewHistorySwipe.ts')],
		outfile: suite, bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
		define: { HISTORY_SWIPE_TEST_PRELOAD: JSON.stringify(preload), HISTORY_SWIPE_TEST_REPORT: JSON.stringify(report) },
	});
	process.exitCode = await new Promise<number>((resolve, reject) => {
		const child = spawn(executable, [suite, `--user-data-dir=${path.join(temporary, 'profile')}`], { stdio: 'inherit' });
		const timeout = setTimeout(() => child.kill(), 30000);
		child.once('error', error => { clearTimeout(timeout); reject(error); });
		child.once('exit', code => { clearTimeout(timeout); resolve(code ?? 1); });
	});
	if (process.exitCode === 0 && await fs.readFile(report, 'utf8').catch(() => '') !== 'passed') {
		throw new Error('Electron exited before the swipe tests completed');
	}
} finally {
	await fs.rm(temporary, { recursive: true, force: true });
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The engine is bundled into this dedicated browser world, outside workbench modules.
// eslint-disable-next-line local/code-import-patterns
import { enable, disable, setFetchMethod } from 'darkreader';
import type { IBrowserDarkReaderConfiguration, IBrowserDarkReaderResource } from '../common/browserDarkReader.js';

/** This entry is bundled into a string and runs only in the Dark Reader world. */
declare const shortestPathDarkReaderBridge: {
	ready(callback: (configuration: IBrowserDarkReaderConfiguration) => void): void;
	fetch(url: string): Promise<IBrowserDarkReaderResource>;
};

setFetchMethod(async url => {
	const resource = await shortestPathDarkReaderBridge.fetch(url);
	return new Response(new Uint8Array(resource.body), { headers: { 'Content-Type': resource.contentType } });
});

// immediateModify is supported by the pinned engine and prepares hidden tabs.
const theme = { brightness: 100, contrast: 100, sepia: 0, immediateModify: true };
let active = false;
let linkedSheetRefreshPending = false;

// The official engine watches CSSOM changes on <style>, but not <link>.
// Refresh only when a linked sheet changes; coalesce a synchronous batch.
// This script owns one isolated document and its constructors.
// eslint-disable-next-line no-restricted-syntax
document.addEventListener('__darkreader__updateSheet', event => {
	// eslint-disable-next-line no-restricted-syntax
	if (!active || linkedSheetRefreshPending || !(event.target instanceof HTMLLinkElement)) {
		return;
	}
	linkedSheetRefreshPending = true;
	queueMicrotask(() => {
		linkedSheetRefreshPending = false;
		if (active) {
			try {
				disable();
				enable(theme);
			} catch (error) {
				disable();
				active = false;
				console.error('[Dark Reader]', error);
			}
		}
	});
}, true);
// The official extension detector is vendored separately because the API build
// does not export it. It temporarily disables engine sheets while sampling.
declare const shortestPathDarkReaderDetector: {
	runDarkThemeDetector(callback: (hasDarkTheme: boolean) => void, hints: unknown[]): void;
	stopDarkThemeDetector(): void;
};
let requested = false;
let detectDarkTheme = true;
let generation = 0;
let checkTimer: ReturnType<typeof setTimeout> | undefined;

function applyEngine(enabled: boolean): void {
	if (active === enabled) {
		return;
	}
	try {
		if (enabled) {
			enable(theme);
		} else {
			disable();
		}
		active = enabled;
	} catch (error) {
		disable();
		active = false;
		console.error('[Dark Reader]', error);
	}
}

function checkNativeTheme(): void {
	checkTimer = undefined;
	// eslint-disable-next-line no-restricted-syntax
	if (!requested || !detectDarkTheme || !document.documentElement) {
		return;
	}
	const current = ++generation;
	shortestPathDarkReaderDetector.runDarkThemeDetector(hasDarkTheme => {
		if (current === generation && requested && detectDarkTheme) {
			applyEngine(!hasDarkTheme);
		}
	}, []);
}

function scheduleNativeThemeCheck(): void {
	if (requested && detectDarkTheme && checkTimer === undefined) {
		checkTimer = setTimeout(checkNativeTheme, 150);
	}
}

function isEngineNode(node: Node): boolean {
	const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
	return !!element?.closest('.darkreader');
}

const nativeThemeObserver = new MutationObserver(records => {
	// Ignore engine-owned styles and metadata so checks do not trigger themselves.
	if (records.some(record => !isEngineNode(record.target) && (
		record.type === 'attributes'
			? ['class', 'style', 'data-theme', 'data-color-mode', 'content', 'href', 'media'].includes(record.attributeName ?? '')
			: [...record.addedNodes, ...record.removedNodes].some(node => !isEngineNode(node))
	))) {
		scheduleNativeThemeCheck();
	}
});
// These listeners belong to this frame's isolated document, not the workbench.
// eslint-disable-next-line no-restricted-syntax
document.addEventListener('DOMContentLoaded', scheduleNativeThemeCheck);
// eslint-disable-next-line no-restricted-syntax
document.addEventListener('load', event => {
	// eslint-disable-next-line no-restricted-syntax
	if (event.target instanceof HTMLLinkElement) {
		scheduleNativeThemeCheck();
	}
}, true);
// eslint-disable-next-line no-restricted-globals
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', scheduleNativeThemeCheck);

shortestPathDarkReaderBridge.ready(configuration => {
	requested = configuration.enabled;
	detectDarkTheme = configuration.detectDarkTheme !== false;
	generation++;
	clearTimeout(checkTimer);
	checkTimer = undefined;
	shortestPathDarkReaderDetector.stopDarkThemeDetector();
	nativeThemeObserver.disconnect();
	if (requested && detectDarkTheme) {
		nativeThemeObserver.observe(document, { attributes: true, childList: true, subtree: true });
		// Start with the normal early-page fallback, then remove it if the
		// original page is already dark. This also handles late stylesheets.
		applyEngine(true);
		checkNativeTheme();
	} else {
		applyEngine(requested);
	}
});

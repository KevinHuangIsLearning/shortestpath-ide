/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/shortestPathBrowserNewTabOverlay.css';
import { $, addDisposableListener, append } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { matchesFuzzy } from '../../../../base/common/filters.js';
import { Event } from '../../../../base/common/event.js';
import { browserTabBarLabels } from './shortestPathBrowserTabBar.js';

export interface BrowserNewTabEntry {
	readonly id?: string;
	readonly section?: string;
	readonly navigate?: boolean;
	readonly search?: boolean;
	readonly title: string;
	readonly url: string;
	readonly favicon?: string;
	readonly favorite: boolean;
	run(): void;
}

export interface BrowserNewTabSuggestions {
	readonly onDidChange?: Event<void>;
	getEntries(text: string, token: CancellationToken): Promise<readonly BrowserNewTabEntry[]>;
}

/** A browser-owned command panel over the current page; it never allocates a blank tab. */
export class ShortestPathBrowserNewTabOverlay extends Disposable {
	private static counter = 0;
	private readonly resultId = `browser-new-tab-results-${ShortestPathBrowserNewTabOverlay.counter++}`;
	readonly element: HTMLElement;
	readonly input: HTMLInputElement;
	private readonly results: HTMLElement;
	private readonly rows = this._register(new DisposableStore());
	private buttons: HTMLButtonElement[] = [];
	private selected = 0;
	private suggestions: readonly BrowserNewTabEntry[] = [];
	private request: CancellationTokenSource | undefined;
	private disposed = false;

	constructor(container: HTMLElement, private readonly entries: readonly BrowserNewTabEntry[], private readonly navigate: (text: string) => void, private readonly close: (accepted: boolean) => void, private readonly live?: BrowserNewTabSuggestions, private readonly primary?: (text: string) => readonly BrowserNewTabEntry[]) {
		super();
		this.suggestions = entries;
		this.element = append(container, $('.browser-new-tab-overlay'));
		this._register(toDisposable(() => this.element.remove()));
		const panel = append(this.element, $('.browser-new-tab-panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': browserTabBarLabels.new }));
		const search = append(panel, $('.browser-new-tab-search'));
		append(search, $('span.codicon.codicon-search', { 'aria-hidden': 'true' }));
		this.input = append(search, $('input', { type: 'text', placeholder: browserTabBarLabels.search, 'aria-label': browserTabBarLabels.search, autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': this.resultId, 'aria-autocomplete': 'list' })) as HTMLInputElement;
		const dismiss = append(search, $('button.browser-new-tab-dismiss', { type: 'button', 'aria-label': browserTabBarLabels.dismiss })) as HTMLButtonElement;
		append(dismiss, $('span.codicon.codicon-close', { 'aria-hidden': 'true' }));
		this.results = append(panel, $('.browser-new-tab-results', { id: this.resultId, role: 'listbox', 'aria-label': browserTabBarLabels.tabs }));
		this._register(addDisposableListener(dismiss, 'click', () => this.close(false)));
		this._register(addDisposableListener(this.element, 'mousedown', event => { if (event.target === this.element) { this.close(false); } }));
		this._register(addDisposableListener(this.input, 'input', () => { this.selected = 0; this.render(); this.refresh(); }));
		this._register(addDisposableListener(panel, 'keydown', (event: KeyboardEvent) => {
			if (event.isComposing || event.keyCode === 229) { return; }
			if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(false); }
			if (event.target === this.input && event.key === 'Enter') { event.preventDefault(); this.buttons[this.selected]?.click(); }
			if (event.target === this.input && (event.key === 'ArrowDown' || event.key === 'ArrowUp') && this.buttons.length) {
				event.preventDefault(); this.selected = (this.selected + (event.key === 'ArrowDown' ? 1 : this.buttons.length - 1)) % this.buttons.length; this.updateSelection();
			}
			if (event.key === 'Tab') {
				const controls = [this.input, dismiss, ...this.buttons];
				const index = controls.indexOf(panel.ownerDocument.activeElement as HTMLInputElement | HTMLButtonElement);
				event.preventDefault(); controls[(index + (event.shiftKey ? controls.length - 1 : 1)) % controls.length].focus();
			}
		}));
		if (live?.onDidChange) { this._register(live.onDidChange(() => this.refresh())); }
		this._register(toDisposable(() => { this.disposed = true; this.request?.dispose(true); }));
		this.render(); this.refresh(); this.focus();
	}

	focus(): void { this.input.focus(); }

	private refresh(): void {
		if (!this.live) { return; }
		this.request?.dispose(true);
		const request = this.request = new CancellationTokenSource();
		void this.live.getEntries(this.input.value.trim(), request.token).then(entries => {
			if (this.disposed || request.token.isCancellationRequested) { return; }
			this.suggestions = entries;
			this.render(true);
		}, () => { /* Preserve cached suggestions if a provider fails. */ });
	}

	private render(preserveSelection = false): void {
		const focused = this.buttons.find(button => button === this.element.ownerDocument.activeElement);
		const focusedId = focused?.dataset.entryId;
		const selectedId = preserveSelection ? this.buttons[this.selected]?.dataset.entryId : undefined;
		this.rows.clear(); this.results.replaceChildren(); this.buttons = [];
		const text = this.input.value.trim();
		if (text) {
			for (const entry of this.primary?.(text) ?? [{ title: text, url: browserTabBarLabels.new, favorite: false, run: () => this.navigate(text) }]) { this.row(entry, true); }
		}
		const matching = (this.live ? this.suggestions : this.entries).filter(entry => !text || matchesFuzzy(text, `${entry.title} ${entry.url}`, true));
		const groups = new Map<string, BrowserNewTabEntry[]>();
		for (const entry of matching) {
			const section = entry.section ?? (entry.favorite ? browserTabBarLabels.favorites : browserTabBarLabels.tabs);
			const group = groups.get(section) ?? []; group.push(entry); groups.set(section, group);
		}
		for (const [section, entries] of groups) {
			append(this.results, $('.browser-new-tab-section')).textContent = section;
			for (const entry of entries) { this.row(entry, entry.navigate ?? false); }
		}
		this.selected = Math.max(0, selectedId ? this.buttons.findIndex(button => button.dataset.entryId === selectedId) : 0);
		if (!this.buttons.length) { append(this.results, $('.browser-new-tab-empty')).textContent = browserTabBarLabels.search; }
		this.updateSelection();
		if (focused) { (this.buttons.find(button => button.dataset.entryId === focusedId) ?? this.input).focus(); }
	}

	private row(entry: BrowserNewTabEntry, navigate: boolean): void {
		const button = append(this.results, $('button.browser-new-tab-entry', { type: 'button', role: 'option', id: `${this.resultId}-${this.buttons.length}` })) as HTMLButtonElement;
		button.dataset.entryId = entry.id ?? `${entry.favorite}:${entry.title}:${entry.url}`;
		const icon = append(button, $(`span.browser-new-tab-icon.codicon.codicon-${entry.search ? 'search' : entry.favorite ? 'star-full' : 'globe'}`, { 'aria-hidden': 'true' }));
		if (entry.favicon && /^(https?:|data:image\/)/i.test(entry.favicon)) {
			const img = append(icon, $('img', { src: entry.favicon, alt: '', referrerpolicy: 'no-referrer' })) as HTMLImageElement;
			this.rows.add(addDisposableListener(img, 'error', () => img.remove()));
		}
		const label = append(button, $('.browser-new-tab-label'));
		append(label, $('span.browser-new-tab-title')).textContent = entry.title;
		append(label, $('span.browser-new-tab-url')).textContent = entry.url;
		append(button, $('span.browser-new-tab-hint')).textContent = navigate ? browserTabBarLabels.new : entry.favorite ? browserTabBarLabels.open : browserTabBarLabels.switchTab;
		append(button, $('span.codicon.codicon-arrow-right', { 'aria-hidden': 'true' }));
		this.rows.add(addDisposableListener(button, 'focus', () => { this.selected = this.buttons.indexOf(button); this.updateSelection(); }));
		this.rows.add(addDisposableListener(button, 'click', () => { this.close(true); entry.run(); }));
		this.buttons.push(button);
	}

	private updateSelection(): void {
		this.buttons.forEach((button, index) => { button.classList.toggle('selected', index === this.selected); button.setAttribute('aria-selected', String(index === this.selected)); });
		const active = this.buttons[this.selected];
		if (active) { this.input.setAttribute('aria-activedescendant', active.id); } else { this.input.removeAttribute('aria-activedescendant'); }
		this.buttons[this.selected]?.scrollIntoView({ block: 'nearest' });
	}
}

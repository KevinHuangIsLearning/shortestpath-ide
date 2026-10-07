/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type ParserChoice = { id: string; name: string; patterns: string[]; matched: boolean };
export type ImportControlLabels = {
	add: string; choose: string; search: string; empty: string; importing: string;
	success: string; cancelled: string; matched: string; close: string; drag: string; collapse: string; expand: string;
};

/** Runs in the browser's isolated world. Keep this function self-contained. */
export function mountImportControl(labels: ImportControlLabels, initiallyCollapsed = false): void {
	const scope = window as typeof window & {
		ShortestPathCompanionInspect?: () => ParserChoice[];
		__shortestpathImportProblem: (payload: string) => void;
		__shortestpathImportButtonCleanup?: () => void;
		__shortestpathImportButtonCollapse?: () => void;
		__shortestpathImportButtonBusy?: (busy: boolean) => void;
		__shortestpathImportButtonResult?: (result: { count: number; error?: string; cancelled?: boolean }) => void;
	};
	if (window !== window.top || !/^https?:$/.test(location.protocol) || scope.__shortestpathImportButtonCleanup) { return; }
	scope.__shortestpathImportButtonCollapse = () => { initiallyCollapsed = true; };
	let host: HTMLElement | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let resetTimer: ReturnType<typeof setTimeout> | undefined;
	let resize: (() => void) | undefined;
	const mount = () => {
		host = document.createElement('div'); host.id = 'shortestpath-import-button';
		host.style.cssText = 'all:initial!important;position:fixed!important;right:20px!important;bottom:20px!important;z-index:2147483647!important;display:block!important;color-scheme:light dark!important';
		const root = host.attachShadow({ mode: 'closed' });
		const style = new CSSStyleSheet();
		style.replaceSync( `
			:host{font:13px/1.5 system-ui;color:#242424} *{box-sizing:border-box}
			.wrap{font:13px/1.5 system-ui;--bg:#fff;--fg:#242424;--line:#d5d5d5;--hover:#f0f2f4;--accent:#237b4b;color:var(--fg)}
			@media(prefers-color-scheme:dark){.wrap{font:13px/1.5 system-ui;--bg:#252526;--fg:#eee;--line:#505050;--hover:#363638;--accent:#34875b}}
			button,input{font:inherit;color:inherit} button{cursor:pointer;border:1px solid var(--line);background:var(--bg);padding:6px 10px;border-radius:6px}
			button:hover{background:var(--hover)} button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
			button:disabled{opacity:.6;cursor:wait} [hidden]{display:none!important}
			.drag{cursor:grab;touch-action:none;padding:6px;color:var(--fg)} .drag:active{cursor:grabbing}
			.toggle[data-collapsed=true]{width:28px;height:28px;padding:0;border-radius:50%;opacity:.4;touch-action:none;cursor:grab} .toggle[data-collapsed=true]:hover,.toggle[data-collapsed=true]:focus-visible{opacity:.8} .toggle[data-collapsed=true]:active{cursor:grabbing}
			.bar{display:flex;justify-content:flex-end;gap:4px;max-width:calc(100vw - 40px)} .add{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0} .add{background:var(--accent);color:#fff;border-color:var(--accent)} .add:hover{filter:brightness(1.08);background:var(--accent)}
			.panel{max-height:min(410px,calc(65vh - 60px));overflow:auto;width:min(340px,calc(100vw - 40px));margin-bottom:8px;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);box-shadow:0 6px 24px #0003}
			.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.header span{font-weight:600}.close{border:0;padding:0 6px}
			input{display:block;width:100%;padding:7px 8px;background:var(--bg);border:1px solid var(--line);border-radius:4px}
			.list{max-height:min(300px,50vh);overflow:auto;margin-top:8px}.item{display:block;text-align:left;width:100%;border:0;border-radius:4px;padding:7px 8px}.item small{display:block;opacity:.7;overflow-wrap:anywhere}
			.status{max-height:25vh;overflow:auto;max-width:min(340px,calc(100vw - 40px));white-space:pre-wrap;overflow-wrap:anywhere;background:var(--bg);border-radius:6px;margin-top:6px;padding:6px 8px}.status:empty{display:none}
		`);
		root.adoptedStyleSheets = [style];
		const wrap = document.createElement('div'); wrap.className = 'wrap';
		const panel = document.createElement('div'); panel.className = 'panel'; panel.hidden = true;
		const header = document.createElement('div'); header.className = 'header';
		const heading = document.createElement('span'); heading.textContent = labels.choose;
		const close = document.createElement('button'); close.type = 'button'; close.className = 'close'; close.textContent = '×'; close.setAttribute('aria-label', labels.close);
		const input = document.createElement('input'); input.type = 'search'; input.placeholder = labels.search; input.setAttribute('aria-label', labels.search);
		const list = document.createElement('div'); list.className = 'list';
		const bar = document.createElement('div'); bar.className = 'bar';
		const drag = document.createElement('button'); drag.type = 'button'; drag.className = 'drag'; drag.textContent = '⠿'; drag.title = labels.drag; drag.setAttribute('aria-label', labels.drag);
		const add = document.createElement('button'); add.type = 'button'; add.className = 'add'; add.textContent = labels.add; add.hidden = true;
		const choose = document.createElement('button'); choose.className = 'choose'; choose.type = 'button'; choose.textContent = labels.choose; choose.setAttribute('aria-expanded', 'false');
		const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'toggle';
		const status = document.createElement('div'); status.className = 'status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
		header.append(heading, close); panel.append(header, input, list); bar.append(drag, add, choose, toggle); wrap.append(panel, bar, status); root.append(wrap); document.documentElement.append(host!);
		const clampPosition = (right: number, bottom: number) => {
			const bounds = host!.getBoundingClientRect();
			host!.style.setProperty('right', `${Math.max(8, Math.min(right, innerWidth - bounds.width - 8))}px`, 'important');
			host!.style.setProperty('bottom', `${Math.max(8, Math.min(bottom, innerHeight - bounds.height - 8))}px`, 'important');
		};
		resize = () => clampPosition(parseFloat(host!.style.right), parseFloat(host!.style.bottom));
		window.addEventListener('resize', resize);
		let choices: ParserChoice[] = [], selected: string | undefined, manual = false, busy = false, collapsed = initiallyCollapsed;
		let toggleDragged = false;
		let dragging: { pointer: number; x: number; y: number; right: number; bottom: number } | undefined;
		const registerDrag = (control: HTMLButtonElement) => {
			control.addEventListener('pointerdown', event => {
				if (!event.isTrusted || event.button !== 0 || (control === toggle && !collapsed)) { return; }
				event.preventDefault();
				if (control === toggle) { toggleDragged = false; }
				dragging = { pointer: event.pointerId, x: event.clientX, y: event.clientY, right: parseFloat(host!.style.right), bottom: parseFloat(host!.style.bottom) };
				control.setPointerCapture(event.pointerId);
			});
			control.addEventListener('pointermove', event => {
				if (!dragging || event.pointerId !== dragging.pointer) { return; }
				const dx = event.clientX - dragging.x, dy = event.clientY - dragging.y;
				if (control === toggle) {
					if (Math.hypot(dx, dy) < 4 && !toggleDragged) { return; }
					toggleDragged = true;
				}
				clampPosition(dragging.right - dx, dragging.bottom - dy);
			});
			control.addEventListener('pointerup', () => { dragging = undefined; });
			control.addEventListener('pointercancel', () => { dragging = undefined; toggleDragged = false; });
			control.addEventListener('lostpointercapture', () => { dragging = undefined; });
			control.addEventListener('keydown', event => {
				if (control === toggle && !collapsed) { return; }
				const moves: Record<string, [number, number]> = { ArrowLeft: [16, 0], ArrowRight: [-16, 0], ArrowUp: [0, 16], ArrowDown: [0, -16] };
				const move = moves[event.key]; if (!move) { return; }
				event.preventDefault(); clampPosition(parseFloat(host!.style.right) + move[0], parseFloat(host!.style.bottom) + move[1]);
			});
		};
		registerDrag(drag); registerDrag(toggle);
		let pageUrl = location.href, signature = '';
		const hidePanel = () => { panel.hidden = true; choose.setAttribute('aria-expanded', 'false'); choose.focus(); resize?.(); };
		const refreshButton = () => {
			const parser = choices.find(choice => choice.id === selected);
			add.hidden = collapsed || !parser; add.title = parser?.name ?? labels.add;
			add.textContent = busy ? labels.importing : manual && parser ? `${labels.add} · ${parser.name}` : labels.add;
			choose.textContent = parser ? '▾' : labels.choose;
			choose.setAttribute('aria-label', labels.choose);
			choose.hidden = collapsed; status.hidden = collapsed; drag.hidden = collapsed;
			toggle.setAttribute('data-collapsed', String(collapsed));
			toggle.textContent = collapsed ? '+' : '−';
			toggle.title = collapsed ? labels.expand : labels.collapse;
			toggle.setAttribute('aria-label', toggle.title);
			toggle.setAttribute('aria-expanded', String(!collapsed));
			resize?.();
		};
		const render = () => {
			list.replaceChildren();
			const query = input.value.trim().toLowerCase();
			const filtered = choices.filter(choice => `${choice.name} ${choice.id} ${choice.patterns.join(' ')}`.toLowerCase().includes(query)).sort((a, b) => Number(b.matched) - Number(a.matched) || a.name.localeCompare(b.name));
			for (const parser of filtered) {
				const item = document.createElement('button'); item.type = 'button'; item.className = 'item';
				item.setAttribute('aria-pressed', String(parser.id === selected));
				item.textContent = parser.name + (parser.matched ? ` · ${labels.matched}` : '');
				const detail = document.createElement('small'); detail.textContent = parser.patterns.join(', '); item.append(detail);
				item.addEventListener('click', event => {
					if (!event.isTrusted || busy) { return; }
					selected = parser.id; manual = true; status.textContent = ''; refreshButton(); hidePanel(); add.focus();
				});
				list.append(item);
			}
			if (!filtered.length) { list.textContent = labels.empty; }
		};
		const inspect = () => {
			if (busy) { return; }
			if (location.href !== pageUrl) { pageUrl = location.href; selected = undefined; manual = false; status.textContent = ''; panel.hidden = true; choose.setAttribute('aria-expanded', 'false'); }
			choices = scope.ShortestPathCompanionInspect?.() ?? [];
			if (!manual) { selected = choices.find(choice => choice.matched)?.id; }
			refreshButton();
			const next = JSON.stringify(choices);
			if (signature !== next) { signature = next; render(); }
		};
		scope.__shortestpathImportButtonCollapse = () => { collapsed = true; panel.hidden = true; choose.setAttribute('aria-expanded', 'false'); refreshButton(); };
		toggle.addEventListener('click', event => {
			if (!event.isTrusted) { return; }
			if (toggleDragged && event.detail !== 0) { toggleDragged = false; return; }
			toggleDragged = false;
			collapsed = !collapsed; panel.hidden = true; choose.setAttribute('aria-expanded', 'false');
			refreshButton(); toggle.focus();
		});
		choose.addEventListener('click', event => { if (!event.isTrusted || busy || collapsed) { return; } panel.hidden = !panel.hidden; choose.setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden) { inspect(); render(); resize?.(); input.focus(); } });
		close.addEventListener('click', hidePanel);
		input.addEventListener('input', render);
		panel.addEventListener('keydown', event => {
			if (event.key === 'Escape') { event.preventDefault(); hidePanel(); }
			if (event.key === 'ArrowDown' && event.target === input) { event.preventDefault(); list.querySelector<HTMLButtonElement>('button')?.focus(); }
		});
		add.addEventListener('click', event => {
			if (!event.isTrusted || busy || collapsed) { return; }
			inspect(); if (!selected) { return; }
			scope.__shortestpathImportButtonBusy?.(true);
			scope.__shortestpathImportProblem(JSON.stringify({ action: 'import', parserId: selected, url: pageUrl }));
		});
		scope.__shortestpathImportButtonBusy = value => { busy = value; add.disabled = value; choose.disabled = value; panel.hidden = true; choose.setAttribute('aria-expanded', 'false'); if (value) { clearTimeout(resetTimer); status.textContent = labels.importing; } refreshButton(); };
		scope.__shortestpathImportButtonResult = result => {
			if (result.count > 0) { scope.__shortestpathImportButtonCollapse?.(); }
			const completed = result.count ? labels.success.replace('{0}', String(result.count)) : '';
			status.textContent = [completed, result.error ?? (result.cancelled ? labels.cancelled : '')].filter(Boolean).join('\n');
			resize?.();
			if (!result.error) { resetTimer = setTimeout(() => { status.textContent = ''; resize?.(); }, 4000); }
		};
		inspect(); timer = setInterval(inspect, 1000);
	};
	scope.__shortestpathImportButtonCleanup = () => {
		document.removeEventListener('DOMContentLoaded', mount); if (resize) { window.removeEventListener('resize', resize); } clearInterval(timer); clearTimeout(resetTimer); host?.remove();
		delete scope.__shortestpathImportButtonCollapse; delete scope.__shortestpathImportButtonBusy; delete scope.__shortestpathImportButtonResult; delete scope.__shortestpathImportButtonCleanup;
	};
	if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', mount, { once: true }); } else { mount(); }
}

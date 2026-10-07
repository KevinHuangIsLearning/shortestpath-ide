/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ClientMessage } from '../protocol';
import { DrawStrings } from '../strings';

export type DrawingExportFormat = Extract<ClientMessage, { type: 'export' }>['format'];

export function ExportMenu({ strings, disabled, onExport }: { strings: DrawStrings; disabled: boolean; onExport: (format: DrawingExportFormat) => void }) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	const trigger = useRef<HTMLButtonElement>(null);
	const focusLast = useRef(false);
	useEffect(() => {
		if (!open || !root.current) { return; }
		const menu = root.current;
		const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !menu.contains(event.target)) { setOpen(false); } };
		globalThis.document.addEventListener('pointerdown', dismiss);
		const items = menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
		(focusLast.current ? items[items.length - 1] : items[0])?.focus();
		focusLast.current = false;
		return () => globalThis.document.removeEventListener('pointerdown', dismiss);
	}, [open]);
	const close = () => { setOpen(false); trigger.current?.focus(); };
	const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); return; }
		if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { return; }
		if (!open && (event.key === 'Home' || event.key === 'End')) { return; }
		event.preventDefault();
		if (!open) { focusLast.current = event.key === 'ArrowUp'; setOpen(true); return; }
		const items = Array.from(root.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
		const index = items.findIndex(item => item === globalThis.document.activeElement);
		const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
			: index < 0 ? event.key === 'ArrowUp' ? items.length - 1 : 0
				: (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
		items[next]?.focus();
	};
	const choose = (format: DrawingExportFormat) => { close(); onExport(format); };
	return <div className="sketchpad-export" ref={root} onKeyDown={navigate}
		onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); } }}>
		<button ref={trigger} disabled={disabled} aria-haspopup="menu" aria-expanded={open} aria-controls="sketchpad-export-menu" onClick={() => setOpen(value => !value)}>
			{strings.export} <span aria-hidden="true">▾</span>
		</button>
		{open && <div id="sketchpad-export-menu" className="sketchpad-export-menu" role="menu" aria-label={strings.exportTitle}>
			<button role="menuitem" onClick={() => choose('excalidraw')}>{strings.drawing}</button>
			<button role="menuitem" onClick={() => choose('png')}>{strings.image}</button>
			<button role="menuitem" onClick={() => choose('svg')}>{strings.vector}</button>
		</div>}
	</div>;
}

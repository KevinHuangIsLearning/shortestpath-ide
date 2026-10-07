/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWindow } from '../../../../base/browser/dom.js';
import { encodeBase64 } from '../../../../base/common/buffer.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IBrowserViewModel } from '../../browserView/common/browserView.js';

type OverlayModel = Pick<IBrowserViewModel, 'visible' | 'captureScreenshot' | 'setVisible'>;

/** Preserves the current page frame when DOM overlays need to cover the native browser surface. */
export class ShortestPathBrowserOverlay extends Disposable {
	private model: OverlayModel | undefined;
	private obscured = false;
	private generation = 0;
	private pending: { generation: number; task: Promise<void> } | undefined;

	constructor(
		private readonly page: HTMLElement,
		private readonly waitForPaint = async (dataUrl: string) => {
			const window = getWindow(page);
			const image = window.document.createElement('img');
			image.src = dataUrl;
			await image.decode();
			await new Promise<void>(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
		}
	) { super(); }

	update(model: OverlayModel | undefined, obscured: boolean): Promise<void> {
		if (this.model !== model || this.obscured !== obscured) {
			this.generation++;
			if (this.model !== model) { this.page.style.backgroundImage = ''; }
			this.model = model;
			this.obscured = obscured;
		}
		if (!model || !obscured || !model.visible || this._store.isDisposed) { return Promise.resolve(); }
		if (this.pending?.generation === this.generation) { return this.pending.task; }
		const generation = this.generation;
		const task = this.hideAfterPaint(model, generation).finally(() => {
			if (this.pending?.generation === generation) { this.pending = undefined; }
		});
		this.pending = { generation, task };
		return task;
	}

	private async hideAfterPaint(model: OverlayModel, generation: number): Promise<void> {
		let screenshot;
		try {
			screenshot = await model.captureScreenshot({ quality: 80 });
		} catch {
			// If Chromium has not produced a frame yet, retain the live page rather than blanking it.
			return;
		}
		if (!this.isCurrent(model, generation)) { return; }
		const dataUrl = `data:image/jpeg;base64,${encodeBase64(screenshot)}`;
		this.page.style.backgroundImage = `url('${dataUrl}')`;
		try {
			await this.waitForPaint(dataUrl);
		} catch { return; }
		if (this.isCurrent(model, generation)) { await model.setVisible(false); }
	}

	private isCurrent(model: OverlayModel, generation: number): boolean {
		return !this._store.isDisposed && this.model === model && this.obscured && this.generation === generation;
	}

	override dispose(): void {
		this.generation++;
		this.page.style.backgroundImage = '';
		super.dispose();
	}
}

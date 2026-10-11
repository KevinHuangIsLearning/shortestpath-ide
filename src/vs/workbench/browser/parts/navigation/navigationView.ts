/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, size } from '../../../../base/browser/dom.js';
import { ISerializableView } from '../../../../base/browser/ui/grid/grid.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

/** A fixed navigation column that remains separate from movable workbench parts. */
export class NavigationView extends Disposable implements ISerializableView {
	static readonly ID = 'workbench.navigation';
	readonly element = $('.workbench-navigation-slot');
	readonly container = append(this.element, $('.workbench-navigation'));
	private compact = false;
	get minimumWidth(): number { return this.compact ? 0 : 48; }
	get maximumWidth(): number { return this.minimumWidth; }
	readonly minimumHeight = 0;
	readonly maximumHeight = Number.POSITIVE_INFINITY;
	private readonly change = this._register(new Emitter<undefined>());
	readonly onDidChange = this.change.event;

	/** Move the existing controls together, preserving their state and listeners. */
	setTitlebarContainer(titlebar: HTMLElement | undefined): void {
		const compact = !!titlebar;
		if (this.compact === compact) { return; }
		this.compact = compact;
		(titlebar ?? this.element).append(this.container);
		this.container.classList.toggle('compact-navigation', compact);
		this.change.fire(undefined);
	}

	layout(width: number, height: number): void {
		size(this.element, width, height);
	}

	toJSON(): object {
		return { type: NavigationView.ID };
	}
}

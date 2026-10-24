/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, size } from '../../../../base/browser/dom.js';
import { ISerializableView } from '../../../../base/browser/ui/grid/grid.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

/** A fixed navigation column that remains separate from movable workbench parts. */
export class NavigationView extends Disposable implements ISerializableView {
	static readonly ID = 'workbench.navigation';
	readonly element = $('.workbench-navigation');
	private width = 48;
	get minimumWidth(): number { return this.width; }
	get maximumWidth(): number { return this.width; }
	readonly minimumHeight = 0;
	readonly maximumHeight = Number.POSITIVE_INFINITY;
	private readonly changeEmitter = this._register(new Emitter<undefined>());
	readonly onDidChange = this.changeEmitter.event;

	setWidth(width: number, compact: boolean): void {
		this.element.classList.toggle('compact', compact);
		if (this.width !== width) {
			this.width = width;
			this.changeEmitter.fire(undefined);
		}
	}

	layout(width: number, height: number): void {
		size(this.element, width, height);
	}

	toJSON(): object {
		return { type: NavigationView.ID };
	}
}

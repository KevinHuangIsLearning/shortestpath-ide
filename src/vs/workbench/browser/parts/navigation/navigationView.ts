/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, size } from '../../../../base/browser/dom.js';
import { ISerializableView } from '../../../../base/browser/ui/grid/grid.js';
import { Event } from '../../../../base/common/event.js';

/** A fixed navigation column that remains separate from movable workbench parts. */
export class NavigationView implements ISerializableView {
	static readonly ID = 'workbench.navigation';
	readonly element = $('.workbench-navigation');
	readonly minimumWidth = 56;
	readonly maximumWidth = 56;
	readonly minimumHeight = 0;
	readonly maximumHeight = Number.POSITIVE_INFINITY;
	readonly onDidChange = Event.None;

	layout(width: number, height: number): void {
		size(this.element, width, height);
	}

	toJSON(): object {
		return { type: NavigationView.ID };
	}
}

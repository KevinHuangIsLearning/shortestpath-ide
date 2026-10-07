/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';

// Keep these command IDs for extensions and existing user keybindings. They
// only close the disabled part and contribute no menus, keybindings or palette entries.
export class ToggleAuxiliaryBarAction extends Action2 {
	static readonly ID = 'workbench.action.toggleAuxiliaryBar';

	constructor() {
		super({ id: ToggleAuxiliaryBarAction.ID, title: localize2('toggleAuxiliaryBar', "Toggle Secondary Side Bar Visibility") });
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IWorkbenchLayoutService).setPartHidden(true, Parts.AUXILIARYBAR_PART);
	}
}
registerAction2(ToggleAuxiliaryBarAction);

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'workbench.action.closeAuxiliaryBar', title: localize2('closeSecondarySideBar', 'Hide Secondary Side Bar') });
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IWorkbenchLayoutService).setPartHidden(true, Parts.AUXILIARYBAR_PART);
	}
});

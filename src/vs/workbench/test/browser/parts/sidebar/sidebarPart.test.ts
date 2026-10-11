/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Orientation, Sash } from '../../../../../base/browser/ui/sash/sash.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Event } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../../../common/views.js';
import { SidebarPart } from '../../../../browser/parts/sidebar/sidebarPart.js';
import { IWorkbenchLayoutService, Parts, Position } from '../../../../services/layout/browser/layoutService.js';
import { TestLayoutService, workbenchInstantiationService } from '../../workbenchTestServices.js';

class TestSidebarLayoutService extends TestLayoutService {
	sideBarPosition = Position.LEFT;

	override getSideBarPosition(): Position {
		return this.sideBarPosition;
	}
}

class TestViewDescriptorService extends mock<IViewDescriptorService>() {
	override readonly onDidChangeViewContainers = Event.None;
	override readonly onDidChangeContainerLocation = Event.None;

	override getDefaultViewContainer(_location: ViewContainerLocation) {
		return undefined;
	}

	override getViewContainersByLocation(_location: ViewContainerLocation) {
		return [];
	}
}

suite('SidebarPart', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('Sketchpad redirects ordinary sidebar opens even when extensions register after entering the mode', async () => {
		let drawing = false;
		let registered = false;
		const registration = new DeferredPromise<void>();
		const opened: string[] = [];
		const part = Object.assign(Object.create(SidebarPart.prototype), {
			partId: Parts.SIDEBAR_PART,
			contextKeyService: { getContextKeyValue: () => drawing },
			extensionService: { whenInstalledExtensionsRegistered: () => registration.p },
			getPaneComposite: () => registered ? {} : undefined,
			layoutService: { isVisible: () => true },
			openComposite: (id: string) => { opened.push(id); return undefined; },
		}) as SidebarPart;
		const opening = part.openPaneComposite('workbench.view.explorer', true);
		drawing = true;
		registered = true;
		registration.complete();
		await opening;
		assert.deepStrictEqual(opened, ['workbench.view.extension.shortestpath-draw']);
		await part.openPaneComposite('workbench.view.search', true);
		assert.deepStrictEqual(opened, ['workbench.view.extension.shortestpath-draw', 'workbench.view.extension.shortestpath-draw']);
		drawing = false;
		await part.openPaneComposite('workbench.view.explorer', true);
		assert.strictEqual(opened.at(-1), 'workbench.view.explorer');
	});

	test('moves the primary side bar class to the inward boundary sash', () => {
		const instantiationService = workbenchInstantiationService(undefined, store);
		const layoutService = new TestSidebarLayoutService();
		instantiationService.stub(IWorkbenchLayoutService, layoutService);
		instantiationService.stub(IViewDescriptorService, new TestViewDescriptorService());

		const part = store.add(instantiationService.createInstance(SidebarPart));
		const container = document.createElement('div');
		const leftSash = store.add(new Sash(container, { getVerticalSashLeft: () => 0 }, { orientation: Orientation.VERTICAL }));
		const rightSash = store.add(new Sash(container, { getVerticalSashLeft: () => 0 }, { orientation: Orientation.VERTICAL }));
		const leftSashElement = container.children.item(0);
		const rightSashElement = container.children.item(1);
		const states: boolean[][] = [];
		const captureState = () => states.push([
			leftSashElement?.classList.contains('primary-sidebar-sash') ?? false,
			rightSashElement?.classList.contains('primary-sidebar-sash') ?? false,
		]);

		part.setBoundarySashes({ left: leftSash, right: rightSash });
		captureState();

		layoutService.sideBarPosition = Position.RIGHT;
		part.setBoundarySashes({ left: leftSash, right: rightSash });
		captureState();

		part.dispose();
		captureState();

		assert.deepStrictEqual(states, [
			[false, true],
			[true, false],
			[false, false],
		]);
	});
});

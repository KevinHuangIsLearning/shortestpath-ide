/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { IDisposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { GroupDirection, GroupsOrder, IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';

export const SHORTESTPATH_OJ_PRIMARY_GROUP_RATIO = 0.6;

const SHORTESTPATH_OJ_PRIMARY_GROUP_RATIO_STORAGE_KEY = 'shortestpath.oj.primaryGroupRatio';
const SHORTESTPATH_OJ_PROBLEM_VIEW_TYPE = 'shortestpath.ojProblem';

export function getShortestPathOjPrimaryGroupRatio(storageService: IStorageService): number {
	const stored = storageService.get(SHORTESTPATH_OJ_PRIMARY_GROUP_RATIO_STORAGE_KEY, StorageScope.PROFILE);
	if (stored === undefined) {
		return SHORTESTPATH_OJ_PRIMARY_GROUP_RATIO;
	}

	const ratio = Number.parseFloat(stored);
	if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) {
		return SHORTESTPATH_OJ_PRIMARY_GROUP_RATIO;
	}

	return ratio;
}

export function rememberShortestPathOjPrimaryGroupRatio(storageService: IStorageService, ratio: number): void {
	const clamped = Math.min(0.95, Math.max(0.05, ratio));
	storageService.store(SHORTESTPATH_OJ_PRIMARY_GROUP_RATIO_STORAGE_KEY, clamped, StorageScope.PROFILE, StorageTarget.USER);
}

export function getShortestPathOjPrimaryGroupWidth(
	primaryWidth: number,
	secondaryWidth: number,
	ratio: number = SHORTESTPATH_OJ_PRIMARY_GROUP_RATIO,
): number | undefined {
	const totalWidth = primaryWidth + secondaryWidth;
	if (!Number.isFinite(totalWidth) || totalWidth <= 0) {
		return undefined;
	}

	return Math.round(totalWidth * ratio);
}

const isShortestPathOjProblemEditor = (editor: EditorInput): boolean =>
	editor.resource?.scheme === Schemas.webviewPanel && editor.editorId === SHORTESTPATH_OJ_PROBLEM_VIEW_TYPE;

const isShortestPathOjProblemGroup = (group: IEditorGroup): boolean =>
	group.editors.some(isShortestPathOjProblemEditor);

/**
 * Remembers the split ratio (left group width over the combined width of the
 * two adjacent groups) whenever the user finishes dragging an editor sash
 * while the ShortestPath OJ problem panel is open. The remembered ratio is
 * applied the next time the OJ problem panel is opened in a fresh split.
 *
 * Sash drags are observed through the sash DOM elements (`.monaco-sash`)
 * instead of grid-internal events so that no upstream editor part code
 * needs to change.
 */
export function registerShortestPathOjGroupRatioMemory(
	editorGroupsService: IEditorGroupsService,
	storageService: IStorageService,
): IDisposable {
	const store = new DisposableStore();

	store.add(addDisposableListener(mainWindow, 'pointerdown', (event: PointerEvent) => {
		const target = event.target;
		if (!(target instanceof Element) || !target.closest('.monaco-sash')) {
			return;
		}

		// A sash drag starts; remember the current OJ split ratio once the
		// drag ends (or when it is cancelled without a move).
		const rememberCurrentRatio = (): void => {
			const problemGroup = editorGroupsService.getGroups(GroupsOrder.GRID_APPEARANCE).find(isShortestPathOjProblemGroup);
			if (!problemGroup) {
				return;
			}

			const leftGroup = editorGroupsService.findGroup({ direction: GroupDirection.LEFT }, problemGroup);
			if (!leftGroup) {
				return;
			}

			const leftSize = editorGroupsService.getSize(leftGroup);
			const rightSize = editorGroupsService.getSize(problemGroup);
			const totalWidth = leftSize.width + rightSize.width;
			if (!Number.isFinite(totalWidth) || totalWidth <= 0) {
				return;
			}

			rememberShortestPathOjPrimaryGroupRatio(storageService, leftSize.width / totalWidth);
		};

		const dragDisposables = new DisposableStore();
		const finishDrag = (): void => {
			dragDisposables.dispose();
			rememberCurrentRatio();
		};
		dragDisposables.add(addDisposableListener(mainWindow, 'pointerup', finishDrag));
		dragDisposables.add(addDisposableListener(mainWindow, 'pointercancel', () => dragDisposables.dispose()));
		store.add(dragDisposables);
	}, true));

	return store;
}

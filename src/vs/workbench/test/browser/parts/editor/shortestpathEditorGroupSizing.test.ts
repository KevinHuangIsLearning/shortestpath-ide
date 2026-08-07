/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { URI } from '../../../../../base/common/uri.js';
import { StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorGroup, IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { TestStorageService } from '../../../common/workbenchTestServices.js';
import {
	getShortestPathOjPrimaryGroupRatio,
	getShortestPathOjPrimaryGroupWidth,
	rememberShortestPathOjPrimaryGroupRatio,
	rememberShortestPathOjProblemSplitRatio,
	SHORTESTPATH_OJ_PRIMARY_GROUP_RATIO,
} from '../../../../browser/parts/editor/shortestpathEditorGroupSizing.js';

class TestWebviewEditorInput extends EditorInput {
	override get typeId(): string { return 'test.webview'; }
	override get resource(): URI { return URI.from({ scheme: 'webview-panel', path: '/test' }); }
	override get editorId(): string { return this.viewType; }
	constructor(private readonly viewType: string) { super(); }
}

suite('ShortestPath OJ editor group sizing', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('uses a 6:4 ratio for adjacent groups by default', () => {
		assert.strictEqual(getShortestPathOjPrimaryGroupWidth(500, 500), 600);
		assert.strictEqual(getShortestPathOjPrimaryGroupWidth(720, 480), 720);
	});

	test('uses the provided ratio when given', () => {
		assert.strictEqual(getShortestPathOjPrimaryGroupWidth(500, 500, 0.75), 750);
		assert.strictEqual(getShortestPathOjPrimaryGroupWidth(720, 480, 0.5), 600);
	});

	test('does not resize groups without a usable width', () => {
		assert.strictEqual(getShortestPathOjPrimaryGroupWidth(0, 0), undefined);
	});

	test('falls back to the default ratio without a stored value', () => {
		const storageService = store.add(new TestStorageService());
		assert.strictEqual(getShortestPathOjPrimaryGroupRatio(storageService), SHORTESTPATH_OJ_PRIMARY_GROUP_RATIO);
	});

	test('remembers the ratio and reads it back', () => {
		const storageService = store.add(new TestStorageService());
		rememberShortestPathOjPrimaryGroupRatio(storageService, 0.7);
		assert.strictEqual(getShortestPathOjPrimaryGroupRatio(storageService), 0.7);
	});

	test('clamps out-of-range ratios when remembering', () => {
		const storageService = store.add(new TestStorageService());
		rememberShortestPathOjPrimaryGroupRatio(storageService, 1.5);
		assert.strictEqual(getShortestPathOjPrimaryGroupRatio(storageService), 0.95);
		rememberShortestPathOjPrimaryGroupRatio(storageService, -0.2);
		assert.strictEqual(getShortestPathOjPrimaryGroupRatio(storageService), 0.05);
	});

	test('ignores invalid stored values', () => {
		const storageService = store.add(new TestStorageService());
		storageService.store('shortestpath.oj.primaryGroupRatio', 0, StorageScope.PROFILE, StorageTarget.USER);
		assert.strictEqual(getShortestPathOjPrimaryGroupRatio(storageService), SHORTESTPATH_OJ_PRIMARY_GROUP_RATIO);
	});

	test('remembers the split ratio next to the OJ panel', () => {
		const storageService = store.add(new TestStorageService());
		const problemGroup = { editors: [store.add(new TestWebviewEditorInput('shortestpath.ojProblem'))] } as unknown as IEditorGroup;
		const codeGroup = { editors: [] } as unknown as IEditorGroup;
		const groupsService = {
			getGroups: () => [codeGroup, problemGroup],
			findGroup: () => codeGroup,
			getSize: (group: IEditorGroup) => group === codeGroup ? { width: 700, height: 600 } : { width: 300, height: 600 },
		} as unknown as IEditorGroupsService;

		rememberShortestPathOjProblemSplitRatio(groupsService, storageService);

		assert.strictEqual(getShortestPathOjPrimaryGroupRatio(storageService), 0.7);
	});

	test('does not remember the ratio when the OJ panel is not open', () => {
		const storageService = store.add(new TestStorageService());
		const codeGroup = { editors: [] } as unknown as IEditorGroup;
		const groupsService = {
			getGroups: () => [codeGroup],
			findGroup: () => undefined,
			getSize: () => ({ width: 100, height: 600 }),
		} as unknown as IEditorGroupsService;

		rememberShortestPathOjProblemSplitRatio(groupsService, storageService);

		assert.strictEqual(getShortestPathOjPrimaryGroupRatio(storageService), SHORTESTPATH_OJ_PRIMARY_GROUP_RATIO);
	});
});

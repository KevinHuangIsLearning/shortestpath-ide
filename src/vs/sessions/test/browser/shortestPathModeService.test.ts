/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../base/common/async.js';
import { errorHandler, setUnexpectedErrorHandler } from '../../../base/common/errors.js';
import { mock } from '../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { BrowserEditorInput } from '../../../workbench/contrib/browserView/common/browserEditorInput.js';
import { IBrowserViewWorkbenchService } from '../../../workbench/contrib/browserView/common/browserView.js';
import { IEditorService } from '../../../workbench/services/editor/common/editorService.js';
import { SessionsShortestPathModeService } from '../../browser/shortestPathModeService.js';

suite('Sessions ShortestPath browser commands', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('shared new-tab command opens a fresh browser without a supplied URL', async () => {
		const requested = new DeferredPromise<{ url: string | undefined; newTab: boolean | undefined }>();
		const input = new class extends mock<BrowserEditorInput>() { };
		const service = new class extends SessionsShortestPathModeService {
			override async openBrowser(url?: string, newTab?: boolean): Promise<BrowserEditorInput> {
				requested.complete({ url, newTab });
				return input;
			}
		}(new class extends mock<IEditorService>() { }, new class extends mock<IBrowserViewWorkbenchService>() { });
		service.newBrowserTab();
		assert.deepStrictEqual(await requested.p, { url: undefined, newTab: true });
	});

	test('shared new-tab command reports browser creation failures', async () => {
		const failure = new Error('Browser creation failed');
		const reported = new DeferredPromise<Error>();
		const service = new class extends SessionsShortestPathModeService {
			override async openBrowser(): Promise<BrowserEditorInput> { throw failure; }
		}(new class extends mock<IEditorService>() { }, new class extends mock<IBrowserViewWorkbenchService>() { });
		const original = errorHandler.getUnexpectedErrorHandler();
		setUnexpectedErrorHandler(error => reported.complete(error));
		try {
			service.newBrowserTab();
			assert.strictEqual(await reported.p, failure);
		} finally {
			setUnexpectedErrorHandler(original);
		}
	});
});

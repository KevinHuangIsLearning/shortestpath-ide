/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Event } from '../../../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { createModelServices } from '../../../../../editor/test/common/testTextModel.js';
import { getSnippetSuggestSupport, setSnippetSuggestSupport } from '../../../../../editor/contrib/suggest/browser/suggest.js';
import { IExtensionResourceLoaderService } from '../../../../../platform/extensionResourceLoader/common/extensionResourceLoader.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { toUserDataProfile } from '../../../../../platform/userDataProfile/common/userDataProfile.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { ILifecycleService } from '../../../../services/lifecycle/common/lifecycle.js';
import { ITextFileEditorModelManager, ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { IUserDataProfileService } from '../../../../services/userDataProfile/common/userDataProfile.js';
import { UserDataProfileService } from '../../../../services/userDataProfile/common/userDataProfileService.js';
import { TestLifecycleService, TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { SnippetsService } from '../../browser/snippetsService.js';

suite('Snippets loading', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('the first request waits for user snippets to finish loading', async () => {
		const instantiationService = createModelServices(store.add(new DisposableStore()));
		const profile = toUserDataProfile('test', 'Test', URI.file('/profile'), URI.file('/cache'));
		const started = new DeferredPromise<void>();
		const release = new DeferredPromise<void>();
		let blockInitialization = false;
		const fileService = store.add(new class extends FileService {
			override async createFolder(resource: URI) {
				if (blockInitialization && resource.toString() === profile.snippetsHome.toString()) {
					await started.complete();
					await release.p;
				}
				return super.createFolder(resource);
			}
		}(new NullLogService()));
		store.add(fileService.registerProvider('file', store.add(new InMemoryFileSystemProvider())));
		await fileService.createFolder(profile.snippetsHome);
		await fileService.writeFile(joinPath(profile.snippetsHome, 'cpp.json'), VSBuffer.fromString(JSON.stringify({
			cpp_template: { prefix: 'cpp', body: ['int main() {', '\treturn 0;', '}'] }
		})));
		instantiationService.stub(IFileService, fileService);
		instantiationService.stub(IUserDataProfileService, store.add(new UserDataProfileService(profile)));
		instantiationService.stub(IStorageService, store.add(new TestStorageService()));
		instantiationService.stub(ILifecycleService, store.add(new TestLifecycleService()));
		instantiationService.stub(IWorkspaceContextService, new class extends mock<IWorkspaceContextService>() {
			override onDidChangeWorkspaceFolders = Event.None;
			override onDidChangeWorkbenchState = Event.None;
			override getWorkspace() { return { id: 'empty', folders: [] }; }
		});
		instantiationService.stub(ITextFileService, new class extends mock<ITextFileService>() {
			override files = new class extends mock<ITextFileEditorModelManager>() {
				override onDidSave = Event.None;
			};
		});
		instantiationService.stub(IExtensionResourceLoaderService, new class extends mock<IExtensionResourceLoaderService>() { });
		store.add(instantiationService.get(ILanguageService).registerLanguage({ id: 'cpp' }));
		const previousSupport = getSnippetSuggestSupport();
		store.add(toDisposable(() => setSnippetSuggestSupport(previousSupport)));
		blockInitialization = true;
		const service = store.add(instantiationService.createInstance(SnippetsService));
		const firstRequest = service.getSnippets('cpp', URI.file('/project/a.cpp'));
		await started.p;
		await release.complete();
		assert.deepStrictEqual((await firstRequest).map(snippet => ({ name: snippet.name, prefix: snippet.prefix, body: snippet.body })), [
			{ name: 'cpp_template', prefix: 'cpp', body: 'int main() {\n\treturn 0;\n}' }
		]);
	});
});

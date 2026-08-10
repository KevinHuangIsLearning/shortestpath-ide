/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import severity from '../../../../base/common/severity.js';
import { URI } from '../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { asJson, IRequestService } from '../../../../platform/request/common/request.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorExtensions } from '../../../common/editor.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { GroupOrientation, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { IShortestPathUpdate, IShortestPathUpdateDocument, isShortestPathUpdateAvailable, isShortestPathVersionSupported, parseShortestPathUpdateDocument } from './shortestPathUpdate.js';
import { ShortestPathUpdateRequiredEditor } from './shortestPathUpdateRequiredEditor.js';
import { ShortestPathUpdateRequiredInput } from './shortestPathUpdateRequiredInput.js';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	// allow-any-unicode-next-line
	EditorPaneDescriptor.create(ShortestPathUpdateRequiredEditor, ShortestPathUpdateRequiredEditor.ID, '需要升级'),
	[new SyncDescriptor(ShortestPathUpdateRequiredInput)]
);

class ShortestPathUpdateChecker {

	constructor(
		@IRequestService private readonly requestService: IRequestService,
		@IDialogService private readonly dialogService: IDialogService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IProductService private readonly productService: IProductService,
	) { }

	async check(explicit: boolean): Promise<IShortestPathUpdate | undefined> {
		const currentVersion = this.productService.shortestPathVersion;
		const updateUrl = this.productService.shortestPathUpdateUrl;
		if (!currentVersion || !updateUrl) {
			return undefined;
		}

		const response = await this.requestService.request({
			type: 'GET',
			url: updateUrl,
			disableCache: true,
			timeout: 10000,
			callSite: 'shortestPathUpdate.check',
		}, CancellationToken.None);
		if (response.res.statusCode !== 200) {
			throw new Error(`Failed to check for ShortestPath IDE updates: HTTP ${response.res.statusCode}`);
		}

		const updateDocument = await asJson<IShortestPathUpdateDocument>(response);
		const release = updateDocument ? parseShortestPathUpdateDocument(updateDocument) : undefined;
		if (!release) {
			return undefined;
		}

		if (release.minimumSupportedVersion && !isShortestPathVersionSupported(currentVersion, release.minimumSupportedVersion)) {
			return release;
		}

		if (!isShortestPathUpdateAvailable(currentVersion, release.version)) {
			if (explicit) {
				// allow-any-unicode-next-line
				await this.dialogService.info(localize('shortestpath.update.latest', "当前已是 ShortestPath IDE 最新版本（{0}）。", currentVersion));
			}
			return release;
		}

		const result = await this.dialogService.confirm({
			type: severity.Info,
			// allow-any-unicode-next-line
			message: localize('shortestpath.update.available', "ShortestPath IDE {0} 已发布。", release.version),
			// allow-any-unicode-next-line
			detail: localize('shortestpath.update.detail', "当前版本：{0}。打开发布页面以选择下载文件。", currentVersion),
			// allow-any-unicode-next-line
			primaryButton: localize({ key: 'shortestpath.update.openRelease', comment: ['&& denotes a mnemonic'] }, "&&打开发布页面"),
		});
		if (result.confirmed) {
			await this.openerService.open(URI.parse(release.downloadUrl));
		}

		return release;
	}
}

class ShortestPathUpdateBlocker extends Disposable {
	private static active: ShortestPathUpdateBlocker | undefined;

	private static readonly HIDDEN_PARTS = [
		Parts.ACTIVITYBAR_PART,
		Parts.SIDEBAR_PART,
		Parts.PANEL_PART,
		Parts.AUXILIARYBAR_PART,
		Parts.STATUSBAR_PART,
		Parts.BANNER_PART,
	] as const;

	private readonly input: ShortestPathUpdateRequiredInput;

	static getOrCreate(instantiationService: IInstantiationService, release: IShortestPathUpdate): ShortestPathUpdateBlocker {
		if (!this.active) {
			this.active = instantiationService.createInstance(ShortestPathUpdateBlocker, release);
			this.active.activate();
		}

		return this.active;
	}

	constructor(
		release: IShortestPathUpdate,
		@IEditorService private readonly editorService: IEditorService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@ILifecycleService lifecycleService: ILifecycleService,
	) {
		super();
		this.input = new ShortestPathUpdateRequiredInput(release.minimumSupportedVersion!, release.downloadUrl);
		this._register(lifecycleService.onWillShutdown(() => this.dispose()));
	}

	activate(): void {
		for (const part of ShortestPathUpdateBlocker.HIDDEN_PARTS) {
			this.layoutService.setPartHidden(true, part);
		}
		this._register(this.layoutService.onDidChangePartVisibility(event => {
			if (event.visible && ShortestPathUpdateBlocker.HIDDEN_PARTS.includes(event.partId as typeof ShortestPathUpdateBlocker.HIDDEN_PARTS[number])) {
				this.layoutService.setPartHidden(true, event.partId as Parts);
			}
		}));

		this.editorGroupsService.applyLayout({ orientation: GroupOrientation.HORIZONTAL, groups: [{}] });
		this._register(this.editorGroupsService.enforcePartOptions({ showTabs: 'none' }));
		this._register(this.editorService.onDidActiveEditorChange(() => this.openRequiredEditor()));
		this.openRequiredEditor();
	}

	private openRequiredEditor(): void {
		if (this.editorService.activeEditor instanceof ShortestPathUpdateRequiredInput) {
			return;
		}

		void this.editorService.openEditor(this.input, { pinned: true, sticky: true });
	}

	override dispose(): void {
		if (ShortestPathUpdateBlocker.active === this) {
			ShortestPathUpdateBlocker.active = undefined;
		}
		super.dispose();
	}
}

class ShortestPathUpdateContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.shortestPathUpdate';
	private static readonly RETRY_INTERVAL = 60 * 60 * 1000;

	private readonly checkScheduler: RunOnceScheduler;
	private blocker: ShortestPathUpdateBlocker | undefined;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IProductService private readonly productService: IProductService,
		@ILogService logService: ILogService,
	) {
		super();
		this.checkScheduler = this._register(new RunOnceScheduler(() => this.checkForUpdates(instantiationService, logService), 0));

		if (!this.productService.shortestPathVersion || !this.productService.shortestPathUpdateUrl) {
			return;
		}
		this.checkScheduler.schedule(0);
	}

	private async checkForUpdates(instantiationService: IInstantiationService, logService: ILogService): Promise<void> {
		try {
			const release = await instantiationService.createInstance(ShortestPathUpdateChecker).check(false);
			if (release?.minimumSupportedVersion && this.productService.shortestPathVersion && !isShortestPathVersionSupported(this.productService.shortestPathVersion, release.minimumSupportedVersion) && !this.blocker) {
				this.blocker = this._register(ShortestPathUpdateBlocker.getOrCreate(instantiationService, release));
			}
		} catch (error) {
			logService.debug('ShortestPath IDE update check failed.', error);
			this.checkScheduler.schedule(ShortestPathUpdateContribution.RETRY_INTERVAL);
		}
	}
}

registerWorkbenchContribution2(ShortestPathUpdateContribution.ID, ShortestPathUpdateContribution, WorkbenchPhase.AfterRestored);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'shortestpath.action.checkForUpdates',
			// allow-any-unicode-next-line
			title: localize2('shortestpath.checkForUpdates', '检查 ShortestPath IDE 更新'),
			f1: true,
			menu: [{ id: MenuId.MenubarHelpMenu, group: '1_welcome', order: 4 }],
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const dialogService = accessor.get(IDialogService);
		const instantiationService = accessor.get(IInstantiationService);
		const productService = accessor.get(IProductService);
		const checker = instantiationService.createInstance(ShortestPathUpdateChecker);
		try {
			const release = await checker.check(true);
			if (release?.minimumSupportedVersion && productService.shortestPathVersion && !isShortestPathVersionSupported(productService.shortestPathVersion, release.minimumSupportedVersion)) {
				ShortestPathUpdateBlocker.getOrCreate(instantiationService, release);
			}
		} catch {
			// allow-any-unicode-next-line
			await dialogService.error(localize('shortestpath.update.failed', "无法检查 ShortestPath IDE 更新，请稍后重试。"));
		}
	}
});

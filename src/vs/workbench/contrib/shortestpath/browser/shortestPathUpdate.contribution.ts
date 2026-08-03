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
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { asJson, IRequestService } from '../../../../platform/request/common/request.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { getShortestPathUpdateCheckDelay, IShortestPathUpdateDocument, isShortestPathUpdateAvailable, parseShortestPathUpdateDocument, SHORTESTPATH_UPDATE_CHECK_INTERVAL } from './shortestPathUpdate.js';

const LAST_CHECKED_STORAGE_KEY = 'shortestpath.update.lastChecked';
const LAST_NOTIFIED_VERSION_STORAGE_KEY = 'shortestpath.update.lastNotifiedVersion';

class ShortestPathUpdateChecker {

	constructor(
		@IRequestService private readonly requestService: IRequestService,
		@IDialogService private readonly dialogService: IDialogService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IStorageService private readonly storageService: IStorageService,
		@IProductService private readonly productService: IProductService,
	) { }

	async check(explicit: boolean): Promise<void> {
		const currentVersion = this.productService.shortestPathVersion;
		const updateUrl = this.productService.shortestPathUpdateUrl;
		if (!currentVersion || !updateUrl) {
			return;
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
		if (!release || !isShortestPathUpdateAvailable(currentVersion, release.version)) {
			if (explicit) {
				// allow-any-unicode-next-line
				await this.dialogService.info(localize('shortestpath.update.latest', "当前已是 ShortestPath IDE 最新版本（{0}）。", currentVersion));
			}
			return;
		}

		if (!explicit && this.storageService.get(LAST_NOTIFIED_VERSION_STORAGE_KEY, StorageScope.APPLICATION) === release.version) {
			return;
		}
		this.storageService.store(LAST_NOTIFIED_VERSION_STORAGE_KEY, release.version, StorageScope.APPLICATION, StorageTarget.USER);

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
	}
}

class ShortestPathUpdateContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.shortestPathUpdate';
	private static readonly RETRY_INTERVAL = 60 * 60 * 1000;

	private readonly checkScheduler: RunOnceScheduler;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@IProductService productService: IProductService,
		@ILogService logService: ILogService,
	) {
		super();
		this.checkScheduler = this._register(new RunOnceScheduler(() => this.checkForUpdates(instantiationService, storageService, logService), 0));

		const lastChecked = Number(storageService.get(LAST_CHECKED_STORAGE_KEY, StorageScope.APPLICATION, '0'));
		if (!productService.shortestPathVersion || !productService.shortestPathUpdateUrl) {
			return;
		}
		this.checkScheduler.schedule(getShortestPathUpdateCheckDelay(lastChecked, Date.now()));
	}

	private async checkForUpdates(instantiationService: IInstantiationService, storageService: IStorageService, logService: ILogService): Promise<void> {
		try {
			await instantiationService.createInstance(ShortestPathUpdateChecker).check(false);
			storageService.store(LAST_CHECKED_STORAGE_KEY, Date.now(), StorageScope.APPLICATION, StorageTarget.USER);
			this.checkScheduler.schedule(SHORTESTPATH_UPDATE_CHECK_INTERVAL);
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
		const checker = accessor.get(IInstantiationService).createInstance(ShortestPathUpdateChecker);
		try {
			await checker.check(true);
		} catch {
			// allow-any-unicode-next-line
			await dialogService.error(localize('shortestpath.update.failed', "无法检查 ShortestPath IDE 更新，请稍后重试。"));
		}
	}
});

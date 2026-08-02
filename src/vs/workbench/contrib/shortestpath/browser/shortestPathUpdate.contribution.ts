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
import { getShortestPathUpdateCheckDelay, IShortestPathRelease, isShortestPathUpdateAvailable, parseShortestPathRelease, SHORTESTPATH_UPDATE_CHECK_INTERVAL } from './shortestPathUpdate.js';

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
		const releaseApiUrl = this.productService.shortestPathReleaseApiUrl;
		if (!currentVersion || !releaseApiUrl) {
			return;
		}

		const response = await this.requestService.request({
			type: 'GET',
			url: releaseApiUrl,
			headers: { Accept: 'application/vnd.github+json' },
			disableCache: true,
			timeout: 10000,
			callSite: 'shortestPathUpdate.check',
		}, CancellationToken.None);
		if (response.res.statusCode !== 200) {
			throw new Error(`Failed to check for ShortestPath IDE updates: HTTP ${response.res.statusCode}`);
		}

		const releaseResponse = await asJson<IShortestPathRelease>(response);
		const release = releaseResponse ? parseShortestPathRelease(releaseResponse) : undefined;
		if (!release || !isShortestPathUpdateAvailable(currentVersion, release.version)) {
			if (explicit) {
				await this.dialogService.info(localize('shortestpath.update.latest', "You are using the latest version of ShortestPath IDE ({0}).", currentVersion));
			}
			return;
		}

		if (!explicit && this.storageService.get(LAST_NOTIFIED_VERSION_STORAGE_KEY, StorageScope.APPLICATION) === release.version) {
			return;
		}
		this.storageService.store(LAST_NOTIFIED_VERSION_STORAGE_KEY, release.version, StorageScope.APPLICATION, StorageTarget.USER);

		const result = await this.dialogService.confirm({
			type: severity.Info,
			message: localize('shortestpath.update.available', "ShortestPath IDE {0} is available.", release.version),
			detail: localize('shortestpath.update.detail', "Current version: {0}. Open the release page to choose a download.", currentVersion),
			primaryButton: localize({ key: 'shortestpath.update.openRelease', comment: ['&& denotes a mnemonic'] }, "&&Open Release Page"),
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
		if (!productService.shortestPathVersion || !productService.shortestPathReleaseApiUrl) {
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
			title: localize2('shortestpath.checkForUpdates', 'Check for ShortestPath IDE Updates'),
			f1: true,
			menu: [{ id: MenuId.MenubarHelpMenu, group: '1_welcome', order: 4 }],
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const checker = accessor.get(IInstantiationService).createInstance(ShortestPathUpdateChecker);
		try {
			await checker.check(true);
		} catch {
			await accessor.get(IDialogService).error(localize('shortestpath.update.failed', "Unable to check for ShortestPath IDE updates. Please try again later."));
		}
	}
});

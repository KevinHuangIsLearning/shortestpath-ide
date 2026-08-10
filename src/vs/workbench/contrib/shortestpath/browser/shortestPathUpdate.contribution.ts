/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/shortestPathUpdateRequired.css';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { $, addDisposableListener, append, isHTMLElement } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import severity from '../../../../base/common/severity.js';
import { URI } from '../../../../base/common/uri.js';
import { isMacintosh, isWindows } from '../../../../base/common/platform.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { asJson, IRequestService } from '../../../../platform/request/common/request.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { getShortestPathUpdateTarget, IShortestPathUpdate, IShortestPathUpdateDocument, IShortestPathUpdateGraceState, IShortestPathUpdateTarget, isShortestPathUpdateAvailable, isShortestPathVersionSupported, parseShortestPathUpdateDocument, parseShortestPathUpdateGraceState, parseShortestPathWindowsInstallMode } from './shortestPathUpdate.js';

interface IShortestPathUpdateCheckResult {
	readonly release: IShortestPathUpdate;
	readonly target: IShortestPathUpdateTarget | undefined;
}

const UPDATE_GRACE_STORAGE_KEY = 'shortestpath.update.networkGrace';
const NETWORK_GRACE_DURATION = 3 * 60 * 60 * 1000;

function getShortestPathUpdateGraceState(storageService: IStorageService, version: string): IShortestPathUpdateGraceState | undefined {
	return parseShortestPathUpdateGraceState(storageService.getObject(UPDATE_GRACE_STORAGE_KEY, StorageScope.APPLICATION), version);
}

class ShortestPathUpdateChecker {

	constructor(
		@IRequestService private readonly requestService: IRequestService,
		@IDialogService private readonly dialogService: IDialogService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IProductService private readonly productService: IProductService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IFileService private readonly fileService: IFileService,
	) { }

	async check(explicit: boolean): Promise<IShortestPathUpdateCheckResult | undefined> {
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
		const target = (await this.getUpdateTarget()) ?? { downloadUrl: release.downloadUrl, allowsMinimumVersionLock: false };
		const result = { release, target };

		if (release.minimumSupportedVersion && target?.allowsMinimumVersionLock !== false && !isShortestPathVersionSupported(currentVersion, release.minimumSupportedVersion)) {
			return result;
		}

		if (!isShortestPathUpdateAvailable(currentVersion, release.version)) {
			if (explicit) {
				// allow-any-unicode-next-line
				await this.dialogService.info(localize('shortestpath.update.latest', "当前已是 ShortestPath IDE 最新版本（{0}）。", currentVersion));
			}
			return result;
		}

		const dialogResult = await this.dialogService.confirm({
			type: severity.Info,
			// allow-any-unicode-next-line
			message: localize('shortestpath.update.available', "ShortestPath IDE {0} 已发布。", release.version),
			// allow-any-unicode-next-line
			detail: localize('shortestpath.update.detail', "当前版本：{0}。打开发布页面以选择下载文件。", currentVersion),
			// allow-any-unicode-next-line
			primaryButton: localize({ key: 'shortestpath.update.openRelease', comment: ['&& denotes a mnemonic'] }, "&&打开发布页面"),
		});
		if (dialogResult.confirmed) {
			await this.openerService.open(URI.parse(target?.downloadUrl ?? release.downloadUrl));
		}

		return result;
	}

	private async getUpdateTarget(): Promise<IShortestPathUpdateTarget | undefined> {
		if (!isWindows) {
			return getShortestPathUpdateTarget(isMacintosh ? 'darwin' : '', undefined);
		}
		const nativeEnvironment = this.environmentService as IEnvironmentService & { execPath?: string; isPortable?: boolean };
		if (nativeEnvironment.isPortable) {
			return getShortestPathUpdateTarget('win32', undefined);
		}
		const execPath = nativeEnvironment.execPath;
		if (!execPath) {
			return undefined;
		}
		const executable = URI.file(execPath);
		const marker = executable.with({ path: `${executable.path.slice(0, executable.path.lastIndexOf('/'))}/.shortestpath-install-mode` });
		try {
			const installMode = parseShortestPathWindowsInstallMode((await this.fileService.readFile(marker)).value.toString());
			return installMode ? getShortestPathUpdateTarget('win32', installMode) : undefined;
		} catch {
			return undefined;
		}
	}
}

class ShortestPathUpdateBlocker extends Disposable {
	private static active: ShortestPathUpdateBlocker | undefined;

	static dismiss(): void {
		this.active?.dispose();
	}

	static get hasActive(): boolean {
		return !!this.active;
	}

	static getOrCreate(instantiationService: IInstantiationService, downloadUrl: string, graceCount: number, onNetworkGrace: () => void): ShortestPathUpdateBlocker {
		if (!this.active) {
			this.active = instantiationService.createInstance(ShortestPathUpdateBlocker, downloadUrl, graceCount, onNetworkGrace);
			this.active.activate();
		}

		return this.active;
	}

	constructor(
		downloadUrl: string,
		private readonly graceCount: number,
		private readonly onNetworkGrace: () => void,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IDialogService private readonly dialogService: IDialogService,
		@ILifecycleService lifecycleService: ILifecycleService,
	) {
		super();
		this.downloadUrl = downloadUrl;
		this._register(lifecycleService.onWillShutdown(() => this.dispose()));
	}

	private readonly downloadUrl: string;

	activate(): void {
		// allow-any-unicode-next-line
		const overlay = append(this.layoutService.mainContainer, $('.shortestpath-update-required-overlay', {
			role: 'dialog',
			// allow-any-unicode-next-line
			'aria-label': '需要升级',
			'aria-modal': 'true',
		}));
		const dialog = append(overlay, $('.shortestpath-update-required-dialog'));
		dialog.tabIndex = -1;
		const updateOverlayTop = () => {
			const titlebar = this.layoutService.getContainer(mainWindow, Parts.TITLEBAR_PART);
			const containerTop = this.layoutService.mainContainer.getBoundingClientRect().top;
			overlay.style.top = `${Math.max(0, (titlebar?.getBoundingClientRect().bottom ?? containerTop) - containerTop)}px`;
		};
		updateOverlayTop();
		this._register(this.layoutService.onDidChangePartVisibility(updateOverlayTop));
		// allow-any-unicode-next-line
		const closeButton = append(dialog, $('button.shortestpath-update-required-close', { type: 'button', title: '更新', 'aria-label': '更新' }, '×'));
		// allow-any-unicode-next-line
		append(dialog, $('h1', undefined, '需要升级 ShortestPath IDE'));
		// allow-any-unicode-next-line
		append(dialog, $('p', undefined, '此版本已不再受支持。请下载并安装最新版后继续使用。'));
		// allow-any-unicode-next-line
		const networkButton = append(dialog, $('button.shortestpath-update-required-network', { type: 'button' }, '网络不好？'));
		const actions = append(dialog, $('.shortestpath-update-required-actions'));
		// allow-any-unicode-next-line
		const updateButton = append(actions, $('button.shortestpath-update-required-action.primary', { type: 'button' }, '更新'));
		// allow-any-unicode-next-line
		const alternateUpdateButton = append(actions, $('button.shortestpath-update-required-action.secondary', { type: 'button' }, '或者更新'));

		const openUpdate = () => void this.openerService.open(URI.parse(this.downloadUrl));
		for (const button of [closeButton, updateButton, alternateUpdateButton]) {
			this._register(addDisposableListener(button, 'click', event => {
				event.preventDefault();
				event.stopPropagation();
				openUpdate();
			}));
		}
		this._register(addDisposableListener(networkButton, 'click', async event => {
			event.preventDefault();
			event.stopPropagation();
			const isPermanent = this.graceCount >= 2;
			const result = await this.dialogService.confirm({
				type: severity.Warning,
				// allow-any-unicode-next-line
				message: isPermanent ? '已使用两次网络宽限。' : '网络不好时可以暂时继续使用。',
				// allow-any-unicode-next-line
				detail: isPermanent ? '选择后将永久不再因最低版本限制锁定。' : '继续使用后，3 小时内不会锁定；到期后仍可再次检查更新。',
				// allow-any-unicode-next-line
				primaryButton: isPermanent ? '别他妈烦我' : '继续使用',
				// allow-any-unicode-next-line
				cancelButton: '留在更新页面',
			});
			if (result.confirmed) {
				this.onNetworkGrace();
			}
		}));
		this._register(addDisposableListener(overlay, 'click', event => {
			if (event.target === overlay) {
				openUpdate();
			}
		}));
		this._register(addDisposableListener(overlay, 'keydown', event => {
			if (isHTMLElement(event.target) && event.target.tagName === 'BUTTON' && (event.key === 'Enter' || event.key === ' ')) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
		}, true));
		this._register(toDisposable(() => overlay.remove()));
		dialog.focus();
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
	private readonly graceExpiryScheduler: RunOnceScheduler;
	private blocker: ShortestPathUpdateBlocker | undefined;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IProductService private readonly productService: IProductService,
		@IStorageService private readonly storageService: IStorageService,
		@ILogService logService: ILogService,
	) {
		super();
		this.checkScheduler = this._register(new RunOnceScheduler(() => this.checkForUpdates(instantiationService, logService), 0));
		this.graceExpiryScheduler = this._register(new RunOnceScheduler(() => this.enforceExpiredGrace(), 0));
		this._register(this.storageService.onDidChangeValue(StorageScope.APPLICATION, UPDATE_GRACE_STORAGE_KEY, this._store)(() => {
			const state = this.productService.shortestPathVersion ? getShortestPathUpdateGraceState(this.storageService, this.productService.shortestPathVersion) : undefined;
			this.scheduleGraceExpiry(state);
			if (state?.permanentlyAllowed || (state?.graceUntil && state.graceUntil > Date.now())) {
				ShortestPathUpdateBlocker.dismiss();
				this.blocker = undefined;
			}
		}));

		if (!this.productService.shortestPathVersion || !this.productService.shortestPathUpdateUrl) {
			return;
		}
		this.scheduleGraceExpiry(getShortestPathUpdateGraceState(this.storageService, this.productService.shortestPathVersion));
		this.checkScheduler.schedule(0);
	}

	private async checkForUpdates(instantiationService: IInstantiationService, logService: ILogService): Promise<void> {
		try {
			const result = await instantiationService.createInstance(ShortestPathUpdateChecker).check(false);
			if (!result) {
				this.unlockAfterFailedCheck();
				this.checkScheduler.schedule(ShortestPathUpdateContribution.RETRY_INTERVAL);
				return;
			}
			if (!result.release.minimumSupportedVersion || result.target?.allowsMinimumVersionLock === false || !this.productService.shortestPathVersion || isShortestPathVersionSupported(this.productService.shortestPathVersion, result.release.minimumSupportedVersion)) {
				this.clearInactiveGrace();
				return;
			}

			const graceState = getShortestPathUpdateGraceState(this.storageService, this.productService.shortestPathVersion);
			if (graceState?.permanentlyAllowed) {
				this.unlockAfterFailedCheck();
				return;
			}
			if (graceState?.graceUntil && graceState.minimumSupportedVersion === result.release.minimumSupportedVersion && graceState.graceUntil > Date.now()) {
				this.scheduleGraceExpiry(graceState);
				this.unlockAfterFailedCheck();
				return;
			}

			if (!ShortestPathUpdateBlocker.hasActive) {
				this.showBlocker(instantiationService, result.release.minimumSupportedVersion, result.target?.downloadUrl ?? result.release.downloadUrl, graceState?.graceCount ?? 0);
			}
		} catch (error) {
			logService.debug('ShortestPath IDE update check failed.', error);
			this.unlockAfterFailedCheck();
			this.checkScheduler.schedule(ShortestPathUpdateContribution.RETRY_INTERVAL);
		}
	}

	private showBlocker(instantiationService: IInstantiationService, minimumSupportedVersion: string, downloadUrl: string, graceCount: number): void {
		this.blocker = this._register(ShortestPathUpdateBlocker.getOrCreate(instantiationService, downloadUrl, graceCount, () => this.grantNetworkGrace(minimumSupportedVersion, downloadUrl, graceCount)));
	}

	private grantNetworkGrace(minimumSupportedVersion: string, downloadUrl: string, graceCount: number): void {
		if (!this.productService.shortestPathVersion) {
			return;
		}

		const isPermanent = graceCount >= 2;
		const state: IShortestPathUpdateGraceState = {
			version: this.productService.shortestPathVersion,
			minimumSupportedVersion,
			downloadUrl,
			graceCount: isPermanent ? graceCount : graceCount + 1,
			...(isPermanent ? { permanentlyAllowed: true } : { graceUntil: Date.now() + NETWORK_GRACE_DURATION }),
		};
		this.storageService.store(UPDATE_GRACE_STORAGE_KEY, state, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this.blocker?.dispose();
		this.blocker = undefined;
		this.scheduleGraceExpiry(state);
	}

	private scheduleGraceExpiry(state: IShortestPathUpdateGraceState | undefined): void {
		this.graceExpiryScheduler.cancel();
		if (!state?.graceUntil || state.permanentlyAllowed) {
			return;
		}
		this.graceExpiryScheduler.schedule(Math.max(0, state.graceUntil - Date.now()));
	}

	private clearInactiveGrace(): void {
		this.graceExpiryScheduler.cancel();
		ShortestPathUpdateBlocker.dismiss();
		this.blocker = undefined;
		if (this.productService.shortestPathVersion) {
			const state = getShortestPathUpdateGraceState(this.storageService, this.productService.shortestPathVersion);
			if (state && !state.permanentlyAllowed) {
				this.storageService.remove(UPDATE_GRACE_STORAGE_KEY, StorageScope.APPLICATION);
			}
		}
	}

	private unlockAfterFailedCheck(): void {
		ShortestPathUpdateBlocker.dismiss();
		this.blocker = undefined;
	}

	private enforceExpiredGrace(): void {
		if (!this.productService.shortestPathVersion) {
			return;
		}
		const state = getShortestPathUpdateGraceState(this.storageService, this.productService.shortestPathVersion);
		if (!state || state.permanentlyAllowed || !state.graceUntil) {
			return;
		}
		if (state.graceUntil > Date.now()) {
			this.scheduleGraceExpiry(state);
			return;
		}
		this.checkScheduler.schedule(0);
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
		const storageService = accessor.get(IStorageService);
		const checker = instantiationService.createInstance(ShortestPathUpdateChecker);
		try {
			const result = await checker.check(true);
			if (!result) {
				ShortestPathUpdateBlocker.dismiss();
				return;
			}
			if (result.release.minimumSupportedVersion && result.target?.allowsMinimumVersionLock !== false && productService.shortestPathVersion && !isShortestPathVersionSupported(productService.shortestPathVersion, result.release.minimumSupportedVersion)) {
				const graceState = getShortestPathUpdateGraceState(storageService, productService.shortestPathVersion);
				if (graceState?.permanentlyAllowed || (graceState?.graceUntil && graceState.graceUntil > Date.now())) {
					return;
				}
				const downloadUrl = result.target?.downloadUrl ?? result.release.downloadUrl;
				const graceCount = graceState?.graceCount ?? 0;
				const blocker = ShortestPathUpdateBlocker.getOrCreate(instantiationService, downloadUrl, graceCount, () => {
					const isPermanent = graceCount >= 2;
					storageService.store(UPDATE_GRACE_STORAGE_KEY, {
						version: productService.shortestPathVersion!,
						minimumSupportedVersion: result.release.minimumSupportedVersion!,
						downloadUrl,
						graceCount: isPermanent ? graceCount : graceCount + 1,
						...(isPermanent ? { permanentlyAllowed: true } : { graceUntil: Date.now() + NETWORK_GRACE_DURATION }),
					}, StorageScope.APPLICATION, StorageTarget.MACHINE);
					blocker.dispose();
				});
			} else {
				ShortestPathUpdateBlocker.dismiss();
				if (productService.shortestPathVersion) {
					const graceState = getShortestPathUpdateGraceState(storageService, productService.shortestPathVersion);
					if (graceState && !graceState.permanentlyAllowed) {
						storageService.remove(UPDATE_GRACE_STORAGE_KEY, StorageScope.APPLICATION);
					}
				}
			}
		} catch {
			ShortestPathUpdateBlocker.dismiss();
			// allow-any-unicode-next-line
			await dialogService.error(localize('shortestpath.update.failed', "无法检查 ShortestPath IDE 更新，请稍后重试。"));
		}
	}
});

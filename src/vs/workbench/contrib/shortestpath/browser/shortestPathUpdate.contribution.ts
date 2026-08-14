/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/shortestPathUpdateRequired.css';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { RunOnceScheduler, timeout } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { $, addDisposableListener, append, isHTMLElement } from '../../../../base/browser/dom.js';
import { joinPath } from '../../../../base/common/resources.js';
import { mainWindow } from '../../../../base/browser/window.js';
import severity from '../../../../base/common/severity.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { isMacintosh, isWindows } from '../../../../base/common/platform.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { asJson, asTextOrError, IRequestService } from '../../../../platform/request/common/request.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { getShortestPathFastDownloadUrl, getShortestPathReleaseNotesUrl, getShortestPathUpdateGraceStateForMinimumVersion, getShortestPathUpdateTarget, IShortestPathUpdate, IShortestPathUpdateDocument, IShortestPathUpdateGraceState, IShortestPathUpdateTarget, isShortestPathUpdateAvailable, isShortestPathVersionSupported, parseShortestPathUpdateDocument, parseShortestPathUpdateGraceState, parseShortestPathWindowsInstallMode } from './shortestPathUpdate.js';

interface IShortestPathUpdateCheckResult {
	readonly release: IShortestPathUpdate;
	readonly target: IShortestPathUpdateTarget | undefined;
	readonly fastDownloadUrl: string | undefined;
}

const UPDATE_GRACE_STORAGE_KEY = 'shortestpath.update.networkGrace';
const RELEASE_NOTES_VERSION_STORAGE_KEY = 'shortestpath.releaseNotes.shownVersion';
const RELEASE_NOTES_CLAIM_STORAGE_KEY = 'shortestpath.releaseNotes.claim';
const NETWORK_GRACE_DURATION = 3 * 60 * 60 * 1000;

interface IShortestPathReleaseNotesClaim {
	readonly version: string;
	readonly owner: string;
	readonly createdAt: number;
}

function getShortestPathUpdateGraceState(storageService: IStorageService, version: string): IShortestPathUpdateGraceState | undefined {
	return parseShortestPathUpdateGraceState(storageService.getObject(UPDATE_GRACE_STORAGE_KEY, StorageScope.APPLICATION), version);
}

function getShortestPathUpdateGraceStateForCurrentMinimumVersion(storageService: IStorageService, version: string, minimumSupportedVersion: string | undefined): IShortestPathUpdateGraceState | undefined {
	return getShortestPathUpdateGraceStateForMinimumVersion(storageService.getObject(UPDATE_GRACE_STORAGE_KEY, StorageScope.APPLICATION), version, minimumSupportedVersion, () => storageService.remove(UPDATE_GRACE_STORAGE_KEY, StorageScope.APPLICATION));
}

class ShortestPathUpdateChecker {

	constructor(
		@IRequestService private readonly requestService: IRequestService,
		@IDialogService private readonly dialogService: IDialogService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
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
		const result = { release, target, fastDownloadUrl: getShortestPathFastDownloadUrl(release.fastDownloadUrls, target) };

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

		ShortestPathUpdateBlocker.getOrCreate(this.instantiationService, {
			downloadUrl: target?.downloadUrl ?? release.downloadUrl,
			fastDownloadUrl: result.fastDownloadUrl,
			isRequired: false,
			version: release.version,
			releaseNote: release.releaseNote,
		});

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

interface IShortestPathUpdateDialogOptions {
	readonly downloadUrl: string;
	readonly fastDownloadUrl?: string;
	readonly isRequired: boolean;
	readonly version?: string;
	readonly releaseNote?: string;
	readonly graceCount?: number;
	readonly onNetworkGrace?: () => void;
}

class ShortestPathUpdateBlocker extends Disposable {
	private static active: ShortestPathUpdateBlocker | undefined;

	static dismiss(): void {
		this.active?.dispose();
	}

	static get hasActive(): boolean {
		return !!this.active;
	}

	static getOrCreate(instantiationService: IInstantiationService, options: IShortestPathUpdateDialogOptions): ShortestPathUpdateBlocker {
		if (!this.active) {
			this.active = instantiationService.createInstance(ShortestPathUpdateBlocker, options);
			this.active.activate();
		}

		return this.active;
	}

	constructor(
		private readonly options: IShortestPathUpdateDialogOptions,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IDialogService private readonly dialogService: IDialogService,
		@ILifecycleService lifecycleService: ILifecycleService,
	) {
		super();
		this._register(lifecycleService.onWillShutdown(() => this.dispose()));
	}

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
		const closeButton = append(dialog, $('button.shortestpath-update-required-close', { type: 'button', title: this.options.isRequired ? '更新' : '关闭', 'aria-label': this.options.isRequired ? '更新' : '关闭' }, '×'));
		// allow-any-unicode-next-line
		append(dialog, $('h1', undefined, this.options.isRequired ? '需要升级 ShortestPath IDE' : `ShortestPath IDE ${this.options.version} 已发布`));
		// allow-any-unicode-next-line
		append(dialog, $('p', undefined, this.options.isRequired ? '此版本已不再受支持。请下载并安装最新版后继续使用。' : '当前有新版本可用。请下载并安装最新版。'));
		if (this.options.releaseNote) {
			// allow-any-unicode-next-line
			append(dialog, $('p.shortestpath-update-required-release-note', undefined, this.options.releaseNote));
		}
		// allow-any-unicode-next-line
		const networkButton = this.options.isRequired ? append(dialog, $('button.shortestpath-update-required-network', { type: 'button' }, '网络不好？')) : undefined;
		const actions = append(dialog, $('.shortestpath-update-required-actions'));
		// allow-any-unicode-next-line
		const updateButton = append(actions, $('button.shortestpath-update-required-action.primary', { type: 'button' }, '更新'));
		// allow-any-unicode-next-line
		const fastDownloadButton = this.options.fastDownloadUrl ? append(actions, $('button.shortestpath-update-required-action.secondary', { type: 'button' }, '网盘快速下载')) : undefined;
		const alternateUpdateButton = this.options.isRequired ? undefined : append(actions, $('button.shortestpath-update-required-action.secondary', { type: 'button' }, '下次丕定'));

		const openUpdate = () => void this.openerService.open(URI.parse(this.options.downloadUrl));
		for (const button of this.options.isRequired ? [closeButton, updateButton] : [updateButton]) {
			this._register(addDisposableListener(button, 'click', event => {
				event.preventDefault();
				event.stopPropagation();
				openUpdate();
			}));
		}
		if (fastDownloadButton) {
			this._register(addDisposableListener(fastDownloadButton, 'click', event => {
				event.preventDefault();
				event.stopPropagation();
				void this.openerService.open(URI.parse(this.options.fastDownloadUrl!));
			}));
		}
		if (!this.options.isRequired) {
			for (const button of [closeButton, alternateUpdateButton!]) {
				this._register(addDisposableListener(button, 'click', event => {
					event.preventDefault();
					event.stopPropagation();
					this.dispose();
				}));
			}
		}
		if (networkButton) {
			this._register(addDisposableListener(networkButton, 'click', async event => {
				event.preventDefault();
				event.stopPropagation();
				const isPermanent = this.options.graceCount! >= 2;
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
					this.options.onNetworkGrace!();
				}
			}));
		}
		this._register(addDisposableListener(overlay, 'click', event => {
			if (event.target === overlay) {
				if (this.options.isRequired) {
					openUpdate();
				} else {
					this.dispose();
				}
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
			const graceState = this.productService.shortestPathVersion ? getShortestPathUpdateGraceStateForCurrentMinimumVersion(this.storageService, this.productService.shortestPathVersion, result.release.minimumSupportedVersion) : undefined;
			if (!result.release.minimumSupportedVersion || result.target?.allowsMinimumVersionLock === false || !this.productService.shortestPathVersion || isShortestPathVersionSupported(this.productService.shortestPathVersion, result.release.minimumSupportedVersion)) {
				this.clearInactiveGrace();
				return;
			}

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
				this.showBlocker(instantiationService, result.release.minimumSupportedVersion, result.target?.downloadUrl ?? result.release.downloadUrl, result.fastDownloadUrl, graceState?.graceCount ?? 0, result.release.releaseNote);
			}
		} catch (error) {
			logService.debug('ShortestPath IDE update check failed.', error);
			this.unlockAfterFailedCheck();
			this.checkScheduler.schedule(ShortestPathUpdateContribution.RETRY_INTERVAL);
		}
	}

	private showBlocker(instantiationService: IInstantiationService, minimumSupportedVersion: string, downloadUrl: string, fastDownloadUrl: string | undefined, graceCount: number, releaseNote?: string): void {
		this.blocker = this._register(ShortestPathUpdateBlocker.getOrCreate(instantiationService, {
			downloadUrl,
			fastDownloadUrl,
			isRequired: true,
			graceCount,
			releaseNote,
			onNetworkGrace: () => this.grantNetworkGrace(minimumSupportedVersion, downloadUrl, graceCount),
		}));
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

class ShortestPathReleaseNotesContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.shortestPathReleaseNotes';
	private static readonly RETRY_INTERVAL = 5 * 60 * 1000;
	private readonly retryScheduler: RunOnceScheduler;

	constructor(
		@ICommandService private readonly commandService: ICommandService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
		@IProductService private readonly productService: IProductService,
		@IRequestService private readonly requestService: IRequestService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		this.retryScheduler = this._register(new RunOnceScheduler(() => this.showReleaseNotesForNewVersion(), 0));
		this.retryScheduler.schedule(0);
	}

	private async showReleaseNotesForNewVersion(): Promise<void> {
		const version = this.productService.shortestPathVersion;
		if (!version) {
			return;
		}
		const releaseNotesUrl = getShortestPathReleaseNotesUrl(version);
		if (!releaseNotesUrl) {
			return;
		}
		const lastShownVersion = this.storageService.get(RELEASE_NOTES_VERSION_STORAGE_KEY, StorageScope.APPLICATION);
		if (lastShownVersion && !isShortestPathUpdateAvailable(lastShownVersion, version)) {
			return;
		}
		const existingClaim = this.storageService.getObject<IShortestPathReleaseNotesClaim>(RELEASE_NOTES_CLAIM_STORAGE_KEY, StorageScope.APPLICATION);
		if (existingClaim?.version === version && Date.now() - existingClaim.createdAt < 60 * 1000) {
			return;
		}
		const claim: IShortestPathReleaseNotesClaim = { version, owner: generateUuid(), createdAt: Date.now() };
		this.storageService.store(RELEASE_NOTES_CLAIM_STORAGE_KEY, claim, StorageScope.APPLICATION, StorageTarget.MACHINE);
		await timeout(25);
		if (this.storageService.getObject<IShortestPathReleaseNotesClaim>(RELEASE_NOTES_CLAIM_STORAGE_KEY, StorageScope.APPLICATION)?.owner !== claim.owner) {
			return;
		}

		let response;
		try {
			response = await this.requestService.request({
				type: 'GET',
				url: releaseNotesUrl,
				disableCache: true,
				timeout: 10000,
				callSite: 'shortestPathReleaseNotes.fetch',
			}, CancellationToken.None);
		} catch (error) {
			this.logService.debug('Failed to fetch ShortestPath IDE release notes.', error);
			this.retryScheduler.schedule(ShortestPathReleaseNotesContribution.RETRY_INTERVAL);
			this.releaseClaim(claim);
			return;
		}

		const statusCode = response.res.statusCode;
		if (statusCode !== 200) {
			this.logService.debug(`Failed to fetch ShortestPath IDE release notes: HTTP ${statusCode}`);
			if (statusCode !== undefined && statusCode >= 500) {
				this.retryScheduler.schedule(ShortestPathReleaseNotesContribution.RETRY_INTERVAL);
			}
			this.releaseClaim(claim);
			return;
		}

		try {
			const releaseNotes = await asTextOrError(response);
			if (typeof releaseNotes !== 'string' || !releaseNotes.trim()) {
				this.logService.debug('Empty ShortestPath IDE release notes response.');
				return;
			}

			const releaseNotesFolder = joinPath(this.environmentService.userRoamingDataHome, 'Release Notes');
			const releaseNotesFile = joinPath(releaseNotesFolder, `${version}.md`);
			await this.fileService.createFolder(releaseNotesFolder);
			await this.fileService.writeFile(releaseNotesFile, VSBuffer.fromString(releaseNotes));
			await this.commandService.executeCommand('markdown.showPreview', releaseNotesFile);
			this.storageService.store(RELEASE_NOTES_VERSION_STORAGE_KEY, version, StorageScope.APPLICATION, StorageTarget.MACHINE);
		} catch (error) {
			this.logService.debug('Failed to save or preview ShortestPath IDE release notes.', error);
		} finally {
			this.releaseClaim(claim);
		}
	}

	private releaseClaim(claim: IShortestPathReleaseNotesClaim): void {
		if (this.storageService.getObject<IShortestPathReleaseNotesClaim>(RELEASE_NOTES_CLAIM_STORAGE_KEY, StorageScope.APPLICATION)?.owner === claim.owner) {
			this.storageService.remove(RELEASE_NOTES_CLAIM_STORAGE_KEY, StorageScope.APPLICATION);
		}
	}
}

registerWorkbenchContribution2(ShortestPathUpdateContribution.ID, ShortestPathUpdateContribution, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(ShortestPathReleaseNotesContribution.ID, ShortestPathReleaseNotesContribution, WorkbenchPhase.AfterRestored);

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
			const graceState = productService.shortestPathVersion ? getShortestPathUpdateGraceStateForCurrentMinimumVersion(storageService, productService.shortestPathVersion, result.release.minimumSupportedVersion) : undefined;
			if (result.release.minimumSupportedVersion && result.target?.allowsMinimumVersionLock !== false && productService.shortestPathVersion && !isShortestPathVersionSupported(productService.shortestPathVersion, result.release.minimumSupportedVersion)) {
				if (graceState?.permanentlyAllowed || (graceState?.graceUntil && graceState.graceUntil > Date.now())) {
					return;
				}
				const downloadUrl = result.target?.downloadUrl ?? result.release.downloadUrl;
				const graceCount = graceState?.graceCount ?? 0;
				const blocker = ShortestPathUpdateBlocker.getOrCreate(instantiationService, {
					downloadUrl,
					fastDownloadUrl: result.fastDownloadUrl,
					isRequired: true,
					graceCount,
					releaseNote: result.release.releaseNote,
					onNetworkGrace: () => {
						const isPermanent = graceCount >= 2;
						storageService.store(UPDATE_GRACE_STORAGE_KEY, {
							version: productService.shortestPathVersion!,
							minimumSupportedVersion: result.release.minimumSupportedVersion!,
							downloadUrl,
							graceCount: isPermanent ? graceCount : graceCount + 1,
							...(isPermanent ? { permanentlyAllowed: true } : { graceUntil: Date.now() + NETWORK_GRACE_DURATION }),
						}, StorageScope.APPLICATION, StorageTarget.MACHINE);
						blocker.dispose();
					},
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

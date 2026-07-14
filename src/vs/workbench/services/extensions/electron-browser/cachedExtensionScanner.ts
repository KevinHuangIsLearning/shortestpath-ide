/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as platform from '../../../../base/common/platform.js';
import { IExtensionDescription, IExtension } from '../../../../platform/extensions/common/extensions.js';
import { dedupExtensions } from '../common/extensionsUtil.js';
import { IExtensionsScannerService, IScannedExtension, toExtensionDescription as toExtensionDescriptionFromScannedExtension } from '../../../../platform/extensionManagement/common/extensionsScannerService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import Severity from '../../../../base/common/severity.js';
import { localize } from '../../../../nls.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { timeout } from '../../../../base/common/async.js';
import { IUserDataProfileService } from '../../userDataProfile/common/userDataProfile.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { IWorkbenchExtensionManagementService } from '../../extensionManagement/common/extensionManagement.js';
import { toExtensionDescription } from '../common/extensions.js';
import { IWorkbenchEnvironmentService } from '../../environment/common/environmentService.js';

// Keep the development build aligned with the curated distribution. The source checkout contains
// many builtin extensions that are intentionally not compiled or shipped for OI.
const excludedOIDistributionExtensions = new Set([
	'bat', 'clojure', 'coffeescript', 'configuration-editing', 'copilot', 'csharp', 'css', 'css-language-features', 'dart',
	'debug-auto-launch', 'debug-server-ready', 'docker', 'emmet', 'extension-editing', 'fsharp', 'github', 'github-authentication', 'go', 'groovy', 'grunt', 'gulp',
	'handlebars', 'hlsl', 'html', 'html-language-features', 'ini', 'ipynb', 'jake', 'javascript', 'julia', 'less', 'lua', 'media-preview', 'merge-conflict',
	'microsoft-authentication', 'node_modules', 'notebook-renderers', 'npm', 'objective-c', 'perl', 'php', 'php-language-features', 'powershell', 'pug', 'r',
	'razor', 'references-view', 'restructuredtext', 'ruby', 'rust', 'scss', 'search-result', 'shaderlab', 'simple-browser', 'sql', 'swift', 'terminal-suggest',
	'tunnel-forwarding', 'typescript-basics', 'typescript-language-features', 'vb', 'vscode-api-tests', 'vscode-colorize-perf-tests', 'vscode-colorize-tests',
	'vscode-test-resolver', 'xml'
]);

function isExcludedOIDistributionExtension(extension: IScannedExtension): boolean {
	return excludedOIDistributionExtensions.has(extension.location.path.split('/').at(-1) ?? '');
}

export class CachedExtensionScanner {

	public readonly scannedExtensions: Promise<IExtensionDescription[]>;
	private _scannedExtensionsResolve!: (result: IExtensionDescription[]) => void;
	private _scannedExtensionsReject!: (err: unknown) => void;

	constructor(
		@INotificationService private readonly _notificationService: INotificationService,
		@IExtensionsScannerService private readonly _extensionsScannerService: IExtensionsScannerService,
		@IUserDataProfileService private readonly _userDataProfileService: IUserDataProfileService,
		@IWorkbenchExtensionManagementService private readonly _extensionManagementService: IWorkbenchExtensionManagementService,
		@IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		@ILogService private readonly _logService: ILogService,
	) {
		this.scannedExtensions = new Promise<IExtensionDescription[]>((resolve, reject) => {
			this._scannedExtensionsResolve = resolve;
			this._scannedExtensionsReject = reject;
		});
	}

	public async startScanningExtensions(): Promise<void> {
		try {
			const extensions = await this._scanInstalledExtensions();
			this._scannedExtensionsResolve(extensions);
		} catch (err) {
			this._scannedExtensionsReject(err);
		}
	}

	private async _scanInstalledExtensions(): Promise<IExtensionDescription[]> {
		try {
			const language = platform.language;
			const result = await Promise.allSettled([
				this._extensionsScannerService.scanSystemExtensions({ language, checkControlFile: true }),
				this._extensionsScannerService.scanUserExtensions({ language, profileLocation: this._userDataProfileService.currentProfile.extensionsResource, useCache: true }),
				this._environmentService.remoteAuthority ? [] : this._extensionManagementService.getInstalledWorkspaceExtensions(false)
			]);

			let hasErrors = false;

			let scannedSystemExtensions: IScannedExtension[] = [];
			if (result[0].status === 'fulfilled') {
				scannedSystemExtensions = result[0].value.filter(extension => !isExcludedOIDistributionExtension(extension));
			} else {
				hasErrors = true;
				this._logService.error(`Error scanning system extensions:`, getErrorMessage(result[0].reason));
			}

			let scannedUserExtensions: IScannedExtension[] = [];
			if (result[1].status === 'fulfilled') {
				scannedUserExtensions = result[1].value;
			} else {
				hasErrors = true;
				this._logService.error(`Error scanning user extensions:`, getErrorMessage(result[1].reason));
			}

			let workspaceExtensions: IExtension[] = [];
			if (result[2].status === 'fulfilled') {
				workspaceExtensions = result[2].value;
			} else {
				hasErrors = true;
				this._logService.error(`Error scanning workspace extensions:`, getErrorMessage(result[2].reason));
			}

			const scannedDevelopedExtensions: IScannedExtension[] = [];
			try {
				const allScannedDevelopedExtensions = await this._extensionsScannerService.scanExtensionsUnderDevelopment([...scannedSystemExtensions, ...scannedUserExtensions], { language, includeInvalid: true });
				const invalidExtensions: IScannedExtension[] = [];
				for (const extensionUnderDevelopment of allScannedDevelopedExtensions) {
					if (extensionUnderDevelopment.isValid) {
						scannedDevelopedExtensions.push(extensionUnderDevelopment);
					} else {
						invalidExtensions.push(extensionUnderDevelopment);
					}
				}
				if (invalidExtensions.length > 0) {
					this._notificationService.prompt(
						Severity.Warning,
						invalidExtensions.length === 1
							? localize('extensionUnderDevelopment.invalid', "Failed loading extension '{0}' under development because it is invalid: {1}", invalidExtensions[0].location.fsPath, invalidExtensions[0].validations[0][1])
							: localize('extensionsUnderDevelopment.invalid', "Failed loading extensions {0} under development because they are invalid: {1}", invalidExtensions.map(ext => `'${ext.location.fsPath}'`).join(', '), invalidExtensions.map(ext => `${ext.validations[0][1]}`).join(', ')),
						[]
					);
				}
			} catch (error) {
				this._logService.error(error);
			}

			const system = scannedSystemExtensions.map(e => toExtensionDescriptionFromScannedExtension(e, false));
			const user = scannedUserExtensions.map(e => toExtensionDescriptionFromScannedExtension(e, false));
			const workspace = workspaceExtensions.map(e => toExtensionDescription(e, false));
			const development = scannedDevelopedExtensions.map(e => toExtensionDescriptionFromScannedExtension(e, true));
			const r = dedupExtensions(system, user, workspace, development, this._logService);

			if (!hasErrors) {
				const disposable = this._extensionsScannerService.onDidChangeCache(() => {
					disposable.dispose();
					// The scanner already invalidates changed caches. During first-run setup,
					// both system and user caches can be populated shortly after startup, so a
					// reload prompt here is misleading and interrupts onboarding.
					this._logService.info('Extension scan cache changed during startup; cache was invalidated automatically.');
				});
				timeout(5000).then(() => disposable.dispose());
			}

			return r;
		} catch (err) {
			this._logService.error(`Error scanning installed extensions:`);
			this._logService.error(err);
			return [];
		}
	}

}

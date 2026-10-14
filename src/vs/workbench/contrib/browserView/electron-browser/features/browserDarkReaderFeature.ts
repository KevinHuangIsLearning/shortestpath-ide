/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../../nls.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IConfigurationRegistry, ConfigurationScope, Extensions as ConfigurationExtensions } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { IConfigurationService, ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { isDark } from '../../../../../platform/theme/common/theme.js';
import { browserDarkReaderModeSetting, browserDarkReaderDetectDarkThemeSetting, browserDarkReaderExcludedHostsSetting, browserDarkReaderHostname, isBrowserDarkReaderEnabled, BrowserDarkReaderMode } from '../../../../../platform/browserView/common/browserDarkReader.js';
import { Action2, registerAction2, MenuId } from '../../../../../platform/actions/common/actions.js';
import { RawContextKey, IContextKey, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from '../../../../../platform/quickinput/common/quickInput.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { BrowserEditorInput } from '../../common/browserEditorInput.js';
import { IBrowserViewModel } from '../../common/browserView.js';
import { BrowserEditor, BrowserEditorContribution, getBrowserEditor, BROWSER_PANE_ACTIVE, BrowserActionCategory, BrowserActionGroup } from '../browserEditor.js';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	properties: {
		[browserDarkReaderModeSetting]: {
			type: 'string',
			enum: ['off', 'on', 'auto'],
			enumDescriptions: [
				localize('darkReader.offDescription', "Keep websites in their original appearance."),
				localize('darkReader.onDescription', "Use Dark Reader on websites."),
				localize('darkReader.autoDescription', "Use Dark Reader when the IDE uses a dark theme."),
			],
			default: 'off',
			scope: ConfigurationScope.APPLICATION,
			description: localize('darkReader.modeDescription', "Controls Dark Reader in the integrated browser. Applies immediately to open HTTP and HTTPS pages."),
		},
		[browserDarkReaderDetectDarkThemeSetting]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('darkReader.detectDescription', "Detect websites with a built-in dark theme and keep their original appearance."),
		},
		[browserDarkReaderExcludedHostsSetting]: {
			type: 'array',
			items: { type: 'string' },
			uniqueItems: true,
			default: [],
			scope: ConfigurationScope.APPLICATION,
			description: localize('darkReader.excludedHostsDescription', "Hostnames where Dark Reader is disabled, such as www.example.com. Matches the exact hostname, including all paths and ports; subdomains are independent."),
		},
	}
});

const canUseDarkReader = new RawContextKey<boolean>('browserCanUseDarkReader', false);
const darkReaderEnabled = new RawContextKey<boolean>('browserDarkReaderEnabled', false);

class BrowserDarkReaderFeature extends BrowserEditorContribution {
	private readonly canUse: IContextKey<boolean>;
	private readonly enabled: IContextKey<boolean>;
	private url = '';

	constructor(
		editor: BrowserEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IThemeService private readonly themeService: IThemeService,
	) {
		super(editor);
		this.canUse = canUseDarkReader.bindTo(contextKeyService);
		this.enabled = darkReaderEnabled.bindTo(contextKeyService);
		this._register(configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(browserDarkReaderModeSetting) || event.affectsConfiguration(browserDarkReaderExcludedHostsSetting)) {
				this.update();
			}
		}));
		this._register(themeService.onDidColorThemeChange(() => this.update()));
	}

	override prerenderInput(input: BrowserEditorInput): void {
		this.url = input.url ?? '';
		this.update();
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		this.url = model.url;
		this.update();
		store.add(model.onDidNavigate(event => {
			this.url = event.url;
			this.update();
		}));
	}

	override onModelDetached(): void {
		this.url = '';
		this.canUse.reset();
		this.enabled.reset();
	}

	private update(): void {
		const mode = this.configurationService.getValue<BrowserDarkReaderMode>(browserDarkReaderModeSetting) ?? 'off';
		this.canUse.set(!!browserDarkReaderHostname(this.url));
		this.enabled.set(isBrowserDarkReaderEnabled(this.url, {
			enabled: mode === 'on' || (mode === 'auto' && isDark(this.themeService.getColorTheme().type)),
			excludedHosts: this.configurationService.getValue<string[]>(browserDarkReaderExcludedHostsSetting) ?? [],
		}));
	}
}

BrowserEditor.registerContribution(BrowserDarkReaderFeature);

interface IDarkReaderPick extends IQuickPickItem {
	readonly mode?: BrowserDarkReaderMode;
	readonly site?: string;
	readonly detectDarkTheme?: boolean;
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.browser.configureDarkReader',
			title: localize2('darkReader.configure', "Dark Reader"),
			category: BrowserActionCategory,
			icon: Codicon.colorMode,
			f1: true,
			precondition: BROWSER_PANE_ACTIVE,
			toggled: darkReaderEnabled,
			menu: { id: MenuId.BrowserActionsToolbar, when: canUseDarkReader, group: BrowserActionGroup.Tools, order: 1.5 },
		});
	}

	async run(accessor: ServicesAccessor, editor = getBrowserEditor(accessor.get(IEditorService).activeEditorPane)): Promise<void> {
		if (!(editor instanceof BrowserEditor)) {
			return;
		}
		const configuration = accessor.get(IConfigurationService);
		const quickInput = accessor.get(IQuickInputService);
		const mode = configuration.getValue<BrowserDarkReaderMode>(browserDarkReaderModeSetting) ?? 'off';
		const excludedHosts = configuration.getValue<string[]>(browserDarkReaderExcludedHostsSetting) ?? [];
		const url = editor.model?.url ?? (editor.input instanceof BrowserEditorInput ? editor.input.url ?? '' : '');
		const hostname = browserDarkReaderHostname(url);
		const modes: IDarkReaderPick[] = [
			{ label: localize('darkReader.auto', "Follow IDE Theme"), mode: 'auto' },
			{ label: localize('darkReader.on', "On"), mode: 'on' },
			{ label: localize('darkReader.off', "Off"), mode: 'off' },
		];
		const items: (IDarkReaderPick | IQuickPickSeparator)[] = modes.map(item => ({ ...item, description: item.mode === mode ? localize('darkReader.current', "Current") : undefined }));
		if (hostname) {
			const excluded = !isBrowserDarkReaderEnabled(url, { enabled: true, excludedHosts });
			items.push({ type: 'separator', label: hostname });
			items.push({
				label: excluded ? localize('darkReader.allowSite', "Allow on This Site") : localize('darkReader.disableSite', "Disable on This Site"),
				site: hostname,
			});
		}
		const detectDarkTheme = configuration.getValue<boolean>(browserDarkReaderDetectDarkThemeSetting) !== false;
		items.push({ type: 'separator' });
		items.push({
			label: detectDarkTheme ? localize('darkReader.stopDetecting', "Disable Automatic Dark Theme Detection") : localize('darkReader.startDetecting', "Enable Automatic Dark Theme Detection"),
			detectDarkTheme: !detectDarkTheme,
		});
		const picked = await quickInput.pick(items, { placeHolder: localize('darkReader.pick', "Dark Reader — choose a mode or set this site's preference") });
		if (picked?.mode) {
			await configuration.updateValue(browserDarkReaderModeSetting, picked.mode, ConfigurationTarget.USER);
		} else if (picked?.detectDarkTheme !== undefined) {
			await configuration.updateValue(browserDarkReaderDetectDarkThemeSetting, picked.detectDarkTheme, ConfigurationTarget.USER);
		} else if (picked?.site) {
			const current = configuration.getValue<string[]>(browserDarkReaderExcludedHostsSetting) ?? [];
			const remaining = current.filter(host => host.trim().toLowerCase().replace(/\.$/, '') !== picked.site);
			await configuration.updateValue(browserDarkReaderExcludedHostsSetting, remaining.length === current.length ? [...current, picked.site] : remaining, ConfigurationTarget.USER);
		}
	}
});

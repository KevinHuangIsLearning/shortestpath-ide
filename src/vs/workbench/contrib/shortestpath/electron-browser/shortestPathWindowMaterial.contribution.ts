/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../browser/media/shortestPathWindowMaterial.css';
import { mainWindow } from '../../../../base/browser/window.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { getMarks } from '../../../../base/common/performance.js';
import { disposableTimeout } from '../../../../base/common/async.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { isHighContrast } from '../../../../platform/theme/common/theme.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { INativeWorkbenchEnvironmentService } from '../../../services/environment/electron-browser/environmentService.js';
import { getNLSLanguage, localize } from '../../../../nls.js';

const setting = 'shortestpath.windowMaterial';
const marker = 'shortestpath-native-window-material';
Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({
	id: 'shortestpath',
	properties: {
		[setting]: {
			type: 'string', enum: ['auto', 'on', 'off'], default: 'auto', scope: ConfigurationScope.APPLICATION,
			// allow-any-unicode-next-line
			description: getNLSLanguage()?.toLowerCase().startsWith('zh') ? '使用系统窗口毛玻璃作为 IDE 外壳背景；低配置、减少透明度及高对比模式自动使用实底。代码编辑区保持不透明。' : localize('sp.windowMaterial', "Use native window material behind the IDE shell. Low-capability devices, reduced transparency and high contrast use an opaque background. Code editors remain opaque.")
		}
	}
});

class ShortestPathWindowMaterial extends Disposable {
	static readonly ID = 'workbench.contrib.shortestPathWindowMaterial';
	private request = 0;
	private stopped = false;
	private startupAllowed = false;
	private updates: Promise<void> = Promise.resolve();
	private readonly reduceTransparency = mainWindow.matchMedia('(prefers-reduced-transparency: reduce)');

	constructor(
		@INativeHostService private readonly nativeHost: INativeHostService,
		@IConfigurationService private readonly configuration: IConfigurationService,
		@IThemeService private readonly themes: IThemeService,
		@IWorkbenchLayoutService private readonly layout: IWorkbenchLayoutService,
		@INativeWorkbenchEnvironmentService environment: INativeWorkbenchEnvironmentService,
	) {
		super();
		this._register(configuration.onDidChangeConfiguration(event => { if (event.affectsConfiguration(setting)) { this.update(); } }));
		this._register(themes.onDidColorThemeChange(() => this.update()));
		this._register(nativeHost.onDidChangeColorScheme(() => this.update()));
		this._register(addDisposableListener(this.reduceTransparency, 'change', () => this.update()));
		this._register(toDisposable(() => {
			this.stopped = true;
			this.request++;
			this.setTransparent(false);
			void this.updates.then(() => nativeHost.setWindowBackgroundMaterial(false)).catch(() => { });
		}));
		const startName = environment.window.isInitialStartup ? 'code/didStartMain' : 'code/willOpenNewWindow';
		const start = environment.window.perfMarks.findLast(mark => mark.name === startName)?.startTime ?? mainWindow.performance.timeOrigin;
		const elapsed = (getMarks().findLast(mark => mark.name === 'code/didStartWorkbench')?.startTime ?? Date.now()) - start;
		this.startupAllowed = elapsed >= 0 && elapsed <= 10_000;
		this.update();
		if (!layout.isRestored() && this.startupAllowed) {
			const deadline = this._register(disposableTimeout(() => {
				if (!this.stopped && !layout.isRestored()) { this.startupAllowed = false; this.update(); }
			}, Math.max(0, 10_001 - elapsed)));
			void layout.whenRestored.then(() => {
				deadline.dispose();
				if (this.stopped) { return; }
				const duration = (getMarks().findLast(mark => mark.name === 'code/didStartWorkbench')?.startTime ?? Date.now()) - start;
				this.startupAllowed = duration >= 0 && duration <= 10_000;
				this.update();
			});
		}
	}

	private update(): void {
		const request = ++this.request;
		const mode = this.configuration.getValue<string>(setting);
		const enabled = (mode === 'on' || (mode === 'auto' && this.startupAllowed))
			&& !this.reduceTransparency.matches && !isHighContrast(this.themes.getColorTheme().type);
		if (!enabled) { this.setTransparent(false); }
		this.updates = this.updates.then(async () => {
			if (this.stopped || request !== this.request) { return; }
			try {
				const applied = await this.nativeHost.setWindowBackgroundMaterial(enabled, { ignorePerformance: mode === 'on' });
				if (!this.stopped && request === this.request) { this.setTransparent(applied); }
			} catch {
				if (!this.stopped && request === this.request) { this.setTransparent(false); }
			}
		});
	}

	private setTransparent(enabled: boolean): void {
		this.layout.mainContainer.classList.toggle(marker, enabled);
		mainWindow.document.documentElement.classList.toggle(marker, enabled);
		mainWindow.document.body.classList.toggle(marker, enabled);
	}
}

registerWorkbenchContribution2(ShortestPathWindowMaterial.ID, ShortestPathWindowMaterial, WorkbenchPhase.AfterRestored);

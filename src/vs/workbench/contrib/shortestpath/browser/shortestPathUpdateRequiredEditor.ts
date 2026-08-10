/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/shortestPathUpdateRequired.css';
import { $, addDisposableListener, append, Dimension } from '../../../../base/browser/dom.js';
import { URI } from '../../../../base/common/uri.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { ShortestPathUpdateRequiredInput } from './shortestPathUpdateRequiredInput.js';

export class ShortestPathUpdateRequiredEditor extends EditorPane {

	static readonly ID = ShortestPathUpdateRequiredInput.ID;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IOpenerService private readonly openerService: IOpenerService,
	) {
		super(ShortestPathUpdateRequiredEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		const container = append(parent, $('.shortestpath-update-required'));
		const content = append(container, $('.shortestpath-update-required-content'));
		// allow-any-unicode-next-line
		append(content, $('h1', undefined, '需要升级 ShortestPath IDE'));
		// allow-any-unicode-next-line
		append(content, $('p', undefined, '此版本已不再受支持。请下载并安装最新版后继续使用。'));
		// allow-any-unicode-next-line
		const button = append(content, $('button.shortestpath-update-required-action', { type: 'button' }, '下载最新版'));
		this._register(addDisposableListener(button, 'click', () => {
			const input = this.input;
			if (input instanceof ShortestPathUpdateRequiredInput) {
				void this.openerService.open(URI.parse(input.downloadUrl));
			}
		}));
	}

	override focus(): void {
		this.getContainer()?.focus();
	}

	override layout(_dimension: Dimension): void { }
}

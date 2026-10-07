/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createShortestPathBrowserNewTab } from '../../../shortestpath/browser/shortestPathBrowserNewTab.js';
import { IShortestPathModeService } from '../../../shortestpath/common/shortestPathMode.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { localize } from '../../../../../nls.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ChatContextKeys } from '../../../chat/common/actions/chatContextKeys.js';
import { createBrowserWelcome } from '../../browser/browserWelcome.js';
import { IBrowserViewModel } from '../../common/browserView.js';
import { BrowserEditorInput } from '../../common/browserEditorInput.js';
import {
	BrowserEditor,
	BrowserEditorContribution,
	BrowserWidgetLocation,
	IBrowserEditorWidget,
} from '../browserEditor.js';

/**
 * Welcome placeholder shown in the content area when no URL is loaded; hides
 * as soon as a URL appears and reappears when it's cleared.
 */
export class BrowserWelcomeFeature extends BrowserEditorContribution {

	private readonly _container: HTMLElement;
	private readonly _widget: IBrowserEditorWidget;
	private readonly _startPage: HTMLElement;

	constructor(
		editor: BrowserEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IShortestPathModeService private readonly modeService: IShortestPathModeService,
	) {
		super(editor);

		const chatEnabled = contextKeyService.getContextKeyValue<boolean>(ChatContextKeys.enabled.key);
		this._container = createBrowserWelcome(
			localize('browser.welcomeTitle', "Browser"),
			chatEnabled
				? localize('browser.welcomeSubtitleChat', "Use Add Element to Chat to reference UI elements in chat prompts.")
				: localize('browser.welcomeSubtitle', "Enter a URL above to get started."),
		);

		this._startPage = createShortestPathBrowserNewTab(this._register(new DisposableStore()), url => {
			if (this.editor.input instanceof BrowserEditorInput) { this.editor.input.navigate(url); }
		});
		this._widget = { location: BrowserWidgetLocation.ContentArea, element: this._container, order: 50 };
		this._setVisible(false);
	}

	override get widgets(): readonly IBrowserEditorWidget[] {
		return [this._widget, { location: BrowserWidgetLocation.ContentArea, element: this._startPage, order: 50 }];
	}

	override prerenderInput(input: BrowserEditorInput): void {
		this._setVisible(!input.url, input);
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		this._setVisible(!model.url, this.editor.input);
		store.add(model.onDidNavigate(event => this._setVisible(!event.url, this.editor.input)));
	}

	override onModelDetached(): void {
		this._setVisible(false);
	}

	private _setVisible(visible: boolean, input?: EditorInput): void {
		const owned = input instanceof BrowserEditorInput && this.modeService.ownsBrowserTab(input);
		this._container.style.display = visible && !owned ? '' : 'none';
		this._startPage.style.display = visible && owned ? '' : 'none';
	}
}

BrowserEditor.registerContribution(BrowserWelcomeFeature);

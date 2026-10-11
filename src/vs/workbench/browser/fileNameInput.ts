/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../base/browser/dom.js';
import { IKeyboardEvent } from '../../base/browser/keyboardEvent.js';
import { InputBox, MessageType } from '../../base/browser/ui/inputbox/inputBox.js';
import { timeout } from '../../base/common/async.js';
import { Event } from '../../base/common/event.js';
import { createSingleCallFunction } from '../../base/common/functional.js';
import { KeyCode } from '../../base/common/keyCodes.js';
import { dispose, IDisposable, toDisposable } from '../../base/common/lifecycle.js';
import { IContextMenuService, IContextViewService } from '../../platform/contextview/browser/contextView.js';
import { Severity } from '../../platform/notification/common/notification.js';
import { defaultInputBoxStyles } from '../../platform/theme/browser/defaultStyles.js';
import { localize } from '../../nls.js';
import { IEditableData } from '../common/views.js';

/** Shared Explorer name-editing behavior for native file trees. Extracted from explorerViewer. */
export function renderFileNameInput(container: HTMLElement, value: string, isDirectory: boolean, editableData: IEditableData, contextViewService: IContextViewService, contextMenuService: IContextMenuService, onDidChange?: (value: string) => void): IDisposable {
	// Input field for name
	const inputBox = new InputBox(container, contextViewService, {
		validationOptions: {
			validation: (value) => {
				const message = editableData.validationMessage(value);
				if (!message || message.severity !== Severity.Error) {
					return null;
				}

				return {
					content: message.content,
					formatContent: true,
					type: MessageType.ERROR
				};
			}
		},
		ariaLabel: localize('fileInputAriaLabel', "Type file name. Press Enter to confirm or Escape to cancel."),
		inputBoxStyles: defaultInputBoxStyles,
	});

	const lastDot = value.lastIndexOf('.');
	let currentSelectionState = 'prefix';

	inputBox.value = value;
	inputBox.focus();
	inputBox.select({ start: 0, end: lastDot > 0 && !isDirectory ? lastDot : value.length });

	const done = createSingleCallFunction((success: boolean, finishEditing: boolean) => {
		inputBox.element.style.display = 'none';
		const value = inputBox.value;
		dispose(toDispose);
		inputBox.element.remove();
		if (finishEditing) {
			editableData.onFinish(value, success);
		}
	});

	const showInputBoxNotification = () => {
		if (inputBox.isInputValid()) {
			const message = editableData.validationMessage(inputBox.value);
			if (message) {
				inputBox.showMessage({
					content: message.content,
					formatContent: true,
					type: message.severity === Severity.Info ? MessageType.INFO : message.severity === Severity.Warning ? MessageType.WARNING : MessageType.ERROR
				});
			} else {
				inputBox.hideMessage();
			}
		}
	};
	showInputBoxNotification();

	const toDispose = [
		inputBox,
		inputBox.onDidChange(value => onDidChange?.(value)),
		DOM.addStandardDisposableListener(inputBox.inputElement, DOM.EventType.KEY_DOWN, (e: IKeyboardEvent) => {
			if (e.equals(KeyCode.F2)) {
				const dotIndex = inputBox.value.lastIndexOf('.');
				if (isDirectory || dotIndex === -1) {
					return;
				}
				if (currentSelectionState === 'prefix') {
					currentSelectionState = 'all';
					inputBox.select({ start: 0, end: inputBox.value.length });
				} else if (currentSelectionState === 'all') {
					currentSelectionState = 'suffix';
					inputBox.select({ start: dotIndex + 1, end: inputBox.value.length });
				} else {
					currentSelectionState = 'prefix';
					inputBox.select({ start: 0, end: dotIndex });
				}
			} else if (e.equals(KeyCode.Enter)) {
				if (!inputBox.validate()) {
					done(true, true);
				}
			} else if (e.equals(KeyCode.Escape)) {
				done(false, true);
			}
		}),
		DOM.addStandardDisposableListener(inputBox.inputElement, DOM.EventType.KEY_UP, (e: IKeyboardEvent) => {
			showInputBoxNotification();
		}),
		DOM.addDisposableListener(inputBox.inputElement, DOM.EventType.BLUR, async () => {
			while (true) {
				await timeout(0);

				const ownerDocument = inputBox.inputElement.ownerDocument;
				if (!ownerDocument.hasFocus()) {
					break;
				} if (DOM.isActiveElement(inputBox.inputElement)) {
					return;
				} else if (DOM.isHTMLElement(ownerDocument.activeElement) && DOM.hasParentWithClass(ownerDocument.activeElement, 'context-view')) {
					await Event.toPromise(contextMenuService.onDidHideContextMenu);
				} else {
					break;
				}
			}

			done(inputBox.isInputValid(), true);
		}),
	];

	return toDisposable(() => {
		done(false, false);
	});
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { localize, localize2 } from '../../../../nls.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { IViewContainersRegistry, IViewDescriptor, IViewsRegistry, ViewContainer, ViewContainerLocation, Extensions as ViewExtensions } from '../../../common/views.js';
import { ChatContextKeys } from '../common/actions/chatContextKeys.js';
import { AgentPluginsViewsContribution } from './agentPluginsView.js';
import { ChatViewId, ChatViewContainerId } from './chat.js';
import { ChatViewPane } from './widgetHosts/viewPane/chatViewPane.js';

// --- Chat Container &  View Registration

const chatViewIcon = registerIcon('chat-view-icon', Codicon.chatSparkle, localize('chatViewIcon', 'View icon of the chat view.'));

const chatViewContainer: ViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: ChatViewContainerId,
	title: localize2('chat.viewContainer.label', "Chat"),
	icon: chatViewIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [ChatViewContainerId, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: ChatViewContainerId,
	hideIfEmpty: true,
	order: 1,
}, ViewContainerLocation.AuxiliaryBar, { isDefault: true, doNotRegisterOpenCommand: true });

const chatViewDescriptor: IViewDescriptor = {
	id: ChatViewId,
	containerIcon: chatViewContainer.icon,
	containerTitle: chatViewContainer.title.value,
	singleViewPaneContainerTitle: chatViewContainer.title.value,
	name: localize2('chat.viewContainer.label', "Chat"),
	canToggleVisibility: false,
	canMoveView: true,
	openCommandActionDescriptor: {
		id: ChatViewContainerId,
		title: chatViewContainer.title,
		mnemonicTitle: localize({ key: 'miToggleChat', comment: ['&& denotes a mnemonic'] }, "&&Chat"),
		keybindings: {
			primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyI,
			mac: {
				primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.KeyI
			}
		},
		order: 1
	},
	ctorDescriptor: new SyncDescriptor(ChatViewPane),
	when: ContextKeyExpr.and(
		ChatContextKeys.accountPolicyGateActive.negate(),
		ContextKeyExpr.or(
			ContextKeyExpr.and(
				ChatContextKeys.Setup.hidden.negate(),
				ChatContextKeys.Setup.disabledInWorkspace.negate(),
			),
			ChatContextKeys.panelParticipantRegistered,
			ChatContextKeys.extensionInvalid
		)
	)
};
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([chatViewDescriptor], chatViewContainer);

registerWorkbenchContribution2(AgentPluginsViewsContribution.ID, AgentPluginsViewsContribution, WorkbenchPhase.AfterRestored);

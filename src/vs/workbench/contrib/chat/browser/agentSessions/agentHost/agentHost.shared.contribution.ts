/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../../../platform/instantiation/common/extensions.js';
import { IAgentHostByokLmHandler } from '../../../../../../platform/agentHost/common/agentHostByokLm.js';
import { AgentHostByokLmHandler } from './agentHostByokLmHandler.js';
import { IRemoteAgentHostLocationPreferenceService } from '../../../../../../platform/agentHost/common/remoteAgentHostLocationPreference.js';
import { RemoteAgentHostLocationPreferenceService } from '../../../../../../platform/agentHost/browser/remoteAgentHostLocationPreferenceService.js';

registerSingleton(IAgentHostByokLmHandler, AgentHostByokLmHandler, InstantiationType.Delayed);
registerSingleton(IRemoteAgentHostLocationPreferenceService, RemoteAgentHostLocationPreferenceService, InstantiationType.Delayed);

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInlineChatSessionService } from './inlineChatSessionService.js';
import { InlineChatSessionServiceImpl } from './inlineChatSessionServiceImpl.js';
import { IInlineChatSessionResolver, InlineChatSessionResolver } from './inlineChatSessionResolver.js';

// Required by retained editor contributions even when inline-chat UI is absent.
registerSingleton(IInlineChatSessionService, InlineChatSessionServiceImpl, InstantiationType.Delayed);
registerSingleton(IInlineChatSessionResolver, InlineChatSessionResolver, InstantiationType.Delayed);

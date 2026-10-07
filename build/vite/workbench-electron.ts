/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../../src/vs/code/electron-browser/workbench/workbench';
import { enableHotReload } from '../../src/vs/base/common/hotReload.ts';

// Desktop workers keep using the compiled modules and native resource protocol.
enableHotReload();
globalThis._VSCODE_DISABLE_CSS_IMPORT_MAP = true;
globalThis._VSCODE_USE_RELATIVE_IMPORTS = true;

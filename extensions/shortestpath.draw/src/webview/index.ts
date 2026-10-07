/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '@excalidraw/excalidraw/index.css';
import './style.css';
import { getDrawStrings } from '../strings';

const container = document.getElementById('root')!;
// Set the local font base before evaluating Excalidraw's font modules.
window.EXCALIDRAW_ASSET_PATH = container.dataset.assets!;
const strings = getDrawStrings(container.dataset.language!);
container.textContent = strings.loading;
void import('./canvas').then(({ mount }) => mount(container)).catch(() => {
	container.replaceChildren();
	const message = document.createElement('p');
	message.textContent = strings.loadFailed;
	const retry = document.createElement('button');
	retry.textContent = strings.retry;
	retry.addEventListener('click', () => location.reload());
	container.append(message, retry);
});

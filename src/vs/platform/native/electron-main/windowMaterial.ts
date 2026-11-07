/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { app, type BrowserWindow, nativeTheme } from 'electron';
import { cpus, platform, release, totalmem } from 'os';
import { getWindowMaterial } from '../common/windowMaterial.js';

export const nativeWindowMaterialWindows = new WeakSet<BrowserWindow>();
export const nativeWindowMaterialCompositors = new WeakSet<BrowserWindow>();
const memoryBytes = totalmem();
const logicalProcessors = cpus().length;

/** Share the capability policy between window construction and later accessibility updates. */
export function getNativeWindowMaterial(creatingWindow = false, ignorePerformance = false): 'sidebar' | 'acrylic' | undefined {
	const gpuCompositing = app.getGPUFeatureStatus().gpu_compositing;
	return getWindowMaterial({
		platform: platform(), windowsBuild: Number(release().split('.')[2]),
		memoryBytes, logicalProcessors,
		// GPU information may not exist before the first window. Reserve the translucent
		// compositor then; the workbench rechecks the actual GPU before exposing material.
		gpuCompositing: gpuCompositing || (creatingWindow && !app.commandLine.hasSwitch('disable-gpu') ? 'enabled' : ''),
		reduceTransparency: nativeTheme.prefersReducedTransparency,
		highContrast: nativeTheme.shouldUseHighContrastColors
	}, ignorePerformance);
}

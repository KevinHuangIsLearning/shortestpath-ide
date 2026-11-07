/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IWindowMaterialCapabilities {
	platform: string;
	windowsBuild: number;
	memoryBytes: number;
	logicalProcessors: number;
	gpuCompositing: string;
	reduceTransparency: boolean;
	highContrast: boolean;
}

/** Fail closed on unsupported platforms, accessibility constraints and weak hardware. */
export function getWindowMaterial(capabilities: IWindowMaterialCapabilities, ignorePerformance = false): 'sidebar' | 'acrylic' | undefined {
	if (capabilities.reduceTransparency || capabilities.highContrast
		|| (!ignorePerformance && (capabilities.memoryBytes < 8 * 1024 ** 3 || capabilities.logicalProcessors < 4
			|| !capabilities.gpuCompositing.startsWith('enabled')))) {
		return undefined;
	}
	if (capabilities.platform === 'darwin') {
		return 'sidebar';
	}
	return capabilities.platform === 'win32' && capabilities.windowsBuild >= 22621 ? 'acrylic' : undefined;
}

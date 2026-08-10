/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Whether portable mode may safely replace the process temporary directory. */
export function shouldUsePortableTemp(platform: NodeJS.Platform, portableTempPath: string): boolean {
	return platform !== 'win32' || !/\s/.test(portableTempPath);
}

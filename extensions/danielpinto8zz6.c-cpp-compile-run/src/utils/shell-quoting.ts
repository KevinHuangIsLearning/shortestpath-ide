/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Quote a literal argument, including the smart quotes recognized by PowerShell. */
export function quotePowerShellArgument(value: string): string {
	return `'${value.replace(/['\u2018\u2019]/g, "$&$&")}'`;
}

/** Keep percent signs outside quotes and escaped so CMD cannot expand a filename. */
export function quoteCmdArgument(value: string): string {
	return `"${value.replace(/"/g, '""').replace(/%/g, '"^%"')}"`;
}

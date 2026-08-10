/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const maxDisplayedElapsedMs = 5 * 60 * 60 * 1000;

export function formatElapsedTimer(milliseconds: number): string {
	if (milliseconds > maxDisplayedElapsedMs) {
		return '05:00:00+';
	}

	const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor(totalSeconds % 3600 / 60);
	const seconds = totalSeconds % 60;
	return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
}

export function getNextElapsedTimerUpdateDelay(milliseconds: number): number {
	return 1000 - Math.max(0, milliseconds) % 1000;
}

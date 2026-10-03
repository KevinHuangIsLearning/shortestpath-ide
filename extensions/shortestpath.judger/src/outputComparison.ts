/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
export function compareOutput(
	expected: string,
	received: string,
): 'AC' | 'PE' | 'WA' {
	const lines = (text: string) =>
		text
			.split('\n')
			.map((line) => line.replace(/[\t \r]+$/, ''))
			.join('\n')
			.replace(/\n+$/, '');
	if (lines(expected) === lines(received)) {
		return 'AC';
	}
	const tokens = (text: string) => text.trim().split(/\s+/).filter(Boolean);
	const left = tokens(expected),
		right = tokens(received);
	return left.length === right.length &&
		left.every((token, index) => token === right[index])
		? 'PE'
		: 'WA';
}

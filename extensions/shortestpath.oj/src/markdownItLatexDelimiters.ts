/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type MarkdownIt from 'markdown-it';

/**
 * Adds support for the LaTeX style math delimiters used by ShortestPath problem
 * statements: `\(...\)` for inline math and `\[...\]` for display math.
 *
 * The rules only produce `math_inline` / `math_inline_block` / `math_block`
 * tokens; rendering is left to `@vscode/markdown-it-katex`, which must be
 * registered as well.
 */

/**
 * Finds the backslash that starts the next unescaped `\` + `char` delimiter
 * within `src` in the range `[from, to)`. A delimiter preceded by an odd
 * number of backslashes is escaped and skipped. Returns -1 when not found.
 */
function findClosingDelimiter(src: string, char: string, from: number, to: number): number {
	let index = src.indexOf(char, from);
	while (index !== -1 && index < to) {
		let backslashes = 0;
		let pos = index - 1;
		while (src[pos] === '\\') {
			backslashes++;
			pos--;
		}
		if (backslashes % 2 === 1) {
			return index - 1;
		}
		index = src.indexOf(char, index + 1);
	}
	return -1;
}

function findAllClosingDelimiters(src: string, char: string, from: number, to: number): number[] {
	const result: number[] = [];
	let searchFrom = from;
	let found = -1;
	while ((found = findClosingDelimiter(src, char, searchFrom, to)) !== -1) {
		result.push(found);
		searchFrom = found + 2;
	}
	return result;
}

function createInlineMathRule(openChar: string, closeChar: string, displayMode: boolean): MarkdownIt.ParserInline.RuleInline {
	const markup = `\\${openChar}`;
	return (state, silent) => {
		const src = state.src;
		const start = state.pos;
		if (start + 1 >= state.posMax || src[start] !== '\\' || src[start + 1] !== openChar) {
			return false;
		}
		const contentStart = start + 2;
		const closingBackslash = findClosingDelimiter(src, closeChar, contentStart, state.posMax);
		if (closingBackslash === -1 || closingBackslash === contentStart) {
			// Unclosed or empty: fall back to the escape rule, which renders
			// the opening delimiter as a literal bracket/paren.
			return false;
		}
		if (!silent) {
			const token = state.push(displayMode ? 'math_inline_block' : 'math_inline', 'math', 0);
			token.markup = markup;
			token.content = src.slice(contentStart, closingBackslash);
			if (displayMode) {
				token.block = true;
			}
		}
		state.pos = closingBackslash + 2;
		return true;
	};
}

/**
 * Returns the index of the backslash of an unescaped trailing `\]` in `line`
 * (ignoring trailing whitespace), or -1 when the line does not end a display
 * math block.
 */
function findBlockTerminator(line: string): number {
	const trimmed = line.trimEnd();
	if (trimmed.length < 2 || trimmed[trimmed.length - 2] !== '\\' || trimmed[trimmed.length - 1] !== ']') {
		return -1;
	}
	const backslashIndex = trimmed.length - 2;
	let backslashes = 0;
	let pos = backslashIndex;
	while (pos >= 0 && trimmed[pos] === '\\') {
		backslashes++;
		pos--;
	}
	return backslashes % 2 === 1 ? backslashIndex : -1;
}

function mathBlockBracket(state: MarkdownIt.StateBlock, start: number, end: number, silent: boolean): boolean {
	let pos = state.bMarks[start] + state.tShift[start];
	const max = state.eMarks[start];
	if (pos + 2 > max || state.src.slice(pos, pos + 2) !== '\\[') {
		return false;
	}
	pos += 2;
	let firstLine = state.src.slice(pos, max);

	let found = false;
	const firstLineClosings = findAllClosingDelimiters(firstLine, ']', 0, firstLine.length);
	if (firstLineClosings.length === 1 && firstLineClosings[0] === firstLine.trimEnd().length - 2) {
		// Single line expression such as `\[x = 1\]`.
		firstLine = firstLine.trim().slice(0, -2);
		found = true;
	} else if (firstLineClosings.length > 1) {
		// Multiple closings on the first line: leave them to inline parsing.
		return false;
	}
	if (silent) {
		return true;
	}

	let next = start;
	let lastLine: string | undefined;
	for (; !found;) {
		next++;
		if (next >= end) {
			break;
		}
		pos = state.bMarks[next] + state.tShift[next];
		const lineMax = state.eMarks[next];
		if (pos < lineMax && state.tShift[next] < state.blkIndent) {
			// non-empty line with negative indent should stop the list:
			break;
		}
		const terminator = findBlockTerminator(state.src.slice(pos, lineMax));
		if (terminator !== -1) {
			lastLine = state.src.slice(pos, pos + terminator);
			found = true;
		}
	}
	if (!found) {
		// No closing `\]` line: bail out so the paragraph's inline rule can
		// still handle `\[...\]` spans instead of swallowing the document.
		return false;
	}

	state.line = next + 1;
	const token = state.push('math_block', 'math', 0);
	token.block = true;
	token.content = (firstLine && firstLine.trim() ? firstLine + '\n' : '')
		+ state.getLines(start + 1, next, state.tShift[start], true)
		+ (lastLine && lastLine.trim() ? lastLine : '');
	token.map = [start, state.line];
	token.markup = '\\[';
	return true;
}

export function registerLatexDelimiterMath(markdown: MarkdownIt): void {
	// Must run before the built-in `escape` rule so `\(` and `\[` are not
	// swallowed as escaped punctuation.
	markdown.inline.ruler.before('escape', 'math_inline_paren', createInlineMathRule('(', ')', false));
	markdown.inline.ruler.before('escape', 'math_inline_bracket', createInlineMathRule('[', ']', true));
	markdown.block.ruler.after('blockquote', 'math_block_bracket', mathBlockBracket, {
		alt: ['paragraph', 'reference', 'blockquote', 'list'],
	});
}

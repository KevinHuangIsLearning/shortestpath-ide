/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const defaultCppTemplate = '#include <bits/stdc++.h>\nusing namespace std;\nusing i64 = long long;\n\nvoid solve() {\n\n}\n\nint main() {\n  cin.tie(0)->sync_with_stdio(0);\n  int T = 1;\n  cin >> T;\n  while (T--) solve();\n}\n';

export function editorPreviewSource(tabSize: number): string {
	const source = '#include <bits/stdc++.h>\nusing namespace std;\n\nint main(){\n  vector<pair<string,int>> scores={{"Alice", 85},{"Bob",92}};\n  auto total=0LL;\n  for(const auto& [name,score]:scores){\n    auto passed=score>=60; total+=score;\n    if(passed){cout<<name<<": "<<score<<\'\\n\';}else{cout<<name<<": FAIL"<<\'\\n\';}\n  }\n  auto average=static_cast<double>(total)/scores.size();\n  cout<<fixed<<setprecision(2)<<average<<\'\\n\';\n  return 0;\n}\n';
	return source.replace(/^( +)/gm, indent => ' '.repeat(indent.length / 2 * tabSize));
}

export function cppFallbackStyle(tabSize: number): string {
	return `{BasedOnStyle: LLVM, IndentWidth: ${tabSize}, TabWidth: ${tabSize}, UseTab: Never, AllowShortLoopsOnASingleLine: true, AllowShortFunctionsOnASingleLine: None}`;
}

export type PreviewToken = { text: string; style: string };
export type PreviewHint = { line: number; character: number; label: string; paddingLeft?: boolean; paddingRight?: boolean };
export type PreviewResult = { source: string; lines: PreviewToken[][]; hints: PreviewHint[]; hintError?: string };

/** Split tokens at original source positions without treating labels as source text. */
export function previewLineSegments(tokens: PreviewToken[], hints: PreviewHint[]): Array<PreviewToken & { hint?: boolean }> {
	const result: Array<PreviewToken & { hint?: boolean }> = [];
	const sorted = hints.slice().sort((a, b) => a.character - b.character);
	let offset = 0;
	let index = 0;
	for (const token of tokens) {
		let start = 0;
		while (index < sorted.length && sorted[index].character <= offset + token.text.length) {
			const hint = sorted[index++];
			const end = Math.max(start, Math.min(token.text.length, hint.character - offset));
			if (end > start) { result.push({ text: token.text.slice(start, end), style: token.style }); }
			result.push({ text: (hint.paddingLeft ? ' ' : '') + hint.label + (hint.paddingRight ? ' ' : ''), style: '', hint: true });
			start = end;
		}
		if (start < token.text.length) { result.push({ text: token.text.slice(start), style: token.style }); }
		offset += token.text.length;
	}
	return result;
}

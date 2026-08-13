/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type ClangdSystemHeadersDiagnostic = {
	status: 'ok' | 'error';
	detail: string;
};

export function diagnoseClangdSystemHeaders(output: string, succeeded = true): ClangdSystemHeadersDiagnostic {
	const includeExtractionFailure = output.match(/System include extraction:\s*([^\r\n]+)/i);
	if (includeExtractionFailure) {
		return {
			status: 'error',
			// allow-any-unicode-next-line
			detail: `clangd 无法从当前 C++ 编译器提取系统头文件：${includeExtractionFailure[1]}`
		};
	}
	if (/(?:bits[\\/]stdc\+\+\.h|<bits\/stdc\+\+\.h>).*?(?:no such file|file not found|not found)/i.test(output)) {
		return {
			status: 'error',
			// allow-any-unicode-next-line
			detail: 'clangd 无法解析 <bits/stdc++.h>。请检查当前工作区的 .clangd、clangd.path 与 --query-driver 是否指向同一套工具链。'
		};
	}
	if (!succeeded) {
		return {
			status: 'error',
			// allow-any-unicode-next-line
			detail: 'clangd 未能完成当前 C++ 文件的系统头文件检查。请检查 clangd 输出及当前工作区的 .clangd 配置。'
		};
	}
	return {
		status: 'ok',
		// allow-any-unicode-next-line
		detail: 'clangd 已成功检查当前 C++ 文件的系统头文件。'
	};
}

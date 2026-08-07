/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 根据网站的 checkerType / floatEpsilon 计算需要展示的判题类型标签。
 *
 * 网站当前下发的取值：
 * - `default` / `tokens`：普通判题（逐 token 比较），不显示任何标签；
 * - `float`（带 `floatEpsilon`）：浮点判题，显示 `Float Judge`；
 * - `testlib` 等其他特殊检查器：Special Judge，显示 `Special Judge`。
 *
 * @returns 要展示的判题类型，普通判题返回 `undefined`。
 */
export function describeJudgeType(checkerType: string, floatEpsilon: number | null): 'Float Judge' | 'Special Judge' | undefined {
	if (checkerType === 'default' || checkerType === 'tokens') {
		return undefined;
	}
	return floatEpsilon !== null ? 'Float Judge' : 'Special Judge';
}

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

export function describeFloatJudgeTolerance(floatEpsilon: number): string {
	// allow-any-unicode-next-line
	return `允许的精度误差：${floatEpsilon}`;
}

/**
 * 返回评测进行中的阶段文本。终态快照不要求网站继续提供 stage，不能将其误显示为 waiting。
 */
export function describeSubmissionStage(stage: string | undefined, detailState: 'complete' | 'unavailable' | undefined): string | undefined {
	const displayStage = stage?.trim();
	if (displayStage) {
		return displayStage;
	}
	return detailState === undefined ? 'waiting' : undefined;
}

/**
 * 将常见评测结果映射为主题相关的颜色类名。
 */
export function describeSubmissionStatus(status: string): 'accepted' | 'compilation-error' | 'failed' | 'in-progress' | 'wrong-answer' | 'runtime-error' | 'time-limit-exceeded' {
	const normalized = status.trim().toLowerCase();
	if (normalized === 'ac' || normalized === 'accepted') {
		return 'accepted';
	}
	if (normalized === 'jg' || normalized === 'na' || normalized === 'pd' || normalized === 'pending') {
		return 'in-progress';
	}
	if (normalized === 'ce' || normalized === 'compile error' || normalized === 'compilation error') {
		return 'compilation-error';
	}
	if (normalized === 'wa' || normalized === 'wrong answer') {
		return 'wrong-answer';
	}
	if (normalized === 're' || normalized === 'runtime error') {
		return 'runtime-error';
	}
	if (normalized === 'tle' || normalized === 'time limit exceeded') {
		return 'time-limit-exceeded';
	}
	return 'failed';
}

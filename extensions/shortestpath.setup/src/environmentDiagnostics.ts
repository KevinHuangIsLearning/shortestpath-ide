/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { EnvironmentSetupState } from './environmentSetup';

export type EnvironmentIssue = 'runner' | 'permission' | 'network' | 'compiler' | 'headers' | 'timeout' | 'unknown';
export type EnvironmentSetupAttempt = { startedAt: string; state: EnvironmentSetupState };

/** Classify the original diagnostics before their display translation. */
export function environmentIssue(text: string): EnvironmentIssue {
	// allow-any-unicode-next-line
	if (/Could not compile the native runner|can ?not compile the native runner|无法编译评测辅助程序/i.test(text)) { return 'runner'; }
	// allow-any-unicode-next-line
	if (/EACCES|EPERM|access is denied|permission denied|拒绝访问|权限不足/i.test(text)) { return 'permission'; }
	// allow-any-unicode-next-line
	if (/\bdownload (?:failed|connection timed out|stalled)|HTTP\s*[45]\d\d|ENOTFOUND|ECONNRESET|ECONNREFUSED|下载.*(?:失败|超时)|镜像.*(?:不可用|失败)|连接超时/i.test(text)) { return 'network'; }
	// allow-any-unicode-next-line
	if (/bits\/stdc\+\+|file not found|系统头文件|系统包含路径|query.driver|无法读取编译器/i.test(text)) { return 'headers'; }
	// allow-any-unicode-next-line
	if (/ENOENT|not recognized|could not launch|not found|not installed|未找到|尚未准备完成/i.test(text)) { return 'compiler'; }
	// allow-any-unicode-next-line
	if (/timed? ?out|ETIMEDOUT|SIGKILL|超时/i.test(text)) { return 'timeout'; }
	return 'unknown';
}

/** Export only selected diagnostic metadata, never the process environment or source files. */
export function environmentDiagnosticLog(attempts: readonly EnvironmentSetupAttempt[], metadata: Record<string, string | readonly string[] | boolean | undefined>): string {
	const sections = ['ShortestPath IDE environment diagnostics', JSON.stringify(metadata, null, 2)];
	for (const [index, attempt] of attempts.entries()) {
		sections.push(`\nAttempt ${index + 1} (${attempt.startedAt}) — ${attempt.state.ready ? 'ready' : attempt.state.running ? 'running' : 'incomplete'}`);
		for (const step of attempt.state.steps) {
			sections.push(`[${step.status}] ${step.id}: ${step.title}${step.issue ? ` (${step.issue})` : ''}\n${step.log}${step.error ? `\nError: ${step.error}\n` : ''}`);
		}
	}
	return sections.join('\n') + '\n';
}

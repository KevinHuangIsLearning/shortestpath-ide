/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ImportedProblem } from './shortestpathOjProtocol';

export function canRequestEditorial(connected: boolean): boolean {
	return connected;
}

export function canViewEditorial(connected: boolean, hasCachedEditorial: boolean): boolean {
	return connected || hasCachedEditorial;
}

export function shouldConfirmEditorial(problem: ImportedProblem): boolean {
	return problem.state.timer.accepted || problem.state.editorial.requiresConfirmation;
}

export function getEditorialConfirmationMessage(problem: ImportedProblem): string {
	return problem.state.timer.accepted ? '确认查看吗？' : problem.state.editorial.confirmationMessage;
}

export function getCurrentEditorialRemainingMs(remainingMs: number, receivedAtMs: number, nowMs = Date.now()): number {
	return Math.max(0, remainingMs - Math.max(0, nowMs - receivedAtMs));
}

export function describeEditorialLockReason(reason: string): string {
	switch (reason) {
		case 'state_wait':
			return '解题报告尚未解锁，';
		case 'wait_after_hints':
			return '查看提示后仍需等待，';
		default:
			return reason ? `解题报告暂不可查看：${reason}。` : '解题报告尚未解锁。';
	}
}

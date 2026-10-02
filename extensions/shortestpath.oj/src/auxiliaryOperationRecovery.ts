/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import type { Memento } from 'vscode';
import { ImportedProblem, parseStressStartResult, StressContext } from './shortestpathOjProtocol';
import { OutcomeUnknownError, ShortestPathOjLocalBridge } from './shortestpathOjLocalBridge';

type Kind = 'diagnostic' | 'correction';
type Attempt = { operationId: string; payload: Record<string, unknown>; taskId?: string };

/** Persist the original consent payload before sending a paid operation. */
export class AuxiliaryOperationRecovery {
	private readonly storageKey = 'shortestpath.oj.auxiliaryOperations.v2';
	private readonly active = new Set<string>();
	private writeQueue: Promise<void> = Promise.resolve();
	private save(key: string, attempt?: Attempt): Promise<void> {
		const write = this.writeQueue.then(async () => { const values = this.read(); if (attempt) { values[key] = attempt; } else { delete values[key]; } await this.storage.update(this.storageKey, values); });
		this.writeQueue = write.catch(() => {});
		return write;
	}
	constructor(private readonly storage: Memento) { }
	private key(problem: ImportedProblem, kind: Kind, submissionId: string): string {
		return JSON.stringify([problem.accountId, problem.ref, kind, submissionId, new URL(problem.url).origin, problem.target]);
	}
	private read(): Record<string, Attempt> { return this.storage.get(this.storageKey, {}); }
	async start(bridge: ShortestPathOjLocalBridge, problem: ImportedProblem, kind: Kind, submissionId: string, payload: Record<string, unknown>): Promise<unknown> {
		const key = this.key(problem, kind, submissionId);
		if (this.active.has(key)) { throw new Error('Operation is already being recovered.'); }
		this.active.add(key);
		try {
			const attempts = this.read();
			let attempt = attempts[key];
			if (attempt && !attempt.taskId) {
				const receipt = await bridge.requestAuxiliary(problem.ref, 'operation.status.request', { kind, operationId: attempt.operationId }) as { state: string; resource_id?: number };
				if (receipt.state === 'applied' && receipt.resource_id) {
					attempt.taskId = String(receipt.resource_id);
					await this.save(key, attempt);
					const response = await bridge.requestAuxiliary(problem.ref, `${kind}.get.request`, { taskId: attempt.taskId }) as { task: unknown; bridgeTask?: unknown };
					await bridge.requestAuxiliary(problem.ref, `${kind}.watch.request`, { taskId: attempt.taskId });
					return kind === 'diagnostic' ? { state: 'accepted', task: response.bridgeTask, billingDescription: '' } : response;
				}
			}
			// An explicit new start after a known response is a separate operation.
			if (!attempt || attempt.taskId) { attempt = { operationId: randomUUID(), payload: { ...payload, submissionId } }; attempts[key] = attempt; await this.save(key, attempt); }
			try {
				const response = await bridge.requestAuxiliary(problem.ref, `${kind}.start.request`, { ...attempt.payload, operationId: attempt.operationId }, true) as { task: { taskId?: string; task_id?: number } };
				attempt.taskId = String(response.task.taskId ?? response.task.task_id);
				await this.save(key, attempt);
				return response;
			} catch (error) {
				if (!(error instanceof OutcomeUnknownError)) { await this.save(key); }
				throw error;
			}
		} finally { this.active.delete(key); }
	}
	async restoreDiagnostics(bridge: ShortestPathOjLocalBridge, problem: ImportedProblem, context: StressContext): Promise<StressContext> {
		const tasks = [...context.tasks];
		for (const [key, attempt] of Object.entries(this.read())) {
			const [accountId, ref, kind, , origin, target] = JSON.parse(key) as unknown[];
			if (accountId !== problem.accountId || ref !== problem.ref || kind !== 'diagnostic' || origin !== new URL(problem.url).origin || JSON.stringify(target) !== JSON.stringify(problem.target)) { continue; }
			let taskId = attempt.taskId;
			if (!taskId) {
				const receipt = await bridge.requestAuxiliary(problem.ref, 'operation.status.request', { kind, operationId: attempt.operationId }) as { resource_id?: number };
				if (receipt.resource_id) { taskId = String(receipt.resource_id); }
			}
			if (!taskId) { continue; }
			const result = await bridge.requestAuxiliary(problem.ref, 'diagnostic.get.request', { taskId }) as { bridgeTask: unknown };
			tasks.push(parseStressStartResult({ state: 'accepted', task: result.bridgeTask, billingDescription: '' }).task);
			await bridge.requestAuxiliary(problem.ref, 'diagnostic.watch.request', { taskId });
		}
		return { ...context, tasks };
	}
}

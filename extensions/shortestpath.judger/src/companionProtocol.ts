/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import { IncomingMessage } from 'http';
import { Problem } from './types';

export class CompanionRequestError extends Error {
	constructor(public readonly status: number, message: string) { super(message); }
}

/** Decode only after all bytes arrive, with a bound independent of Content-Length. */
export function readCompanionRequest(request: IncomingMessage, limit = 128 * 1024 * 1024): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		const cleanup = () => {
			request.off('data', data); request.off('end', end); request.off('error', error); request.off('aborted', aborted);
		};
		const fail = (cause: Error) => { cleanup(); chunks.length = 0; reject(cause); };
		const data = (chunk: Buffer) => {
			size += chunk.length;
			if (size > limit) {
				fail(new CompanionRequestError(413, 'Companion request exceeds size limit'));
				request.resume();
			} else { chunks.push(Buffer.from(chunk)); }
		};
		const end = () => {
			cleanup();
			try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
			catch { reject(new CompanionRequestError(400, 'Invalid Companion JSON')); }
		};
		const error = (cause: Error) => fail(cause);
		const aborted = () => fail(new CompanionRequestError(400, 'Companion request aborted'));
		request.on('data', data); request.once('end', end); request.once('error', error); request.once('aborted', aborted);
	});
}

export function validateCompanionProblem(value: unknown): Problem {
	const problem = value as Problem | null;
	if (!problem || typeof problem.name !== 'string' || typeof problem.url !== 'string' || !Array.isArray(problem.tests) || !problem.tests.every(test => test && typeof test.input === 'string' && typeof test.output === 'string')) {
		throw new CompanionRequestError(422, 'Invalid Companion problem');
	}
	return problem;
}

/** CPH-NG-style typed template values; split/join also preserves literal replacement tokens. */
export function renderProblemTemplate(template: string, values: Record<string, unknown>): string {
	for (const [key, value] of Object.entries(values)) {
		const text = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
		template = template.split(`$${key}$`).join(text);
	}
	return template;
}

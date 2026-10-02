/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PublicProblemContent } from './generated/ide-bridge-contract';

/** Validate the public modules before a renderer or CPH consumes their arrays. */
export function validatePublicProblemContent(value: Record<string, unknown>): PublicProblemContent {
	const object = (v: unknown): Record<string, unknown> => {
		if (!v || typeof v !== 'object' || Array.isArray(v)) { throw new Error('Invalid public problem module object.'); }
		return v as Record<string, unknown>;
	};
	const str = (v: unknown) => { if (typeof v !== 'string') { throw new Error('Invalid public problem module text.'); } };
	const list = (v: unknown, check: (item: Record<string, unknown>) => void) => {
		if (!Array.isArray(v)) { throw new Error('Invalid public problem module list.'); }
		v.forEach(item => check(object(item)));
	};
	const events = (v: unknown) => list(v, event => { str(event.from); str(event.format); if (event.description !== undefined) { str(event.description); } });
	if (value.scoring_rules !== undefined) { str(value.scoring_rules); }
	if (value.interaction !== undefined) {
		const interaction = object(value.interaction);
		if (interaction.schema_version !== 1) { throw new Error('Unsupported interaction schema version.'); }
		events(interaction.session_start); events(interaction.case_start);
		list(interaction.phases, phase => { str(phase.name); str(phase.condition); events(phase.events); });
		list(interaction.budgets, budget => { str(budget.scope); str(budget.name); str(budget.limit); if (budget.cost !== undefined) { str(budget.cost); } });
		for (const key of ['requirements', 'flush', 'termination', 'failure']) { str(interaction[key]); }
		list(interaction.samples, sample => {
			str(sample.explanation);
			list(sample.events, event => { str(event.from); str(event.text); if (event.note !== undefined) { str(event.note); } });
			if (sample.hidden_states !== undefined) { list(sample.hidden_states, state => { str(state.content); if (!Number.isSafeInteger(state.case)) { throw new Error('Invalid hidden case.'); } }); }
		});
	}
	if (value.judge_runtime !== undefined) {
		const runtime = object(value.judge_runtime);
		const declarations = (v: unknown) => list(v, entry => { str(entry.name); str(entry.signature); });
		list(runtime.components, component => { declarations(component.entrypoints); declarations(component.judge_api); });
		list(runtime.public_headers, header => { str(header.name); str(header.content); });
	}
	if (value.local_judging !== undefined) {
		const local = object(value.local_judging);
		if (local.schema_version !== 1 || !['grader', 'checker'].includes(String(local.kind))) { throw new Error('Unsupported local judging schema.'); }
		list(local.files, file => { str(file.name); str(file.role); str(file.url); });
		if (local.kind === 'checker') { const checker = object(local.checker); str(checker.answer_kind); if (!Array.isArray(checker.arguments) || !checker.arguments.every(item => typeof item === 'string')) { throw new Error('Invalid checker arguments.'); } }
		if (local.kind === 'grader') { const grader = object(local.grader); str(grader.entry_point); str(grader.output); const input = object(grader.input); str(input.mode); str(input.format); if (grader.example !== undefined) { const example = object(grader.example); str(example.input); if (example.output !== undefined) { str(example.output); } } }
	}
	return value as unknown as PublicProblemContent;
}

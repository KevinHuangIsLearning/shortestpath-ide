/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProblemRatingSession, parseProblemRating } from '../problemRating';
import type { ProblemRatingResponse } from '../generated/api-contract';

const initial: ProblemRatingResponse = { can_rate: true, counts: { good: 3, neutral: 2, bad: 1 }, rating: '', first_ac_submission_id: 7 };
const flush = async () => { for (let index = 0; index < 10; index++) { await Promise.resolve(); } };

test('rating responses reject malformed counts, selection, eligibility and first-AC identity', () => {
	assert.deepEqual(parseProblemRating(initial), initial);
	for (const value of [null, {}, { ...initial, rating: 'five' }, { ...initial, can_rate: 'true' }, { ...initial, counts: { good: -1, neutral: 0, bad: 0 } }, { ...initial, first_ac_submission_id: '7' }, { ...initial, unlock_at: 'invalid' }]) {
		assert.throws(() => parseProblemRating(value));
	}
});

test('only newly submitted first AC invites a rating; history, repeat verdicts and later AC do not', async () => {
	const session = new ProblemRatingSession(async () => initial, async () => initial, () => { });
	await session.refresh();
	session.observeAccepted('7');
	await flush();
	assert.equal(session.promptOpen, false);
	// Also handles a fast final verdict arriving before the submission response.
	session.trackSubmission('7');
	await flush();
	assert.equal(session.promptOpen, true);
	session.dismiss();
	session.observeAccepted('7');
	session.trackSubmission('8');
	session.observeAccepted('8');
	await flush();
	assert.equal(session.promptOpen, false);
	session.dispose();
});

test('first AC waits for a fresh response when the pre-AC rating read is still pending', async () => {
	let finish!: (data: ProblemRatingResponse) => void;
	let reads = 0;
	const session = new ProblemRatingSession(() => ++reads === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(initial), async () => initial, () => { });
	const request = session.refresh();
	session.trackSubmission('7');
	session.observeAccepted('7');
	finish({ ...initial, can_rate: false, first_ac_submission_id: undefined });
	await request;
	await flush();
	assert.deepEqual({ reads, open: session.promptOpen }, { reads: 2, open: true });
	session.dispose();
});

test('successful rating updates counts and selection in both views; failed saves keep the invitation open', async () => {
	let fail = true;
	const session = new ProblemRatingSession(async () => initial, async rating => {
		if (fail) { throw new Error('Save failed'); }
		return { ...initial, rating, counts: { ...initial.counts, good: 4 } };
	}, () => { });
	session.trackSubmission('7'); session.observeAccepted('7');
	await flush();
	await session.rate('good');
	assert.deepEqual({ open: session.promptOpen, error: session.error, saving: session.saving }, { open: true, error: 'Save failed', saving: false });
	fail = false;
	await session.rate('good');
	assert.deepEqual({ open: session.promptOpen, data: session.data, saving: session.saving }, { open: false, data: { ...initial, rating: 'good', counts: { good: 4, neutral: 2, bad: 1 } }, saving: false });
	session.dispose();
});

test('late reads cannot overwrite a saved rating, and duplicate clicks save only once', async () => {
	let finishRead!: (value: ProblemRatingResponse) => void;
	let finishSave!: (value: ProblemRatingResponse) => void;
	let writes = 0;
	let delayed = false;
	const session = new ProblemRatingSession(() => delayed ? new Promise(resolve => { finishRead = resolve; }) : Promise.resolve(initial), () => { writes++; return new Promise(resolve => { finishSave = resolve; }); }, () => { });
	await session.refresh();
	delayed = true;
	const write = session.rate('bad');
	await session.rate('good');
	const read = session.refresh();
	finishSave({ ...initial, rating: 'bad' });
	await write;
	finishRead(initial);
	await read;
	assert.deepEqual({ writes, selected: session.data?.rating }, { writes: 1, selected: 'bad' });
	session.dispose();
});

test('the five-hour unlock updates eligibility without polling and disposal cancels its timer', async context => {
	context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 });
	let changes = 0;
	const session = new ProblemRatingSession(async () => ({ ...initial, can_rate: false, unlock_at: new Date(2_000).toISOString() }), async () => initial, () => { changes++; });
	await session.refresh();
	assert.equal(session.canRate(), false);
	context.mock.timers.tick(1_000);
	assert.equal(session.canRate(), true);
	const beforeDispose = changes;
	session.dispose();
	context.mock.timers.tick(10_000);
	assert.equal(changes, beforeDispose);
});

test('disposed account or problem contexts ignore late responses and cannot open a prompt', async () => {
	let finish!: (value: ProblemRatingResponse) => void;
	const session = new ProblemRatingSession(() => new Promise(resolve => { finish = resolve; }), async () => initial, () => { });
	const read = session.refresh();
	session.trackSubmission('7'); session.observeAccepted('7');
	session.dispose();
	finish(initial);
	await read;
	await flush();
	assert.deepEqual({ data: session.data, open: session.promptOpen }, { data: undefined, open: false });
});

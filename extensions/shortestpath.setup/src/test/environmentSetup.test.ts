/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { EnvironmentSetupRunner, type EnvironmentSetupState } from '../environmentSetup';

const step = (id: string, run: (report: (message: string) => void) => Promise<void>) => ({ id, title: id, description: id, run });

test('requires every checklist item including self-test to pass', async () => {
	const states: EnvironmentSetupState[] = [];
	const runner = new EnvironmentSetupRunner([step('install', async report => report('installed')), step('configuration', async () => {}), step('selfTest', async () => {})], state => states.push(state));
	assert.equal(runner.snapshot.ready, false);
	await runner.run();
	assert.deepEqual(runner.snapshot.steps.map(item => item.status), ['complete', 'complete', 'complete']);
	assert.equal(runner.snapshot.ready, true);
	assert.equal(runner.snapshot.running, false);
	assert.ok(states.filter(state => state.running).every(state => !state.ready));
	assert.equal(runner.snapshot.steps[0].log, 'installed\n');
	const snapshot = runner.snapshot; snapshot.steps[0].status = 'error';
	assert.equal(runner.snapshot.steps[0].status, 'complete');
});

test('stops on failure and can retry without marking setup ready early', async () => {
	let fail = true;
	let calls = 0;
	const runner = new EnvironmentSetupRunner([step('install', async () => {}), step('selfTest', async () => { calls++; if (fail) { throw new Error('compile failed'); } }), step('afterTest', async () => { calls++; })], () => {});
	await runner.run();
	assert.equal(runner.snapshot.ready, false);
	assert.deepEqual(runner.snapshot.steps.map(item => item.status), ['complete', 'error', 'pending']);
	assert.match(runner.snapshot.steps[1].log, /compile failed/);
	assert.equal(calls, 1);
	fail = false;
	await runner.run();
	assert.equal(runner.snapshot.ready, true);
	assert.equal(calls, 3);
});

test('serializes duplicate clicks, preserves ongoing state, and bounds logs', async () => {
	let release!: () => void;
	let calls = 0;
	const runner = new EnvironmentSetupRunner([step('install', async report => { calls++; report('x'.repeat(30000)); await new Promise<void>(resolve => { release = resolve; }); })], () => {});
	const running = runner.run();
	await runner.run();
	assert.equal(calls, 1);
	assert.equal(runner.snapshot.running, true);
	assert.equal(runner.snapshot.ready, false);
	assert.equal(runner.snapshot.steps[0].log.length, 24000);
	release(); await running;
	await runner.run();
	assert.equal(calls, 1);
});

test('an empty checklist cannot satisfy readiness', async () => {
	const runner = new EnvironmentSetupRunner([], () => {});
	await runner.run();
	assert.equal(runner.snapshot.ready, false);
});

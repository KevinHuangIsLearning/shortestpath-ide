/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { environmentDiagnosticLog, environmentIssue } from '../environmentDiagnostics';
import { EnvironmentSetupRunner } from '../environmentSetup';

test('classifies actionable startup failures without mistaking missing headers for a missing executable', () => {
	assert.deepEqual([
		'Could not compile the native runner.\nld: access is denied', '无法编译评测辅助程序。',
		'EACCES', '下载连接超时。', 'spawn g++ ENOENT', 'fatal error: bits/stdc++.h: file not found', 'clangd SIGKILL', 'unexpected failure'
	].map(environmentIssue), ['runner', 'runner', 'permission', 'network', 'compiler', 'headers', 'timeout', 'unknown']);
	const compilerLog = '{"compiler":"C:/Users/Student/Downloads/IDE/g++.exe"}\n';
	assert.deepEqual(['fatal error: bits/stdc++.h: file not found', 'spawn g++ ENOENT', 'SIGKILL', 'unexpected failure']
		.map(error => environmentIssue(compilerLog + error)), ['headers', 'compiler', 'timeout', 'unknown']);
});

test('retains the failed attempt after successful retry and exports selected metadata and raw diagnostics', async () => {
	let failed = true;
	const runner = new EnvironmentSetupRunner([{ id: 'selfTest', title: 'Self-test', description: '', async run(report) {
		report('<script>external compiler output</script>');
		if (failed) { throw new Error('Could not compile the native runner'); }
	} }], () => {}, () => 'translated failure');
	assert.equal(runner.attempts.length, 0);
	await runner.run();
	failed = false;
	await runner.run();
	const exported = environmentDiagnosticLog(runner.attempts, { platform: 'win32', compiler: 'C:/Tool Chain/g++.exe', compilerArgs: '-std=c++20' });
	assert.deepEqual(runner.attempts.map(attempt => [attempt.state.ready, attempt.state.steps[0].status, attempt.state.steps[0].issue]), [[false, 'error', 'runner'], [true, 'complete', undefined]]);
	assert.match(exported, /C:\/Tool Chain\/g\+\+\.exe/);
	assert.match(exported, /Attempt 1[\s\S]*external compiler output[\s\S]*translated failure[\s\S]*Attempt 2/);
	const copy = runner.attempts;
	copy[0].state.steps[0].log = 'changed';
	assert.notEqual(runner.attempts[0].state.steps[0].log, 'changed');
});

test('keeps retry history and each log bounded and resets advice between attempts', async () => {
	const runner = new EnvironmentSetupRunner([{ id: 'toolchain', title: 'Toolchain', description: '', async run(report) { report('x'.repeat(30000)); throw new Error('download connection timed out'); } }], () => {});
	for (let attempt = 0; attempt < 6; attempt++) { await runner.run(); }
	assert.deepEqual(runner.attempts.map(attempt => [attempt.state.steps[0].log.length, attempt.state.steps[0].issue]), Array(4).fill([24000, 'network']));
});

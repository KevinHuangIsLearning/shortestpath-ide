/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcessWithoutNullStreams, spawn, SpawnOptionsWithoutStdio } from 'child_process';
import { Readable } from 'stream';

const cpuReports = new WeakMap<ChildProcessWithoutNullStreams, { text: string }>();

/** macOS supplies zsh, whose time keyword reports child user + system CPU microseconds. */
export function spawnTestCaseProcess(command: string, args: string[], options: SpawnOptionsWithoutStdio): ChildProcessWithoutNullStreams {
	if (process.platform !== 'darwin') {
		return spawn(command, args, options);
	}

	// Pass paths and arguments as argv, never interpolate them into shell source.
	// A separate pipe keeps timing and shell diagnostics out of program stderr.
	const child = spawn('/bin/zsh', [
		'-df', '-c',
		'TIMEFMT=\'%uU %uS\'; { time "$@" 2>&4 3>&- 4>&-; } 4>&2 2>&3',
		'cph', command, ...args,
	], { ...options, detached: true, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams;
	const report = { text: '' };
	cpuReports.set(child, report);
	(child.stdio[3] as Readable).on('data', (data: Buffer) => {
		report.text += data.toString();
	});
	return child;
}

export function getTestCaseTime(child: ChildProcessWithoutNullStreams, elapsed: number): number {
	const report = cpuReports.get(child);
	if (!report) {
		return elapsed;
	}
	const match = /^(?<user>\d+)us (?<system>\d+)us$/m.exec(report.text);
	// A killed timing process cannot report CPU usage. Do not mislabel wall time as CPU time.
	return match?.groups ? Math.round((Number(match.groups.user) + Number(match.groups.system)) / 1000) : 0;
}

/** Stop the entire timed process group, including the program and its descendants. */
export function killTestCaseProcess(child: ChildProcessWithoutNullStreams): void {
	if (!cpuReports.has(child) || !child.pid) {
		child.kill();
		return;
	}
	try {
		process.kill(-child.pid, 'SIGKILL');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
			throw error;
		}
	}
}

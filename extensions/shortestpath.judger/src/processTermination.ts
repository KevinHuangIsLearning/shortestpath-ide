/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger. Licensed under GPL-3.0-or-later.
 *--------------------------------------------------------------------------------------------*/
import { ChildProcess } from 'child_process';

const stopping = new WeakSet<ChildProcess>();

/** Give wrappers time to clean up their children, then force termination. */
export function terminateProcess(child: ChildProcess): void {
	if (child.exitCode !== null || child.signalCode !== null || stopping.has(child)) { return; }
	stopping.add(child);
	const fallback = setTimeout(() => {
		if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); }
	}, 250);
	child.once('close', () => clearTimeout(fallback));
	child.kill('SIGTERM');
}

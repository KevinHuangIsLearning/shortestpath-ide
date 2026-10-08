/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { dashboardContains } from './dashboardRepository';
import { DashboardCompletion, DashboardProblem, DASHBOARD_TIME_LIMIT_MS, canSetDashboardCompletion } from './dashboardStats';
import { isShortestPathProblem } from './problemTimer';

/** Patch only completion metadata; never load or rewrite the testcase snapshot. */
export function updateDashboardCompletion(problem: DashboardProblem, completion: DashboardCompletion, roots: string[], now = Date.now()): void {
	if (!canSetDashboardCompletion(problem) || !['none', 'partial', 'accepted'].includes(completion)) { throw new Error('Invalid Dashboard completion'); }
	const file = problem.recordId!;
	const stat = fs.lstatSync(file);
	if (!stat.isFile() || stat.isSymbolicLink() || !roots.some(root => dashboardContains(root, file) && dashboardContains(fs.realpathSync(root), fs.realpathSync(file)))) { throw new Error('Invalid Dashboard record path'); }
	const contents = fs.readFileSync(file, 'utf8');
	if (problem.recordFingerprint && crypto.createHash('sha256').update(contents).digest('hex') !== problem.recordFingerprint) { throw new Error('Dashboard record changed; refresh before editing'); }
	const stored = JSON.parse(contents);
	const metadata = path.basename(file) === 'problem.json' ? stored?.problem : stored;
	if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) { throw new Error('Invalid Dashboard record'); }
	metadata.dashboardCreatedAtUnixMs = problem.createdAtUnixMs;
	metadata.dashboardTimeCapped = true;
	metadata.timeSpentMs = DASHBOARD_TIME_LIMIT_MS;
	metadata.timeStartedAtUnixMs = now - DASHBOARD_TIME_LIMIT_MS;
	delete metadata.timeAcceptedAtUnixMs;
	delete metadata.timePartialAcceptedAtUnixMs;
	if (completion === 'accepted') { metadata.timeAcceptedAtUnixMs = now; }
	if (completion === 'partial') { metadata.timePartialAcceptedAtUnixMs = now; }
	if (isShortestPathProblem(problem.url)) { metadata.dashboardCompletion = completion; }
	metadata.storageRevision = crypto.randomUUID();
	const temporary = `${file}.${crypto.randomBytes(16).toString('hex')}.tmp`;
	try {
		fs.writeFileSync(temporary, JSON.stringify(stored), { encoding: 'utf8', mode: stat.mode });
		fs.renameSync(temporary, file);
	} finally { fs.rmSync(temporary, { force: true }); }
}


/** Confirmation happens before any filesystem mutation; cancellation leaves the record untouched. */
export async function confirmAndUpdateDashboardCompletion(problem: DashboardProblem, completion: DashboardCompletion, roots: () => string[], confirm: () => Promise<boolean>, isCurrent: () => boolean = () => true): Promise<boolean> {
	if (!canSetDashboardCompletion(problem) || !['accepted', 'partial'].includes(completion)) { return false; }
	if (!await confirm() || !isCurrent()) { return false; }
	updateDashboardCompletion(problem, completion, roots());
	return true;
}

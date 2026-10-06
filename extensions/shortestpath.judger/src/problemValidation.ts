/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger. Licensed under GPL-3.0-or-later.
 *--------------------------------------------------------------------------------------------*/
import { Problem } from './types';

/**
 * Shared field constraints for a problem patch. Deliberately free of any
 * `vscode` import so the webview settings form and the extension host can both
 * import it and agree on what a valid patch is.
 */
const STRING_FIELDS = [
    'name',
    'url',
    'compilerCommand',
    'interpreterCommand',
    'customCheckerPath',
    'interactorPath',
] as const;

const ARRAY_FIELDS = [
    'compilerArgs',
    'interpreterArgs',
] as const;

/** Names of the fields in `patch` that violate the shared constraints. */
export function invalidProblemPatchFields(patch: Partial<Problem>): string[] {
    const invalid: string[] = [];
    for (const key of ['timeSpentMs', 'timeStartedAtUnixMs', 'timeAcceptedAtUnixMs'] as const) {
        const value = patch[key];
        if (value !== undefined && (!Number.isFinite(value) || value < 0)) { invalid.push(key); }
    }
    if (patch.timeStartedAtUnixMs !== undefined && patch.timeAcceptedAtUnixMs !== undefined && patch.timeAcceptedAtUnixMs < patch.timeStartedAtUnixMs) { invalid.push('timeAcceptedAtUnixMs'); }
    for (const key of STRING_FIELDS) {
        const value = patch[key];
        if (value !== undefined && typeof value !== 'string') { invalid.push(key); }
    }
    for (const key of ARRAY_FIELDS) {
        const value = patch[key];
        if (value !== undefined && (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))) {
            invalid.push(key);
        }
    }
    if (patch.timeLimit !== undefined && (!Number.isFinite(patch.timeLimit) || patch.timeLimit <= 0)) { invalid.push('timeLimit'); }
    if (patch.memoryLimit !== undefined && (!Number.isFinite(patch.memoryLimit) || patch.memoryLimit <= 0)) { invalid.push('memoryLimit'); }
    if (patch.name !== undefined && !patch.name.trim()) { invalid.push('name'); }
    return invalid;
}

/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger. Licensed under GPL-3.0-or-later.
 *--------------------------------------------------------------------------------------------*/
import { Case, TestCase } from './types';
export function expandAfterRun(mode: string, cases: Case[], id: number): boolean | undefined {
    const enabled = cases.filter(item => !item.testcase.disabled);
    const item = enabled.find(item => item.id === id);
    if (mode === 'same' || !item?.result) { return undefined; }
    if (mode === 'always') { return true; }
    if (mode === 'never') { return false; }
    if (mode === 'first') { return enabled[0]?.id === id; }
    if (mode === 'firstFailed') { return enabled.find(item => item.result?.pass === false)?.id === id; }
    return item.result.pass === false;
}

/** Storage can reorder fields and omit false/undefined flags without changing a sample. */
export function sameTestcase(left: TestCase | undefined, right: TestCase | undefined): boolean {
    if (!left || !right) { return false; }
    return left.id === right.id && !!left.disabled === !!right.disabled
        && (left.inputPath || undefined) === (right.inputPath || undefined)
        && (left.outputPath || undefined) === (right.outputPath || undefined)
        && (left.inputPath ? true : left.input === right.input)
        && (left.outputPath ? true : left.output === right.output);
}

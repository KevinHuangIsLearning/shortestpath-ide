import { AuxiliaryPrograms } from '../auxiliaryPrograms';
import { problemLanguage } from '../problemOptions';
import { Problem } from '../types';
import { runSingleAndSave } from './processRunSingle';
import { compileFile } from '../compiler';
import { wasKillRequested } from '../executions';
import { getLanguage } from '../utils';
import { getJudgeViewProvider } from '../extension';

/**
 * Run every testcase in a problem one by one. Waits for the first to complete
 * before running next. `runSingleAndSave` takes care of saving.
 **/
export default async (problem: Problem) => {
    globalThis.logger.log('Run all started', problem);
    const didCompile = await compileFile(problem.srcPath, { instrumentation: !problem.interactorPath, language: problemLanguage(getLanguage(problem.srcPath), problem) });
    if (!didCompile) {
        for (const test of problem.tests.filter(test => !test.disabled)) {
            getJudgeViewProvider().extensionToJudgeViewMessage({ command: 'run-single-result', problem, result: { id: test.id, pass: false, verdict: wasKillRequested() ? 'STOP' : 'CE', stdout: '', stderr: '', code: 1, signal: null, time: 0, timeOut: false } });
        }
        return false;
    }
    const artifacts = new AuxiliaryPrograms();
    try {
    for (const testCase of problem.tests) {
        if (testCase.disabled) { continue; }
        if (wasKillRequested()) { break; }
        getJudgeViewProvider().extensionToJudgeViewMessage({
            command: 'running',
            id: testCase.id,
            problem: problem,
        });
        await runSingleAndSave(problem, testCase.id, true, true, artifacts);
    }
    } finally { artifacts.dispose(); }
    globalThis.logger.log('Run all finished');
    return !wasKillRequested();
};

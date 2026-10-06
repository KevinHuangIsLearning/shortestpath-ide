jest.mock('vscode', () => ({ workspace: { getConfiguration: jest.fn(() => ({ get: (_key: string, fallback: unknown) => fallback })) } }), {
	virtual: true,
});
jest.mock('../executions', () => ({
	runTestCase: jest.fn(),
	runInteractiveTestCase: jest.fn(),
	runCustomChecker: jest.fn(),
}));
import { executeAndJudgeTestCase } from '../testCaseExecution';
import { runTestCase, runInteractiveTestCase, runCustomChecker } from '../executions';
import { Language } from '../types';

test('invalid checker configuration fails before starting an interactive solution', async () => {
	const result = await executeAndJudgeTestCase({} as Language, '/solution', {
		id: 1,
		input: '',
		expectedOutput: '',
		interactorPath: '/interactor',
		configurationError: 'Checker does not exist',
		failOnStderr: false,
	});
	expect(result.pass).toBe(false);
	expect(result.stderr).toBe('Checker does not exist');
	expect(runTestCase).not.toHaveBeenCalled();
	expect(runInteractiveTestCase).not.toHaveBeenCalled();
});


test.each(['TLE', 'RE', 'CE'])('checker %s remains separate from the successful solution execution', async verdict => {
	const success = { stdout: 'answer', stderr: '', code: 0, signal: null, time: 10, timeOut: false };
	(runTestCase as jest.Mock).mockResolvedValue(success);
	(runCustomChecker as jest.Mock).mockResolvedValue({ ...success, command: '/checker', verdict, code: verdict === 'CE' ? 3 : null, signal: verdict === 'CE' ? null : 'SIGKILL', timeOut: verdict === 'TLE' });
	const result = await executeAndJudgeTestCase({} as Language, '/solution', { id: 1, input: '', expectedOutput: '', checkerPath: '/checker', failOnStderr: false });
	expect(result.pass).toBe(false);
	expect(result.checkerRun?.verdict).toBe(verdict);
	expect([result.code, result.signal, result.timeOut]).toEqual([0, null, false]);
});


test.each([
    [{ time: 1001 }, { timeLimitMs: 1000 }, 'TLE'],
    [{ memoryBytes: 257 * 1024 * 1024 }, { memoryLimitMb: 256 }, 'MLE'],
    [{ outputLimitExceeded: true }, {}, 'OLE'],
    [{ code: 1 }, {}, 'RE'],
])('solution failure receives an explicit verdict', async (run, limits, verdict) => {
    (runTestCase as jest.Mock).mockResolvedValue({ stdout: '', stderr: '', code: 0, signal: null, time: 10, timeOut: false, ...run });
    const result = await executeAndJudgeTestCase({} as Language, '/solution', { id: 1, input: '', expectedOutput: '', failOnStderr: false, ...limits });
    expect(result.pass).toBe(false);
    expect(result.verdict).toBe(verdict);
});

test.each(['AC', 'WA', 'PE', 'FAIL', 'PARTIAL'] as const)('checker %s reaches the result without being collapsed to WA', async verdict => {
    const run = { stdout: '', stderr: '', code: 0, signal: null, time: 1, timeOut: false };
    (runTestCase as jest.Mock).mockResolvedValue(run);
    (runCustomChecker as jest.Mock).mockResolvedValue({ ...run, verdict });
    const result = await executeAndJudgeTestCase({} as Language, '/solution', { id: 1, input: '', expectedOutput: '', checkerPath: '/checker', failOnStderr: false });
    expect(result.verdict).toBe(verdict);
    expect(result.pass).toBe(verdict === 'AC' || verdict === 'PE');
});

test('interactor WA cleanup does not become a solution RE; an actual solution crash still does', async () => {
    const run = { stdout: '', stderr: '', code: null, signal: 'SIGKILL', time: 1, timeOut: false };
    const checker = { ...run, code: 1, signal: null };
    (runInteractiveTestCase as jest.Mock).mockResolvedValue({ run, checker, solutionTerminatedByJudge: true });
    const options = { id: 1, input: '', expectedOutput: '', interactorPath: '/interactor', failOnStderr: false };
    expect((await executeAndJudgeTestCase({} as Language, '/solution', options)).verdict).toBe('WA');
    (runInteractiveTestCase as jest.Mock).mockResolvedValue({ run: { ...run, signal: 'SIGSEGV' }, checker: { ...checker, code: 0 }, solutionTerminatedByJudge: false });
    expect((await executeAndJudgeTestCase({} as Language, '/solution', options)).verdict).toBe('RE');
});

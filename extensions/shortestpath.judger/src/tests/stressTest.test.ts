jest.mock(
    'vscode',
    () => ({
        Uri: { file: (fsPath: string) => ({ fsPath }) },
        workspace: {
            getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback }),
            getWorkspaceFolder: jest.fn(() => undefined),
            openTextDocument: jest.fn(async () => ({ save: jest.fn() })),
        },
    }),
    { virtual: true },
);

const mockCompileFile = jest.fn().mockResolvedValue(true);
const mockGetBinSaveLocation = jest.fn(
    (sourcePath: string) => `${sourcePath}.bin`,
);
jest.mock('../compiler', () => ({
    compileFile: mockCompileFile,
    getBinSaveLocation: mockGetBinSaveLocation,
}));

const mockRunTestCase = jest.fn();
const mockRunCustomChecker = jest.fn();
jest.mock('../executions', () => ({
    clearKillRequested: jest.fn(),
    runTestCase: mockRunTestCase,
    runCustomChecker: mockRunCustomChecker,
    wasKillRequested: jest.fn(() => false),
}));

jest.mock('../utils', () => ({
    getLanguage: jest.fn(() => ({
        name: 'cpp',
        compiler: 'g++',
        args: [],
        skipCompile: false,
    })),
}));

jest.mock('../preferences', () => ({
    getIgnoreSTDERRORPref: jest.fn(() => true),
    getSaveLocationPref: () => '',
    getCollectProblemsInRoot: () => false,
}));

globalThis.logger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
};

import { wasKillRequested } from '../executions';
import { Problem } from '../types';
import { getStressTempRoot, runStressTest } from '../stressTest';

describe('stress test runner', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (wasKillRequested as jest.Mock).mockReturnValue(false);
    });

    test('stops on the first output difference and returns the counterexample', async () => {
        const os = await import('os');
        const fs = await import('fs/promises');
        const root = await fs.mkdtemp(`${os.tmpdir()}/cph-stress-test-`);
        const target = `${root}/target.cpp`;
        const generator = `${root}/generator.cpp`;
        const std = `${root}/std.cpp`;
        await Promise.all([
            fs.writeFile(target, 'int main() {}'),
            fs.writeFile(generator, 'int main() {}'),
            fs.writeFile(std, 'int main() {}'),
        ]);
        mockCompileFile.mockImplementation(
            async (_sourcePath: string, options: { outputPath: string }) => {
                await fs.writeFile(options.outputPath, 'stress binary');
                return true;
            },
        );

        mockRunTestCase
            .mockResolvedValueOnce({
                stdout: '1\n',
                stderr: '',
                code: 0,
                signal: null,
                time: 1,
                timeOut: false,
            })
            .mockResolvedValueOnce({
                stdout: '2\n',
                stderr: '',
                code: 0,
                signal: null,
                time: 1,
                timeOut: false,
            })
            .mockResolvedValueOnce({
                stdout: '3\n',
                stderr: '',
                code: 0,
                signal: null,
                time: 1,
                timeOut: false,
            });

        const onFailure = jest.fn();
        const onStatus = jest.fn();
        const result = await runStressTest(
            {
                srcPath: target,
                tests: [],
                name: 'test',
                url: '',
                interactive: false,
                memoryLimit: 0,
                timeLimit: 0,
                group: 'local',
            },
            generator,
            std,
            100,
            {
                onProgress: jest.fn(),
                onStatus,
                onFailure,
            },
        );

        expect(result).toEqual({ state: 'found', iteration: 1 });
        expect(mockRunTestCase).toHaveBeenCalledTimes(3);
        expect(mockRunTestCase.mock.calls.map(call => call[3].timeoutMs)).toEqual([10000, 60000, 4000]);
        expect(mockRunTestCase.mock.calls.map(call => call[3].cwd)).toEqual([root, root, root]);
        expect(onStatus.mock.calls).toEqual([
            ['compiling', 'generator'],
            ['compiling', 'std'],
            ['compiling', 'target'],
            ['running', 'generator', 1, 100],
            ['running', 'std', 1, 100],
            ['running', 'target', 1, 100],
        ]);
        expect(onFailure).toHaveBeenCalledWith(
            1,
            expect.objectContaining({ input: '1\n', output: '2\n' }),
            expect.objectContaining({ pass: false }),
        );
        await expect(fs.access(root)).resolves.toBeUndefined();
        await expect(fs.access(getStressTempRoot(target))).rejects.toMatchObject({
            code: 'ENOENT',
        });
        await fs.rm(root, { recursive: true, force: true });
    });
    test.each([
        [{ memoryBytes: 257 * 1024 * 1024 }, 'MLE'],
        [{ time: 1001 }, 'TLE'],
        [{ time: 1, timeOut: true }, 'TLE'],
    ])('reports resource failure even when output matches: %s', async (metrics, verdict) => {
        const fs = await import('fs/promises');
        const os = await import('os');
        const root = await fs.mkdtemp(`${os.tmpdir()}/judger-stress-limits-`);
        const target = `${root}/main.cpp`, generator = `${root}/gen.cpp`, std = `${root}/std.cpp`;
        await Promise.all([target, generator, std].map(file => fs.writeFile(file, 'int main(){}')));
        mockCompileFile.mockImplementation(async (_source: string, options: { outputPath: string }) => { await fs.writeFile(options.outputPath, 'binary'); return true; });
        const success = { stdout: '1', stderr: '', code: 0, signal: null, time: 1, timeOut: false };
        mockRunTestCase.mockResolvedValueOnce(success).mockResolvedValueOnce(success).mockResolvedValueOnce({ ...success, ...metrics });
        const onFailure = jest.fn();
        try {
            const result = await runStressTest({ srcPath: target, tests: [], name: 'A', url: '', interactive: false, timeLimit: 1000, memoryLimit: 256, group: '' }, generator, std, 1, { onProgress: jest.fn(), onStatus: jest.fn(), onFailure });
            expect([result.state, onFailure.mock.calls[0][2].verdict]).toEqual(['found', verdict]);
        } finally { await fs.rm(root, { recursive: true, force: true }); }
    });

});


describe('CPH-NG stress workflow', () => {
    let root: string;
    let problem: Problem;
    let generator: string;
    let brute: string;
    const success = { stdout: '1', stderr: '', code: 0, signal: null, time: 1, timeOut: false };
    beforeEach(async () => {
        const fs = await import('fs/promises');
        root = await fs.mkdtemp((await import('os')).tmpdir() + '/judger-stress-flow-');
        generator = root + '/gen.cpp'; brute = root + '/brute.cpp';
        problem = { srcPath: root + '/main.cpp', tests: [], name: 'A', url: '', group: '', interactive: false, timeLimit: 1000, memoryLimit: 256 };
        await Promise.all([problem.srcPath, generator, brute].map(file => fs.writeFile(file, 'int main(){}')));
        mockCompileFile.mockReset().mockResolvedValue(true);
        mockRunTestCase.mockReset().mockResolvedValue({ ...success });
        mockRunCustomChecker.mockReset().mockResolvedValue({ ...success, verdict: 'AC' });
        (wasKillRequested as jest.Mock).mockReturnValue(false);
    });
    afterEach(async () => { await (await import('fs/promises')).rm(root, { recursive: true, force: true }); });
    const callbacks = () => ({ onProgress: jest.fn(), onStatus: jest.fn(), onFailure: jest.fn() });

    test('a custom checker decides acceptance, even when outputs differ', async () => {
        problem.customCheckerPath = root + '/checker';
        mockRunTestCase.mockResolvedValueOnce({ ...success, stdout: 'input' }).mockResolvedValueOnce({ ...success, stdout: 'expected' }).mockResolvedValueOnce({ ...success, stdout: 'different but accepted' });
        const result = await runStressTest(problem, generator, brute, 1, callbacks());
        expect([result.state, mockRunCustomChecker.mock.calls[0].slice(0, 4)]).toEqual(['passed', [problem.customCheckerPath, 'input', 'different but accepted', 'expected']]);
    });

    test('zero iterations runs until cancellation and preserves sibling artifacts', async () => {
        const fs = await import('fs/promises');
        const sibling = getStressTempRoot(problem.srcPath) + '/other-run';
        await fs.mkdir(sibling, { recursive: true });
        const cb = callbacks();
        cb.onProgress.mockImplementation(iteration => { if (iteration === 3) { (wasKillRequested as jest.Mock).mockReturnValue(true); } });
        const result = await runStressTest(problem, generator, brute, 0, cb);
        expect([result, mockRunTestCase.mock.calls.length, await fs.readdir(getStressTempRoot(problem.srcPath))]).toEqual([{ state: 'stopped', iteration: 3 }, 6, ['other-run']]);
    });

    test('cancellation during compilation stops before execution', async () => {
        mockCompileFile.mockImplementationOnce(async () => { (wasKillRequested as jest.Mock).mockReturnValue(true); return false; });
        const result = await runStressTest(problem, generator, brute, 1, callbacks());
        expect([result, mockRunTestCase.mock.calls.length]).toEqual([{ state: 'stopped', iteration: 0 }, 0]);
    });

    test('large counterexamples survive cleanup as problem-owned file references', async () => {
        const data = 'x'.repeat(70000);
        mockRunTestCase.mockResolvedValueOnce({ ...success, stdout: data }).mockResolvedValueOnce({ ...success, stdout: data }).mockResolvedValueOnce({ ...success, stdout: 'wrong' });
        const cb = callbacks();
        await runStressTest(problem, generator, brute, 1, cb);
        const testcase = cb.onFailure.mock.calls[0][1];
        const fs = await import('fs/promises');
        expect([testcase.input, testcase.output, testcase.inputPath.includes('.prob.judger/testcases/stress-'), await fs.readFile(testcase.inputPath, 'utf8'), await fs.readFile(testcase.outputPath, 'utf8')]).toEqual(['', '', true, data, data]);
    });
});

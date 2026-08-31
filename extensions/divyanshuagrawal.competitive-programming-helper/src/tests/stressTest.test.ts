jest.mock(
    'vscode',
    () => ({
        Uri: { file: (fsPath: string) => ({ fsPath }) },
        workspace: {
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
jest.mock('../executions', () => ({
    clearKillRequested: jest.fn(),
    runTestCase: mockRunTestCase,
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
}));

globalThis.logger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
};

import { getStressTempRoot, runStressTest } from '../stressTest';

describe('stress test runner', () => {
    beforeEach(() => {
        jest.clearAllMocks();
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
});

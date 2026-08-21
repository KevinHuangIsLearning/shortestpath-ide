jest.mock(
    'vscode',
    () => ({
        Uri: { file: (fsPath: string) => ({ fsPath }) },
        workspace: { getWorkspaceFolder: jest.fn(() => undefined) },
    }),
    { virtual: true },
);

jest.mock('../compiler', () => ({
    compileFile: jest.fn(async () => true),
    getBinSaveLocation: jest.fn(() => '/tmp/cph-large-sample-bin'),
}));

jest.mock('../executions', () => ({
    deleteBinary: jest.fn(),
    runCustomChecker: jest.fn(),
    runTestCase: jest.fn(),
    wasKillRequested: jest.fn(() => false),
}));

jest.mock('../preferences', () => ({
    getIgnoreSTDERRORPref: jest.fn(() => true),
    getPythonCommand: jest.fn(() => 'python3'),
}));

jest.mock('../utils', () => ({
    getLanguage: jest.fn(() => ({
        name: 'cpp',
        compiler: 'g++',
        args: [],
        skipCompile: false,
    })),
}));

globalThis.logger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
};

import {
    compareLargeSampleOutput,
    scanLargeSampleDirectory,
} from '../largeSampleTest';

describe('large sample test helpers', () => {
    test('pairs numbered inputs and prefers out over ans', async () => {
        const fs = await import('fs/promises');
        const os = await import('os');
        const directory = await fs.mkdtemp(`${os.tmpdir()}/cph-large-sample-`);
        await Promise.all([
            fs.writeFile(`${directory}/data10.in`, '10'),
            fs.writeFile(`${directory}/data10.out`, 'out'),
            fs.writeFile(`${directory}/data10.ans`, 'ans'),
            fs.writeFile(`${directory}/data2.in`, '2'),
            fs.writeFile(`${directory}/data2.ans`, 'ans'),
            fs.writeFile(`${directory}/missing3.in`, '3'),
            fs.writeFile(`${directory}/notes.txt`, 'ignored'),
        ]);

        const result = await scanLargeSampleDirectory(directory);
        expect(result.cases.map((item) => item.name)).toEqual([
            'data2.in',
            'data10.in',
        ]);
        expect(result.cases[0].answerExtension).toBe('ans');
        expect(result.cases[1].answerExtension).toBe('out');
        expect(result.diagnostics).toHaveLength(1);
        await fs.rm(directory, { recursive: true, force: true });
    });

    test('supports whitespace and token comparison rules', () => {
        expect(
            compareLargeSampleOutput('1  2\n\n3  ', '1 2\n3', {
                ignoreTrailingWhitespace: true,
                ignoreBlankLines: true,
                ignoreOuterWhitespace: true,
                tokenCompare: true,
            }),
        ).toBe(true);
        expect(
            compareLargeSampleOutput('1 2', '1 3', {
                ignoreTrailingWhitespace: false,
                ignoreBlankLines: false,
                ignoreOuterWhitespace: false,
                tokenCompare: true,
            }),
        ).toBe(false);
    });
});

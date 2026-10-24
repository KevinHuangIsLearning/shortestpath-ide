jest.mock('vscode', () => ({
    workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback }) },
    window: { showErrorMessage: jest.fn() },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
}), { virtual: true });
jest.mock('../i18n', () => ({ __esModule: true, default: (_: string, value: string) => value }));
jest.mock('../preferences', () => ({ getSaveLocationPref: () => '', getCollectProblemsInRoot: () => false }));

import { applyProblemPatch } from '../problemDocument';
import { buildProblemPatch } from '../webview/frontend/components/ProblemSettings';
import { Problem } from '../types';

type Draft = {
    name: string;
    url: string;
    timeLimit: string;
    memoryLimit: string;
    customCheckerPath: string;
    interactorPath: string;
    compilerCommand: string;
    compilerArgs: string;
    interpreterCommand: string;
    interpreterArgs: string;
};

const draft = (overrides: Partial<Draft> = {}): Draft => ({
    name: 'A',
    url: '',
    timeLimit: '1000',
    memoryLimit: '512',
    customCheckerPath: '',
    interactorPath: '',
    compilerCommand: '',
    compilerArgs: '',
    interpreterCommand: '',
    interpreterArgs: '',
    ...overrides,
});

const stored = (): Problem => ({
    name: 'A',
    srcPath: '/tmp/a.cpp',
    url: '',
    timeLimit: 1000,
    memoryLimit: 512,
    tests: [],
    interactive: false,
    group: '',
    customCheckerPath: '/checker',
    interactorPath: '/interactor',
    compilerCommand: 'g++-15',
    compilerArgs: ['-fsanitize=address', '-g'],
    interpreterCommand: 'python3',
    interpreterArgs: ['-u'],
});

test('cleared overrides travel as empty values and are deleted instead of keeping the old value', () => {
    const { patch, errors } = buildProblemPatch(draft());
    expect(errors).toEqual({});
    // This is what actually happens between the webview and the host: undefined
    // properties are dropped by JSON.stringify, empty ones survive.
    const delivered = JSON.parse(JSON.stringify(patch));
    const merged = applyProblemPatch(stored(), delivered);
    for (const key of ['customCheckerPath', 'interactorPath', 'compilerCommand', 'compilerArgs', 'interpreterCommand', 'interpreterArgs']) {
        expect(merged).not.toHaveProperty(key);
    }
});

test('non-empty values still replace the stored overrides', () => {
    const { patch } = buildProblemPatch(draft({ compilerCommand: ' clang++ ', compilerArgs: '["-O2", "-std=c++17"]' }));
    const merged = applyProblemPatch(stored(), JSON.parse(JSON.stringify(patch)));
    expect(merged.compilerCommand).toBe('clang++');
    expect(merged.compilerArgs).toEqual(['-O2', '-std=c++17']);
    expect(merged.interpreterCommand).toBeUndefined();
    expect(merged.interpreterArgs).toBeUndefined();
});

test('undefined fields from in-process callers clear the same way', () => {
    const merged = applyProblemPatch(stored(), { compilerArgs: undefined, compilerCommand: undefined });
    expect(merged).not.toHaveProperty('compilerArgs');
    expect(merged).not.toHaveProperty('compilerCommand');
    expect(merged.interpreterArgs).toEqual(['-u']);
});

test('invalid argument JSON still reports an error', () => {
    Object.defineProperty(globalThis, 'window', { value: { translations: {} }, configurable: true });
    try {
        const { patch, errors } = buildProblemPatch(draft({ compilerArgs: '-O2' }));
        expect(patch).toBeUndefined();
        expect(errors.compilerArgs).toBe('invalidArgs');
    } finally { delete (globalThis as { window?: unknown }).window; }
});

import {
    createLatestTaskScheduler,
    getInitialJudgeProblem,
    getRefreshSourcePath,
    JudgeDocument,
	shouldClearJudgeForActiveDocument,
} from '../webview/judgeLifecycle';

const source = (fileName: string): JudgeDocument => ({
    fileName,
    uri: { scheme: 'file' },
});

describe('Judge editor lifecycle', () => {
    test('retains the current problem for browser, terminal, and Output tabs', () => {
        const current = { srcPath: '/workspace/A.cpp' };
        const getProblem = jest.fn();

        expect(getInitialJudgeProblem(undefined, current, getProblem)).toBe(current);
        expect(
            getInitialJudgeProblem(
                { fileName: 'Output', uri: { scheme: 'output' } },
                current,
                getProblem,
            ),
        ).toBe(current);
        expect(
            getInitialJudgeProblem(
                { fileName: 'Browser', uri: { scheme: 'vscode-webview' } },
                current,
                getProblem,
            ),
        ).toBe(current);
        expect(getProblem).not.toHaveBeenCalled();
		expect(shouldClearJudgeForActiveDocument(undefined)).toBe(true);
		expect(shouldClearJudgeForActiveDocument({ fileName: 'Output', uri: { scheme: 'output' } })).toBe(true);
		expect(shouldClearJudgeForActiveDocument(source('/workspace/A.cpp'))).toBe(false);
    });

    test('refreshes only when switching to another supported local source', () => {
        expect(
            getRefreshSourcePath(
                source('/workspace/B.cpp'),
                '/workspace/A.cpp',
                '/workspace/A.cpp',
            ),
        ).toBe('/workspace/B.cpp');
        expect(
            getRefreshSourcePath(
                source('/workspace/A.cpp'),
                '/workspace/A.cpp',
                '/workspace/A.cpp',
            ),
        ).toBeUndefined();
        expect(
            getRefreshSourcePath(
                source('/workspace/notes.md'),
                '/workspace/A.cpp',
                '/workspace/A.cpp',
            ),
        ).toBeUndefined();
    });

    test('allows a closed source to load again after its dedupe state clears', () => {
        expect(
            getRefreshSourcePath(
                source('/workspace/A.cpp'),
                undefined,
                undefined,
            ),
        ).toBe('/workspace/A.cpp');
    });

    test('uses the active source problem and clears after deletion', () => {
        const activeProblem = { srcPath: '/workspace/B.cpp' };
        const getProblem = jest.fn(() => activeProblem);

        expect(
            getInitialJudgeProblem(
                source('/workspace/B.cpp'),
                { srcPath: '/workspace/A.cpp' },
                getProblem,
            ),
        ).toBe(activeProblem);
        expect(
            getInitialJudgeProblem(undefined, undefined, getProblem),
        ).toBeUndefined();
    });

    test('runs only the settled tab transition', () => {
        const callbacks: Array<() => void> = [];
        const cancelled = new Set<() => void>();
        const scheduler = createLatestTaskScheduler(
            (task) => {
                callbacks.push(task);
                return task;
            },
            (task) => cancelled.add(task),
        );
        const executed: string[] = [];

        scheduler.schedule(() => executed.push('A'));
        scheduler.schedule(() => executed.push('B'));
        callbacks.forEach((task) => {
            if (!cancelled.has(task)) {
                task();
            }
        });

        expect(executed).toEqual(['B']);
    });
});

import config from '../config';
import path from 'path';

export interface JudgeDocument {
    fileName: string;
    uri: { scheme: string };
}

const isSupportedLocalSource = (
    document: JudgeDocument | undefined,
): document is JudgeDocument => {
    if (document?.uri.scheme !== 'file') {
        return false;
    }
    const extension = path.extname(document.fileName).slice(1).toLowerCase();
    return config.supportedExtensions.includes(extension);
};

/**
 * Returns the source path that should refresh the Judge view, if any.
 * Non-source tabs and repeated activation of the current source are ignored.
 */
export const getRefreshSourcePath = (
    document: JudgeDocument | undefined,
    currentProblemPath: string | undefined,
    lastActiveSourcePath: string | undefined,
): string | undefined => {
    if (!isSupportedLocalSource(document)) {
        return undefined;
    }
    if (
        document.fileName === currentProblemPath ||
        document.fileName === lastActiveSourcePath
    ) {
        return undefined;
    }
    return document.fileName;
};

/**
 * A recreated view must retain the last source problem while a non-source tab
 * (terminal, Output, integrated browser) is active.
 */
export const getInitialJudgeProblem = <
    TDocument extends JudgeDocument,
    TProblem,
>(
    document: TDocument | undefined,
    currentProblem: TProblem | undefined,
    getProblemForDocument: (
        document: TDocument | undefined,
    ) => TProblem | undefined,
): TProblem | undefined =>
    isSupportedLocalSource(document)
        ? getProblemForDocument(document)
        : currentProblem;

export interface LatestTaskScheduler {
    schedule: (task: () => void) => void;
    dispose: () => void;
}

/** Keeps only the last pending task, which avoids acting on transient tabs. */
export const createLatestTaskScheduler = <THandle>(
    scheduleTask: (task: () => void) => THandle,
    cancelTask: (handle: THandle) => void,
): LatestTaskScheduler => {
    let pendingTask: THandle | undefined;

    return {
        schedule: (task) => {
            if (pendingTask !== undefined) {
                cancelTask(pendingTask);
            }
            pendingTask = scheduleTask(() => {
                pendingTask = undefined;
                task();
            });
        },
        dispose: () => {
            if (pendingTask !== undefined) {
                cancelTask(pendingTask);
                pendingTask = undefined;
            }
        },
    };
};

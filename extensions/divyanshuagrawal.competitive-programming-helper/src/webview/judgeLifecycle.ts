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

/** The Judge view is shown only while a supported local source file has focus. */
export const shouldClearJudgeForActiveDocument = (
	document: JudgeDocument | undefined,
): boolean => !isSupportedLocalSource(document);

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

/** A recreated view only shows a problem for the currently focused source file. */
export const getInitialJudgeProblem = <
    TDocument extends JudgeDocument,
    TProblem,
>(
    document: TDocument | undefined,
    currentProblem: TProblem | undefined,
    getProblemForDocument: (
        document: TDocument | undefined,
    ) => TProblem | undefined,
): TProblem | undefined => {
	void currentProblem;
	return isSupportedLocalSource(document)
		? getProblemForDocument(document)
		: undefined;
};

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

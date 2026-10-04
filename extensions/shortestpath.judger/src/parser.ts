import { initializeProblemTimer } from './problemTimer';
import fs from 'fs';
import path from 'path';
import { readStoredProblem, writeStoredProblem, removeStoredProblem } from './problemStorage';
import { Problem } from './types';
import { getSaveLocationPref, getCollectProblemsInRoot } from './preferences';
import crypto from 'crypto';
import * as vscode from 'vscode';

/**
 *  Get the location (file path) to save the generated problem file in. If save
 *  location is available in preferences, returns that, otherwise returns the
 *  director of active file. The extension is `.prob`.
 *
 *  @param srcPath location of the source code
 */
export const getProbSaveLocation = (srcPath: string, legacy = false): string => {
    const savePreference = getSaveLocationPref();
    const srcFileName = path.basename(srcPath);
    const workspaceRoot = legacy ? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath : getSourceWorkspaceRoot(srcPath);
    const storageKey = legacy || !workspaceRoot ? srcPath : path.relative(workspaceRoot, srcPath);
    const hash = crypto
        .createHash('md5')
        .update(storageKey)
        .digest('hex')
        .substr(0);
    const baseProbName = `.${srcFileName}_${hash}.prob`;
    if (savePreference && savePreference !== '') {
        return path.join(savePreference, baseProbName);
    }
    if (!legacy) {
        const rootPath = workspaceRoot ?? path.dirname(srcPath);
        return path.join(rootPath, '.shortestpath', baseProbName);
    }
    if (getCollectProblemsInRoot()) {
        const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (rootPath) {
            return path.join(rootPath, '.cph', baseProbName);
        }
    }
    const srcFolder = path.dirname(srcPath);
    const cphFolder = path.join(srcFolder, '.cph');
    return path.join(cphFolder, baseProbName);
};

/** Use the deepest owning folder in a multi-root workspace. */
function getSourceWorkspaceRoot(srcPath: string): string | undefined {
    return vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath)
        .filter(root => {
            const relative = path.relative(root, srcPath);
            return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
        }).sort((left, right) => right.length - left.length)[0];
}

/** Recover storage created before the workspace was opened or under the first workspace root. */
function previousProblemLocations(srcPath: string): string[] {
    const firstRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const preference = getSaveLocationPref();
    const previousKeys = [srcPath, ...(firstRoot ? [path.relative(firstRoot, srcPath)] : [])];
    const locations = previousKeys.flatMap(key => {
        const hash = crypto.createHash('md5').update(key).digest('hex');
        const name = `.${path.basename(srcPath)}_${hash}.prob`;
        if (preference) { return [path.join(preference, name)]; }
        return [path.join(path.dirname(srcPath), '.shortestpath', name), ...(firstRoot ? [path.join(firstRoot, '.shortestpath', name)] : [])];
    });
    return [...new Set([getProbSaveLocation(srcPath, true), ...locations])];
}

/** Copy managed legacy data into this problem, retaining the old files as migration backups. */
function migrateManagedTestcases(problem: Problem, current: string, legacy: string): Problem {
    const directory = `${current}.judger`;
    const shared = path.dirname(current);
    const owns = (root: string, file: string): boolean => {
        const relative = path.relative(root, file);
        return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
    };
    let changed = false;
    const tests = problem.tests.map(test => {
        const next = { ...test };
        for (const field of ['inputPath', 'outputPath'] as const) {
            const file = next[field];
            if (!file || owns(directory, file) || !fs.existsSync(file)) { continue; }
            const sharedFolder = path.relative(shared, file).split(path.sep)[0];
            const managed = owns(`${legacy}.judger`, file)
                || owns(shared, file) && !sharedFolder.endsWith('.prob.judger') && path.dirname(file) !== shared;
            if (!managed) { continue; }
            const key = crypto.createHash('sha256').update(file).digest('hex').slice(0, 16);
            const target = path.join(directory, 'testcases', 'migrated', `${key}-${path.basename(file)}`);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            if (!fs.existsSync(target)) { fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL); }
            next[field] = target;
            changed = true;
        }
        return next;
    });
    return changed ? { ...problem, tests } : problem;
}

/** Read both the original single-file format and the versioned Judger format. */
export const getProblem = (srcPath: string): Problem | null => {
    const current = getProbSaveLocation(srcPath);
    const stored = readStoredProblem(current);
    const existing = stored && migrateManagedTestcases(initializeProblemTimer(stored), current, getProbSaveLocation(srcPath, true));
    if (existing && existing !== stored) { writeStoredProblem(current, existing); }
    if (existing) {
        // Also upgrade a legacy single-file problem at a custom save location.
        if (!fs.existsSync(`${current}.judger/problem.json`)) {
            writeStoredProblem(current, existing);
            return readStoredProblem(current);
        }
        if (existing.srcPath !== srcPath) {
            const rebase = (file: string | undefined) => {
                if (!file || !existing.srcPath) { return file; }
                const moved = path.resolve(path.dirname(srcPath), path.relative(path.dirname(existing.srcPath), file));
                return fs.existsSync(moved) ? moved : file;
            };
            existing.tests = existing.tests.map(test => ({ ...test, inputPath: rebase(test.inputPath), outputPath: rebase(test.outputPath) }));
            existing.customCheckerPath = rebase(existing.customCheckerPath);
            existing.interactorPath = rebase(existing.interactorPath);
            existing.srcPath = srcPath;
            writeStoredProblem(current, existing);
        }
        return existing;
    }
    for (const legacy of previousProblemLocations(srcPath)) {
        if (legacy === current) { continue; }
        const problem = readStoredProblem(legacy);
        if (!problem) { continue; }
        writeStoredProblem(current, migrateManagedTestcases(initializeProblemTimer(problem), current, legacy));
        return readStoredProblem(current);
    }
    return null;
};

export const removeProblem = (srcPath: string): void => {
    removeStoredProblem(getProbSaveLocation(srcPath));
    for (const location of previousProblemLocations(srcPath)) { removeStoredProblem(location); }
};

export const getProblemDirectory = (srcPath: string): string => `${getProbSaveLocation(srcPath)}.judger`;

export const saveProblem = (srcPath: string, problem: Problem, preserveRevision = false, updateCompletion = false): void => {
    const location = getProbSaveLocation(srcPath);
    const current = readStoredProblem(location);
    // A delayed webview save must not undo AC or restart a persisted timer.
    const initialized = initializeProblemTimer({ ...problem,
        storageRevision: preserveRevision ? current?.storageRevision : crypto.randomUUID(),
        timeStartedAtUnixMs: updateCompletion ? problem.timeStartedAtUnixMs : current?.timeStartedAtUnixMs ?? problem.timeStartedAtUnixMs,
        timeAcceptedAtUnixMs: updateCompletion ? problem.timeAcceptedAtUnixMs : current ? current.timeAcceptedAtUnixMs : problem.timeAcceptedAtUnixMs,
        timePartialAcceptedAtUnixMs: updateCompletion ? problem.timePartialAcceptedAtUnixMs : current ? current.timePartialAcceptedAtUnixMs : problem.timePartialAcceptedAtUnixMs,
    });
    Object.assign(problem, { storageRevision: initialized.storageRevision, timeStartedAtUnixMs: initialized.timeStartedAtUnixMs, timeAcceptedAtUnixMs: initialized.timeAcceptedAtUnixMs, timePartialAcceptedAtUnixMs: initialized.timePartialAcceptedAtUnixMs });
    writeStoredProblem(location, initialized);
};

/** Reject autosaves queued before a host-side mutation. Ordinary autosaves retain the token. */
export const saveProblemFromWebview = (problem: Problem): boolean => {
    const current = readStoredProblem(getProbSaveLocation(problem.srcPath));
    if (!current || current.storageRevision !== problem.storageRevision) { return false; }
    saveProblem(problem.srcPath, problem, true);
    return true;
};

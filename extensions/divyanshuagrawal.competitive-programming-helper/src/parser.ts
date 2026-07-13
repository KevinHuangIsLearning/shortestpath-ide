import path from 'path';
import fs from 'fs';
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
export const getProbSaveLocation = (srcPath: string): string => {
    const savePreference = getSaveLocationPref();
    const srcFileName = path.basename(srcPath);
    const hash = crypto
        .createHash('md5')
        .update(srcPath)
        .digest('hex')
        .substr(0);
    const baseProbName = `.${srcFileName}_${hash}.prob`;
    if (savePreference && savePreference !== '') {
        return path.join(savePreference, baseProbName);
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

/** Get the problem for a source, `null` if does not exist on the filesystem. */
export const getProblem = (srcPath: string): Problem | null => {
    const probPath = getProbSaveLocation(srcPath);
    let problem: string;
    try {
        problem = fs.readFileSync(probPath).toString();
        return JSON.parse(problem);
    } catch (err) {
        return null;
    }
};

/** Save the problem (metadata) */
export const saveProblem = (srcPath: string, problem: Problem) => {
    const probPath = getProbSaveLocation(srcPath);
    const probDir = path.dirname(probPath);

    if (!fs.existsSync(probDir)) {
        globalThis.logger.log('Making .cph folder');
        fs.mkdirSync(probDir, { recursive: true });
    }

    try {
        fs.writeFileSync(probPath, JSON.stringify(problem));
    } catch (err) {
        throw new Error(err as string);
    }
};

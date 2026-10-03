import path from 'path';
import * as vscode from 'vscode';

import config from './config';
import { removeProblem, getProblem } from './parser';
import {
    getCArgsPref,
    getCppArgsPref,
    getPythonArgsPref,
    getRubyArgsPref,
    getRustArgsPref,
    getJavaArgsPref,
    getJsArgsPref,
    getGoArgsPref,
    getHaskellArgsPref,
    getCSharpArgsPref,
    getCangejieArgsPref,
    getCCommand,
    getCppCommand,
    getPythonCommand,
    getRubyCommand,
    getRustCommand,
    getJavaCommand,
    getJsCommand,
    getGoCommand,
    getHaskellCommand,
    getCSharpCommand,
    getCangjieCommand,
} from './preferences';
import { Language, Problem } from './types';
import telmetry from './telmetry';
import localize from './i18n';

const oc = vscode.window.createOutputChannel('cph');

/**
 * Get language based on file extension
 */
export const getLanguage = (srcPath: string): Language => {
    const extension = path.extname(srcPath).toLowerCase().replace('.', '');
    let langName: string | void = undefined;
    for (const [lang, ext] of Object.entries(config.extensions)) {
        if (ext === extension) {
            langName = lang;
        }
    }

    if (
        langName === undefined &&
        (config.extensions as any)[extension] !== undefined
    ) {
        langName = extension;
    }

    if (langName === undefined) {
        throw new Error('Invalid extension');
    }

    const configurationLanguage = ['cc', 'cxx'].includes(langName) ? 'cpp' : langName === 'hs' ? 'haskell' : langName;
    const languageId = configurationLanguage === 'js' ? 'javascript' : configurationLanguage;
    const scoped = vscode.workspace.getConfiguration(`judger.language.${configurationLanguage}`, { uri: vscode.Uri.file(srcPath), languageId });
    const configuredArgs = scoped.get<string>('Args');
    const configuredCommand = scoped.get<string>('Command');
    switch (langName) {
        case 'cpp':
        case 'cc':
        case 'cxx': {
            return {
                name: langName,
                args: configuredArgs === undefined ? [...getCppArgsPref()] : configuredArgs.split(' ').filter(Boolean),
                compiler: configuredCommand ?? getCppCommand(),
                skipCompile: false,
            };
        }
        case 'c': {
            return {
                name: langName,
                args: configuredArgs === undefined ? [...getCArgsPref()] : configuredArgs.split(' ').filter(Boolean),
                compiler: configuredCommand ?? getCCommand(),
                skipCompile: false,
            };
        }
        case 'python': {
            return {
                name: langName,
                args: configuredArgs === undefined ? [...getPythonArgsPref()] : configuredArgs.split(' ').filter(Boolean),
                compiler: configuredCommand ?? getPythonCommand(),
                skipCompile: true,
            };
        }
        case 'ruby': {
            return {
                name: langName,
                args: configuredArgs === undefined ? [...getRubyArgsPref()] : configuredArgs.split(' ').filter(Boolean),
                compiler: configuredCommand ?? getRubyCommand(),
                skipCompile: true,
            };
        }
        case 'rust': {
            return {
                name: langName,
                args: configuredArgs === undefined ? [...getRustArgsPref()] : configuredArgs.split(' ').filter(Boolean),
                compiler: configuredCommand ?? getRustCommand(),
                skipCompile: false,
            };
        }
        case 'java': {
            return {
                name: langName,
                args: configuredArgs === undefined ? [...getJavaArgsPref()] : configuredArgs.split(' ').filter(Boolean),
                compiler: configuredCommand ?? getJavaCommand(),
                skipCompile: false,
            };
        }
        case 'js': {
            return {
                name: langName,
                args: configuredArgs === undefined ? [...getJsArgsPref()] : configuredArgs.split(' ').filter(Boolean),
                compiler: configuredCommand ?? getJsCommand(),
                skipCompile: true,
            };
        }
        case 'go': {
            return {
                name: langName,
                args: configuredArgs === undefined ? [...getGoArgsPref()] : configuredArgs.split(' ').filter(Boolean),
                compiler: configuredCommand ?? getGoCommand(),
                skipCompile: false,
            };
        }
        case 'hs': {
            return {
                name: langName,
                args: configuredArgs === undefined ? [...getHaskellArgsPref()] : configuredArgs.split(' ').filter(Boolean),
                compiler: configuredCommand ?? getHaskellCommand(),
                skipCompile: false,
            };
        }
        case 'csharp': {
            return {
                name: langName,
                args: configuredArgs === undefined ? [...getCSharpArgsPref()] : configuredArgs.split(' ').filter(Boolean),
                compiler: configuredCommand ?? getCSharpCommand(),
                skipCompile: false,
            };
        }
        case 'cangjie': {
            return {
                name: langName,
                args: configuredArgs === undefined ? [...getCangejieArgsPref()] : configuredArgs.split(' ').filter(Boolean),
                compiler: configuredCommand ?? getCangjieCommand(),
                skipCompile: false,
            };
        }
    }
    throw new Error('Invalid State');
};

export const isValidLanguage = (srcPath: string): boolean => {
    const ext = path.extname(srcPath).toLowerCase().replace('.', '');
    return config.supportedExtensions.includes(ext);
};

export const isCodeforcesUrl = (url: URL): boolean => {
    return url.hostname.endsWith('codeforces.com');
};
export const isLuoguUrl = (url: URL): boolean => {
    return url.hostname.indexOf('luogu.com.cn') !== -1;
};
export const isAtCoderUrl = (url: URL): boolean => {
    return url.hostname === 'atcoder.jp';
};

export const ocAppend = (string: string) => {
    oc.append(string);
};

export const ocWrite = (string: string) => {
    oc.clear();
    oc.append(string);
};

export const ocShow = (preserveFocus = false) => {
    oc.show(preserveFocus);
};

export const ocHide = () => {
    oc.clear();
    oc.hide();
};

export const randomId = (index: number | null) => {
    if (index !== null) {
        return Math.floor(Date.now() + index);
    } else {
        return Math.floor(Date.now() + Math.random() * 100);
    }
};

/**
 * Check if file is supported. If not, shows an error dialog. Returns true if
 * unsupported.
 */
export const checkUnsupported = (srcPath: string): boolean => {
    if (srcPath === '') {
        vscode.window.showErrorMessage(
            localize('judger.utils.noActiveEditor', 'No active editor found.'),
        );
        return true;
    }
    if (!isValidLanguage(srcPath)) {
        vscode.window.showErrorMessage(
            localize(
                'judger.utils.unsupported',
                'Unsupported file extension. Only these types are valid: {0}',
                config.supportedExtensions.join(', '),
            ),
        );
        return true;
    }
    return false;
};

/** Remove both current data and the legacy backup on an explicit delete. */
export const deleteProblemFile = async (srcPath: string) => {
    globalThis.reporter.sendTelemetryEvent(telmetry.DELETE_ALL_TESTCASES);
    removeProblem(srcPath);
};

export const getProblemForDocument = (
    document: vscode.TextDocument | undefined,
): Problem | undefined => {
    if (document === undefined) {
        return undefined;
    }

    return getProblem(document.fileName) ?? undefined;
};

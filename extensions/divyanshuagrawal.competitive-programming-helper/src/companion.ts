import http from 'http';
import config from './config';
import { Problem, CphSubmitResponse, CphEmptyResponse } from './types';
import { getProblem, saveProblem } from './parser';
import { appendShortestPathTestCase } from './shortestpathOj';
import * as vscode from 'vscode';
import path from 'path';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { isCodeforcesUrl, isLuoguUrl, isAtCoderUrl, randomId } from './utils';
import {
    getDefaultLangPref,
    getLanguageId,
    useShortCodeForcesName,
    useShortLuoguName,
    useShortAtCoderName,
    getMenuChoices,
    getDefaultLanguageTemplateFileLocation,
    includeProblemIndex,
    wordRegex,
    doTemplateFileVariableReplacement,
    getFileNameTemplate,
    getFileNameTemplateOverrides,
    getOjMapping,
    getDefaultProblemSource,
    getVjudgeOjNames,
    getVjudgeOpenInBrowser,
    getVjudgeUrlSuffix,
    getVjudgeBrowserSplitRatio,
} from './preferences';
import {
    appendVjudgeUrlSuffix,
    getProblemDisplayTarget,
    getProblemSourceForUrl,
    restoreOriginalProblemUrl,
    type ProblemSource,
} from './problemDisplay';
import { getProblemName } from './submit';
import { spawn } from 'child_process';
import { getJudgeViewProvider } from './extension';
import {
    words_in_text,
    toPascalCase,
    replaceFileNamePlaceholders,
    sanitizeFileName,
} from './utilsPure';
import telmetry from './telmetry';
import os from 'os';
import localize from './i18n';

const emptyResponse: CphEmptyResponse = { empty: true };
let savedResponse: CphEmptyResponse | CphSubmitResponse = emptyResponse;
const COMPANION_LOGGING = false;

export const submitKattisProblem = (problem: Problem) => {
    globalThis.reporter.sendTelemetryEvent(telmetry.SUBMIT_TO_KATTIS);
    const srcPath = problem.srcPath;
    const homedir = os.homedir();
    const directoryChar = process.platform == 'win32' ? '\\' : '/';
    const submitPath = `${homedir}${directoryChar}.kattis${directoryChar}submit.py`;

    if (
        !existsSync(
            `${homedir}${directoryChar}.kattis${directoryChar}.kattisrc`,
        ) ||
        !existsSync(
            `${homedir}${directoryChar}.kattis${directoryChar}submit.py`,
        )
    ) {
        vscode.window.showErrorMessage(
            localize(
                'cph.companion.kattisError',
                'Please ensure .kattisrc and submit.py are present in {0}',
                `${homedir}${directoryChar}.kattis${directoryChar}`,
            ),
        );
        return;
    }

    const pyshell = spawn('python', [submitPath, '-f', srcPath]);

    //tells the python script to open submission window in new tab
    pyshell.stdin.setDefaultEncoding('utf-8');
    pyshell.stdin.write('Y\n');
    pyshell.stdin.end();

    pyshell.stdout.on('data', function (data) {
        globalThis.logger.log(data.toString());
        getJudgeViewProvider().extensionToJudgeViewMessage({
            command: 'new-problem',
            problem,
        });
        ({ command: 'submit-finished' });
    });
    pyshell.stderr.on('data', function (data) {
        globalThis.logger.log(data.tostring());
        vscode.window.showErrorMessage(data);
    });
};

/** Stores a response to be submitted to CF page soon. */
export const storeSubmitProblem = (problem: Problem) => {
    const srcPath = problem.srcPath;
    const problemName = getProblemName(problem.url);
    const sourceCode = readFileSync(srcPath).toString();
    const languageId = getLanguageId(problem.srcPath);
    savedResponse = {
        empty: false,
        url: problem.url,
        problemName,
        sourceCode,
        languageId,
    };
    globalThis.reporter.sendTelemetryEvent(telmetry.SUBMIT_TO_CODEFORCES);
    globalThis.logger.log('Stored savedResponse', savedResponse);
};

type ProblemCreationResult = { created: boolean; sourcePath?: string };

export const setupCompanionServer = () => {
    try {
        const server = http.createServer((req, res) => {
            const { headers } = req;
            const waitForProblemCreation = headers['x-shortestpath-oj'] === 'true';
            const addShortestPathTest = headers['x-shortestpath-oj-add-test'] === 'true';
            const preferredSourcePath = typeof headers['x-shortestpath-source-path'] === 'string' ? headers['x-shortestpath-source-path'] : undefined;

            if (headers['cph-submit'] == 'true') {
                res.write(JSON.stringify(savedResponse));
                COMPANION_LOGGING &&
                    globalThis.logger.log(
                        'Request was from the cph-submit extension; sending savedResponse and clearing it',
                        savedResponse,
                    );

                if (savedResponse.empty != true) {
                    getJudgeViewProvider().extensionToJudgeViewMessage({
                        command: 'submit-finished',
                    });
                }
                savedResponse = emptyResponse;
                res.end();
                return;
            }

            let rawProblem = '';

            req.on('data', (chunk) => {
                COMPANION_LOGGING &&
                    globalThis.logger.log('Companion server got data');
                rawProblem += chunk;
            });
            req.on('end', async () => {
                try {
                    if (rawProblem === '') {
                        res.statusCode = 400;
                        res.end();
                        return;
                    }
                    if (addShortestPathTest) {
                        const result = appendShortestPathTest(preferredSourcePath, JSON.parse(rawProblem));
                        res.statusCode = result.added === undefined ? 422 : 200;
                        res.setHeader('Content-Type', 'application/json; charset=utf-8');
                        res.end(JSON.stringify(result));
                        return;
                    }
                    const problem: Problem = JSON.parse(rawProblem);
                    if (!waitForProblemCreation) {
                        void handleNewProblem(problem);
                        res.write(JSON.stringify(savedResponse));
                        res.end();
                        return;
                    }
                    const result = await handleNewProblem(problem, preferredSourcePath);
                    res.statusCode = result.created ? 200 : 422;
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(result));
                    COMPANION_LOGGING &&
                        globalThis.logger.log(
                            'Companion server processed a problem request.',
                        );
                } catch (e) {
                    vscode.window.showErrorMessage(
                        localize(
                            'cph.companion.parseError',
                            'Error parsing problem from companion {0}. Raw problem: {1}',
                            String(e),
                            rawProblem,
                        ),
                    );
                    res.statusCode = 500;
                    res.end();
                }
            });
        });
        server.listen(config.port, '127.0.0.1');
        server.on('error', (err) => {
            vscode.window.showErrorMessage(
                localize(
                    'cph.companion.serverError',
                    'Are multiple VSCode windows open? CPH will work on the first opened window. CPH server encountered an error: {0}, companion may not work.',
                    err.message,
                ),
            );
        });
        globalThis.logger.log(
            'Companion server listening on port',
            config.port,
        );
        return server;
    } catch (e) {
        globalThis.logger.error('Companion server error :', e);
    }
};

function appendShortestPathTest(preferredSourcePath: string | undefined, value: unknown): { added?: boolean; message?: string } {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const sourcePath = folder ? getPreferredSourcePath(folder, preferredSourcePath) : undefined;
    if (!sourcePath) {
        return { message: '请先打开包含 CPH 题目的工作区。' };
    }
    if (typeof value !== 'object' || value === null) {
        return { message: '反例格式无效。' };
    }
    const { input, output } = value as { input?: unknown; output?: unknown };
    if (typeof input !== 'string' || typeof output !== 'string') {
        return { message: '反例输入或输出无效。' };
    }
    const problem = getProblem(sourcePath);
    if (!problem) {
        return { message: '未找到该文件对应的 CPH 题目。' };
    }
    const added = appendShortestPathTestCase(problem, input, output, randomId(problem.tests.length));
    if (added) {
        saveProblem(sourcePath, problem);
        getJudgeViewProvider().extensionToJudgeViewMessage({ command: 'new-problem', problem });
    }
    return { added };
}

interface OjInfo {
    oj: string;
    ojName: string;
    contestId: string;
    problemId: string;
    problemSource?: ProblemSource;
}

/** Detect OJ metadata from a problem URL. All detection is driven by cph.general.ojMapping configuration. */
const detectOj = (urlStr: string): OjInfo => {
    const result: OjInfo = { oj: '', ojName: '', contestId: '', problemId: '' };
    try {
        const url = new URL(urlStr);
        const hostname = url.hostname;

        const mapping = getOjMapping();
        if (!mapping) return result;

        for (const [pattern, entry] of Object.entries(mapping)) {
            if (!entry) continue;
            if (!hostname.includes(pattern) && !pattern.includes(hostname))
                continue;
            result.oj = entry.oj || '';
            result.ojName = entry.ojName || '';
            result.problemSource =
                entry.problemSource === 'original' ||
                entry.problemSource === 'vjudge' ||
                entry.problemSource === 'none'
                    ? entry.problemSource
                    : undefined;
            if (result.oj === 'ShortestPath') {
                result.problemSource = 'none';
            }
            if (entry.contestIdRegex) {
                const m = urlStr.match(entry.contestIdRegex);
                if (m) result.contestId = m[1];
            }
            if (entry.problemIdRegex) {
                const m = urlStr.match(entry.problemIdRegex);
                if (m) result.problemId = m[1];
            }
            return result;
        }
    } catch (err) {
        globalThis.logger.error('Failed to detect OJ metadata:', err);
    }
    return result;
};

export const getProblemFileName = (problem: Problem, ext: string) => {
    const originalName = problem.name;
    const originalSections = originalName.split(' - ');
    const problemIndex =
        originalSections.length > 1 ? originalSections[0].trim() : '';

    if (!includeProblemIndex()) {
        const sections = problem.name.split(' - ');
        if (sections.length > 1) {
            problem.name = sections.splice(1).join();
        }
    }

    const globalTemplate = getFileNameTemplate();
    const templateOverrides = getFileNameTemplateOverrides();
    let fileNameTemplate: string | null = null;
    const ojInfo = detectOj(problem.url);
    globalThis.logger.log('Detected OJ:', ojInfo);
    if (templateOverrides && ojInfo.oj) {
        fileNameTemplate = templateOverrides[ojInfo.oj] || null;
        globalThis.logger.log(
            'Override found:',
            ojInfo.oj,
            '→',
            fileNameTemplate,
        );
    }
    if (!fileNameTemplate) {
        fileNameTemplate = globalTemplate;
        globalThis.logger.log('Fallback to global template:', fileNameTemplate);
    }
    if (fileNameTemplate) {
        const words = words_in_text(problem.name, wordRegex());
        let slug: string;
        if (words === null) {
            slug = problem.name.replace(/\W+/g, '_');
        } else {
            slug = words.join('_');
        }

        if (ext === 'java') {
            slug = toPascalCase(slug);
        }

        const { oj, ojName, contestId, problemId } = ojInfo;

        let lang = ext;
        for (const [languageName, languageExt] of Object.entries(
            config.extensions,
        )) {
            if (languageExt === ext) {
                lang = languageName;
                break;
            }
        }

        const filename = replaceFileNamePlaceholders(fileNameTemplate, {
            name: problem.name,
            index: problemIndex,
            slug,
            group: problem.group,
            url: problem.url,
            ext,
            lang,
            contestId,
            problemId,
            oj,
            ojName,
        });
        return sanitizeFileName(filename);
    }

    if (isCodeforcesUrl(new URL(problem.url)) && useShortCodeForcesName()) {
        return `${getProblemName(problem.url)}.${ext}`;
    } else if (isLuoguUrl(new URL(problem.url)) && useShortLuoguName()) {
        // Url is like https://www.luogu.com.cn/problem/P1000
        const pattern = /problem\/(\w+)/;
        const match = problem.url.match(pattern);
        return `${match?.[1] ?? ''}.${ext}`;
    } else if (isAtCoderUrl(new URL(problem.url)) && useShortAtCoderName()) {
        // Url is like https://atcoder.jp/contests/abc311/tasks/abc311_a
        const pattern = /tasks\/(\w+)_(\w+)/;
        const match = problem.url.match(pattern);
        return `${match?.[1] ?? ''}${match?.[2] ?? ''}.${ext}`;
    } else {
        globalThis.logger.log(
            isCodeforcesUrl(new URL(problem.url)),
            useShortCodeForcesName(),
        );

        const words = words_in_text(problem.name, wordRegex());
        let baseName: string;
        if (words === null) {
            baseName = problem.name.replace(/\W+/g, '_');
        } else {
            baseName = words.join('_');
        }

        // For Java, use PascalCase without underscores
        if (ext === 'java') {
            baseName = toPascalCase(baseName);
        }

        return `${baseName}.${ext}`;
    }
};

/** Handle the `problem` sent by Competitive Companion, such as showing the webview, opening an editor, managing layout etc. */
const handleNewProblem = async (problem: Problem, preferredSourcePath?: string): Promise<ProblemCreationResult> => {
    globalThis.reporter.sendTelemetryEvent(telmetry.GET_PROBLEM_FROM_COMPANION);
    // If webview may be focused, close it, to prevent layout bug.
    if (vscode.window.activeTextEditor == undefined) {
        getJudgeViewProvider().extensionToJudgeViewMessage({
            command: 'new-problem',
            problem: undefined,
        });
    }
    const folder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (folder === undefined) {
        vscode.window.showInformationMessage(
            localize('cph.companion.openFolder', 'Please open a folder first.'),
        );
        return { created: false };
    }
    const defaultLanguage = getDefaultLangPref();
    let extn: string;

    if (defaultLanguage == null) {
        const allChoices = new Set(Object.keys(config.extensions));
        const userChoices = getMenuChoices();
        const choices = userChoices.filter((x) => allChoices.has(x));
        const selected = await vscode.window.showQuickPick(choices);
        if (!selected) {
            vscode.window.showInformationMessage(
                localize(
                    'cph.companion.aborted',
                    'Aborted creation of new file',
                ),
            );
            return { created: false };
        }
        // @ts-ignore
        extn = config.extensions[selected];
    } else {
        //@ts-ignore
        extn = config.extensions[defaultLanguage];
    }
    let url: URL;
    try {
        url = new URL(problem.url);
    } catch (err) {
        globalThis.logger.error(err);
        return { created: false };
    }
    if (url.hostname == 'open.kattis.com') {
        const splitUrl = problem.url.split('/');
        problem.name = splitUrl[splitUrl.length - 1];
    }
    const receivedProblemUrl = problem.url;

    problem.url = restoreOriginalProblemUrl(problem.url, getVjudgeOjNames());

    // Determine the VJudge URL to open. For a VJudge import retain the exact
    // received URL; otherwise derive it from the restored original OJ URL.
    let vjudgeUrlToOpen: string | undefined;
    if (getVjudgeOpenInBrowser()) {
        try {
            const urlObj = new URL(receivedProblemUrl);
            if (urlObj.hostname.endsWith('vjudge.net')) {
                vjudgeUrlToOpen = receivedProblemUrl;
            } else {
                const ojInfo = detectOj(problem.url);
                if (ojInfo.oj && ojInfo.problemId) {
                    const vjudgeMapping = getVjudgeOjNames();
                    if (vjudgeMapping) {
                        const [matchKey, matchEntry] =
                            Object.entries(vjudgeMapping).find(
                                ([k]) =>
                                    k.toLowerCase() ===
                                        ojInfo.oj.toLowerCase() ||
                                    k.toLowerCase() ===
                                        ojInfo.ojName.toLowerCase(),
                            ) || [];
                        if (matchKey && matchEntry) {
                            const vjKey = matchEntry.vjudgeUrlKey || matchKey;
                            const fmt =
                                matchEntry.compositeFormat ||
                                '{contestId}{problemId}';
                            const compositeId = replaceFileNamePlaceholders(
                                fmt,
                                {
                                    contestId: ojInfo.contestId || '',
                                    problemId: ojInfo.problemId,
                                },
                            );
                            vjudgeUrlToOpen = `https://vjudge.net/problem/${vjKey}-${compositeId}`;
                        }
                    }
                }
            }
        } catch (err) {
            globalThis.logger.error('Failed to create VJudge URL:', err);
        }
    }

    const originalOj = detectOj(problem.url);
    const displayTarget = getProblemDisplayTarget(
        getVjudgeOpenInBrowser(),
        getProblemSourceForUrl(
            problem.url,
            getOjMapping(),
            originalOj.problemSource ?? getDefaultProblemSource(),
        ),
        problem.url,
        vjudgeUrlToOpen,
    );
    if (displayTarget) {
        const suffix =
            displayTarget.source === 'vjudge' ? getVjudgeUrlSuffix() : '';
        const targetUrl = appendVjudgeUrlSuffix(displayTarget.url, suffix);
        const ratio = getVjudgeBrowserSplitRatio();
        const left = ratio / 100;
        const right = (100 - ratio) / 100;
        await vscode.commands.executeCommand('vscode.setEditorLayout', {
            orientation: 0,
            groups: [{ size: left }, { size: right }],
        });
        await vscode.commands.executeCommand(
            'workbench.action.focusSecondEditorGroup',
        );
        await vscode.commands.executeCommand(
            'workbench.action.browser.open',
            targetUrl,
        );
        await vscode.commands.executeCommand(
            'workbench.action.focusFirstEditorGroup',
        );
    }

    const problemFileName = getProblemFileName(problem, extn);
    const srcPath = getPreferredSourcePath(folder, preferredSourcePath) ?? path.join(folder, problemFileName);

    // Add fields absent in competitive companion.
    problem.srcPath = srcPath;
    problem.tests = problem.tests.map((testcase, index) => ({
        ...testcase,
        // Pass in index to avoid generating duplicate id
        id: randomId(index),
    }));

    if (!existsSync(srcPath)) {
        mkdirSync(path.dirname(srcPath), { recursive: true });
        writeFileSync(srcPath, '');

        if (defaultLanguage) {
            const templateLocation = getDefaultLanguageTemplateFileLocation();
            if (templateLocation !== null) {
                const templateExists = existsSync(templateLocation);
                if (!templateExists) {
                    vscode.window.showErrorMessage(
                        localize(
                            'cph.companion.templateMissing',
                            'Template file does not exist: {0}',
                            templateLocation,
                        ),
                    );
                } else {
                    let templateContents =
                        readFileSync(templateLocation).toString();

                    if (extn == 'java') {
                        const className = path.basename(
                            problemFileName,
                            '.java',
                        );
                        templateContents = templateContents.replace(
                            'CLASS_NAME',
                            className,
                        );
                    }
                    if (doTemplateFileVariableReplacement()) {
                        const now = new Date();
                        const pad2 = (value: number) =>
                            value.toString().padStart(2, '0');
                        const date = `${now.getFullYear()}-${pad2(
                            now.getMonth() + 1,
                        )}-${pad2(now.getDate())}`;
                        const time = `${pad2(now.getHours())}:${pad2(
                            now.getMinutes(),
                        )}:${pad2(now.getSeconds())}`;
                        const templateVariables: Record<string, unknown> = {
                            ...problem,
                            date,
                            time,
                        };

                        for (const [key, value] of Object.entries(
                            templateVariables,
                        )) {
                            let replaceWith = JSON.stringify(value);
                            replaceWith = replaceWith.substring(
                                1,
                                replaceWith.length - 1,
                            );
                            templateContents = templateContents.replace(
                                `$${key}$`,
                                replaceWith,
                            );
                        }
                    }
                    writeFileSync(srcPath, templateContents);
                }
            }
        }
    }

    saveProblem(srcPath, problem);
    const doc = await vscode.workspace.openTextDocument(srcPath);

    const editor = await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.One,
        preview: false,
    });

    // Move cursor to the first occurrence of $CURSOR_PLACEHOLDER and remove it
    const cursorPlaceholder = '$CURSOR_PLACEHOLDER';
    const text = doc.getText();
    const index = text.indexOf(cursorPlaceholder);
    if (index !== -1) {
        const start = doc.positionAt(index);
        const end = doc.positionAt(index + cursorPlaceholder.length);
        await editor.edit((editBuilder) => {
            editBuilder.delete(new vscode.Range(start, end));
        });
        // Set selection and reveal AFTER the edit so it isn't reset
        editor.selection = new vscode.Selection(start, start);
        editor.revealRange(
            new vscode.Range(start, start),
            vscode.TextEditorRevealType.InCenter,
        );
    }

    getJudgeViewProvider().extensionToJudgeViewMessage({
        command: 'new-problem',
        problem,
    });
    void vscode.commands.executeCommand(
        'shortestpath.oj.showProblemForCph',
        problem.url,
    );
    return { created: true, sourcePath: srcPath };
};

function getPreferredSourcePath(
    workspaceFolder: string,
    preferredSourcePath: string | undefined,
): string | undefined {
    if (!preferredSourcePath) {
        return undefined;
    }
    const sourcePath = path.resolve(preferredSourcePath);
    const relativePath = path.relative(workspaceFolder, sourcePath);
    if (
        !relativePath ||
        relativePath.startsWith('..') ||
        path.isAbsolute(relativePath)
    ) {
        return undefined;
    }

    // The OJ integration sends the previous source path so an existing CPH
    // problem can be updated in place. If that file was moved, the path is stale
    // and must not be reused; otherwise a re-import recreates/updates the old
    // problem instead of following the file to its new location.
    return existsSync(sourcePath) ? sourcePath : undefined;
}

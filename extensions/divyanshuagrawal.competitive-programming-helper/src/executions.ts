/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Language, Run, CustomCheckerRun } from './types';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { platform } from 'os';
import config from './config';
import { getTimeOutPref } from './preferences';
import * as vscode from 'vscode';
import path from 'path';
import { deleteCompiledOutput } from './compiledOutput';
import { onlineJudgeEnv, runningCompilers } from './compiler';
import telmetry from './telmetry';
import localize from './i18n';
import { executeCustomChecker } from './utils/customChecker';
import { spawnTestCaseProcess, getTestCaseTime, killTestCaseProcess } from './cpuTimedProcess';

export const runningBinaries: ChildProcessWithoutNullStreams[] = [];
let killRequested = false;

export const clearKillRequested = () => {
    killRequested = false;
};

export const wasKillRequested = () => killRequested;

/**
 * Run a custom checker script for a testcase.
 */
export const runCustomChecker = async (
    checkerPath: string,
    input: string,
    output: string,
): Promise<CustomCheckerRun> => {
    return executeCustomChecker(checkerPath, input, output, runningBinaries);
};

/**
 * Run a single testcase, and return the raw results, without judging.
 *
 * @param binPath path to the executable binary
 * @param input string to be piped into the stdin of the spawned process
 */
export const runTestCase = (
    language: Language,
    binPath: string,
    input: string,
    options: {
        includeLanguageArgs?: boolean;
        logInput?: boolean;
        maxOutputSize?: number;
    } = {},
): Promise<Run> => {
    if (options.logInput === false) {
        globalThis.logger.log('Running testcase', language, binPath);
    } else {
        globalThis.logger.log('Running testcase', language, binPath, input);
    }
    const result: Run = {
        stdout: '',
        stderr: '',
        code: null,
        signal: null,
        time: 0,
        timeOut: false,
    };
    const maxOutputSize = options.maxOutputSize;
    const spawnOpts = {
        env: {
            ...global.process.env,
            DEBUG: 'true',
            CPH: 'true',
        },
    };

    let process: ChildProcessWithoutNullStreams;

    const killer = setTimeout(() => {
        result.timeOut = true;
        killTestCaseProcess(process);
    }, Math.min(config.timeout, getTimeOutPref()));

    // HACK - On Windows, `python3` will be changed to `python`!
    if (platform() === 'win32' && language.compiler === 'python3') {
        language.compiler = 'python';
    }

    // Start the binary or the interpreter.
    switch (language.name) {
        case 'python': {
            process = spawnTestCaseProcess(
                language.compiler, // 'python3' or 'python' TBD
                [
                    binPath,
                    ...(options.includeLanguageArgs === false
                        ? []
                        : language.args),
                ],
                spawnOpts,
            );
            break;
        }
        case 'ruby': {
            process = spawnTestCaseProcess(
                language.compiler,
                [
                    binPath,
                    ...(options.includeLanguageArgs === false
                        ? []
                        : language.args),
                ],
                spawnOpts,
            );
            break;
        }
        case 'js': {
            process = spawnTestCaseProcess(
                language.compiler,
                [
                    binPath,
                    ...(options.includeLanguageArgs === false
                        ? []
                        : language.args),
                ],
                spawnOpts,
            );
            break;
        }
        case 'java': {
            const args: string[] = [];
            if (onlineJudgeEnv) {
                args.push('-DONLINE_JUDGE');
            }

            const binDir = path.dirname(binPath);
            args.push('-cp');
            args.push(binDir);

            const binFileName = path.parse(binPath).name.slice(0, -1);
            args.push(binFileName);

            process = spawnTestCaseProcess('java', args, spawnOpts);
            break;
        }
        case 'csharp': {
            let binFileName: string;

            if (language.compiler.includes('dotnet')) {
                const projName = '.cphcsrun';
                const isLinux = platform() === 'linux';
                if (isLinux) {
                    binFileName = projName;
                } else {
                    binFileName = projName + '.exe';
                }

                const binFilePath = path.join(binPath, binFileName);
                process = spawnTestCaseProcess(binFilePath, ['/stack:67108864'], spawnOpts);
            } else {
                // Run with mono
                process = spawnTestCaseProcess('mono', [binPath], spawnOpts);
            }

            break;
        }
        default: {
            process = spawnTestCaseProcess(binPath, [], spawnOpts);
        }
    }

    process.on('error', (err) => {
        globalThis.logger.error(err);
        vscode.window.showErrorMessage(
            localize(
                'cph.executor.launchError',
                "Could not launch testcase process. Is '{0}' in your PATH?",
                language.compiler,
            ),
        );
    });

    const begin = performance.now();
    let elapsed = 0;
    let launchError = false;
    process.on('exit', () => {
        elapsed = performance.now() - begin;
        clearTimeout(killer);
    });
    const ret: Promise<Run> = new Promise((resolve) => {
        runningBinaries.push(process);
        process.on('close', (code, signal) => {
            clearTimeout(killer);
            const end = performance.now();
            if (!launchError) {
                result.code = code;
                result.signal = signal;
            }
            result.time = getTestCaseTime(process, Math.round(elapsed || end - begin));
            const idx = runningBinaries.indexOf(process);
            if (idx > -1) {
                runningBinaries.splice(idx, 1);
            }
            resolve(result);
        });

        const appendOutput = (key: 'stdout' | 'stderr', data: Buffer) => {
            const text = data.toString();
            if (maxOutputSize === undefined) {
                result[key] += text;
                return;
            }

            const remaining = maxOutputSize - result[key].length;
            if (remaining <= 0) {
                result.outputLimitExceeded = true;
                return;
            }
            if (text.length > remaining) {
                result[key] += text.slice(0, remaining);
                result.outputLimitExceeded = true;
                killTestCaseProcess(process);
                return;
            }
            result[key] += text;
        };

        process.stdout.on('data', (data: Buffer) => {
            appendOutput('stdout', data);
        });
        process.stderr.on('data', (data: Buffer) => {
            appendOutput('stderr', data);
        });

        process.on('error', (err) => {
            clearTimeout(killer);
            launchError = true;
            result.code = 1;
            result.signal = err.name;
        });

        process.stdin.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code !== 'EPIPE') {
                globalThis.logger.error(err);
            }
        });

        globalThis.logger.log('Wrote to STDIN');
        try {
            process.stdin.write(input);
        } catch (err) {
            globalThis.logger.error('WRITEERROR', err);
        }

        process.stdin.end();
    });

    return ret;
};

export const deleteBinary = (language: Language, binPath: string) => {
    if (language.skipCompile) {
        globalThis.logger.log(
            'Skipping deletion of binary as it\'s not a compiled language.',
        );
        return;
    }
    globalThis.logger.log('Deleting binary', binPath);
    deleteCompiledOutput(binPath);
};

/** Kill all currently running processes. Only one problem's testcases
 * should be running at a time. */
export const killRunning = () => {
    globalThis.reporter.sendTelemetryEvent(telmetry.KILL_RUNNING);
    globalThis.logger.log('Killling binaries');
    killRequested = true;
    runningBinaries.forEach((process) => killTestCaseProcess(process));
    runningCompilers.forEach((process) => process.kill());
};

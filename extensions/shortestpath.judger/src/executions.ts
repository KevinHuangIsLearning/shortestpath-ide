import { terminateProcess } from './processTermination';
import { StringDecoder } from 'string_decoder';
import { Language, Run, CustomCheckerRun } from './types';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { platform } from 'os';
import { getPythonCommand, getTimeOutPref } from './preferences';
import * as vscode from 'vscode';
import path from 'path';
import { onlineJudgeEnv, runningCompilers } from './compiler';
import telmetry from './telmetry';
import localize from './i18n';
import { executeTestlibChecker } from './testlibChecker';
import fs from 'fs';
import { AuxiliaryPrograms } from './auxiliaryPrograms';
import { runInteractive, ProgramCommand } from './interactiveRunner';
import { runNative } from './nativeRunner';

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
    answer = '',
    checkCancelled?: () => void,
    artifacts?: AuxiliaryPrograms,
): Promise<CustomCheckerRun> => {
    const programs = artifacts ?? new AuxiliaryPrograms();
    try {
        let executable: string;
        try { executable = await programs.prepare(checkerPath, checkCancelled); }
        catch (error) {
            checkCancelled?.();
            if ((error as Error).message !== 'CE') { throw error; }
            return { verdict: 'CE', command: checkerPath, stdout: '', stderr: localize('judger.checker.compileFailed', 'Checker compilation failed.'), code: 3, signal: null, time: 0, timeOut: false };
        }
        return await executeTestlibChecker(executable, input, output, answer, runningBinaries, getTimeOutPref(), checkCancelled, getPythonCommand());
    } finally { if (!artifacts) { programs.dispose(); } }
};

export async function runInteractiveTestCase(language: Language, binPath: string, interactorPath: string, input: string, timeoutMs = getTimeOutPref(), cwd?: string, checkCancelled?: () => void, maxOutputSize?: number, artifacts?: AuxiliaryPrograms) {
    const programs = artifacts ?? new AuxiliaryPrograms();
    try {
        const interactor = await programs.prepare(interactorPath, checkCancelled);
        const solution = getProgramCommand(language, binPath);
        checkCancelled?.();
        return await runInteractive(solution, interactor, input, runningBinaries, timeoutMs, cwd, maxOutputSize);
    } finally { if (!artifacts) { programs.dispose(); } }
}

/** One language invocation contract for ordinary and interactive execution. */
export function getProgramCommand(language: Language, binPath: string, includeLanguageArgs = true): ProgramCommand {
    if (['python', 'ruby', 'js'].includes(language.name)) {
        const interpreter = language.interpreter ?? language.compiler;
        return { command: platform() === 'win32' && interpreter === 'python3' ? 'python' : interpreter, args: [...(language.interpreterArgs ?? []), binPath, ...(includeLanguageArgs ? language.args : [])] };
    }
    if (language.name === 'java') {
        return { command: language.interpreter ?? 'java', args: [...(language.interpreterArgs ?? []), ...(onlineJudgeEnv ? ['-DONLINE_JUDGE'] : []), '-cp', path.dirname(binPath), path.parse(binPath).name.slice(0, -1)] };
    }
    if (language.name === 'csharp') {
        return language.compiler.includes('dotnet') ? { command: path.join(binPath, platform() === 'win32' ? '.cphcsrun.exe' : '.cphcsrun'), args: [] } : { command: 'mono', args: [binPath] };
    }
    return { command: binPath, args: [] };
}

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
        timeoutMs?: number;
        inputPath?: string;
        checkCancelled?: () => void;
        cwd?: string;
    } = {},
): Promise<Run> => {
    if (vscode.workspace.getConfiguration('judger.execution').get<string>('mode', 'native') === 'native' && !language.skipCompile && !['java', 'csharp'].includes(language.name)) {
        return runNative(binPath, input, runningBinaries, options.timeoutMs ?? getTimeOutPref(), options.maxOutputSize, options.inputPath, options.cwd, options.checkCancelled);
    }
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
        cwd: options.cwd ?? path.dirname(binPath),
        killSignal: 'SIGKILL' as const,
        timeout: options.timeoutMs ?? getTimeOutPref(),
        env: {
            ...global.process.env,
            DEBUG: 'true',
            CPH: 'true',
        },
    };

    const killer = setTimeout(() => {
        result.timeOut = true;
        process.kill('SIGKILL');
    }, options.timeoutMs ?? getTimeOutPref());

    const program = getProgramCommand(language, binPath, options.includeLanguageArgs !== false);
    const process = spawn(program.command, program.args, spawnOpts);

    process.on('error', (err) => {
        globalThis.logger.error(err);
        vscode.window.showErrorMessage(
            localize(
                'judger.executor.launchError',
                "Could not launch testcase process. Is '{0}' in your PATH?",
                language.compiler,
            ),
        );
    });

    const begin = Date.now();
    const ret: Promise<Run> = new Promise((resolve) => {
        const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
        const captured = { stdout: 0, stderr: 0 };
        runningBinaries.push(process);
        process.on('close', (code, signal) => {
            result.stdout += decoders.stdout.end();
            result.stderr += decoders.stderr.end();
            clearTimeout(killer);
            const end = Date.now();
            result.code = code;
            result.signal = signal;
            result.time = end - begin;
            const idx = runningBinaries.indexOf(process);
            if (idx > -1) {
                runningBinaries.splice(idx, 1);
            }
            resolve(result);
        });

        const appendOutput = (key: 'stdout' | 'stderr', data: Buffer) => {
            const remaining = maxOutputSize === undefined ? data.length : Math.max(0, maxOutputSize - captured[key]);
            const accepted = data.subarray(0, remaining);
            captured[key] += accepted.length;
            result[key] += decoders[key].write(accepted);
            if (data.length > remaining) {
                result.outputLimitExceeded = true;
                process.kill('SIGKILL');
            }
        };

        process.stdout.on('data', (data: Buffer) => {
            appendOutput('stdout', data);
        });
        process.stderr.on('data', (data: Buffer) => {
            appendOutput('stderr', data);
        });

        process.on('error', (err) => {
            clearTimeout(killer);
            const end = Date.now();
            result.code = 1;
            result.signal = err.name;
            result.time = end - begin;
            const idx = runningBinaries.indexOf(process);
            if (idx > -1) {
                runningBinaries.splice(idx, 1);
            }
            resolve(result);
        });

        process.stdin.on('error', () => { /* The solution may exit before consuming input. */ });
        if (options.inputPath) {
            const stream = fs.createReadStream(options.inputPath);
            stream.on('error', error => {
                result.stderr += error.message;
                result.signal = 'INPUT_ERROR';
                process.kill('SIGKILL');
            });
            process.once('close', () => stream.destroy());
            stream.pipe(process.stdin);
        } else { process.stdin.end(input); }
    });

    return ret.then(result => {
        if (vscode.workspace.getConfiguration('judger.execution').get<string>('mode', 'native') === 'instrumented') {
            const match = result.stderr.match(/\n\[shortestpath-judger-time:(\d+)\]\r?\n$/);
            if (match) { result.time = Number(match[1]); result.stderr = result.stderr.slice(0, match.index); }
        }
        return result;
    });
};

export const deleteBinary = (language: Language, binPath: string) => {
    if (language.skipCompile) {
        globalThis.logger.log(
            "Skipping deletion of binary as it's not a compiled language.",
        );
        return;
    }
    try {
        if (language.name === 'java') {
            const directory = path.dirname(binPath);
            const prefix = path.basename(binPath).replace(/\*\.class$/, '');
            if (fs.existsSync(directory)) {
                for (const file of fs.readdirSync(directory)) {
                    if ((file === prefix + '.class' || file.startsWith(prefix + '$')) && file.endsWith('.class')) { fs.rmSync(path.join(directory, file), { force: true }); }
                }
            }
        } else { fs.rmSync(binPath, { recursive: true, force: true }); }
    } catch (error) { globalThis.logger.error('Error deleting binary', error); }

};

/** Kill all currently running processes. Only one problem's testcases
 * should be running at a time. */
export const killRunning = () => {
    globalThis.reporter.sendTelemetryEvent(telmetry.KILL_RUNNING);
    globalThis.logger.log('Killling binaries');
    killRequested = true;
    runningBinaries.forEach(terminateProcess);
    runningCompilers.forEach(terminateProcess);
};

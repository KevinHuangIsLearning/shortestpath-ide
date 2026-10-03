import fs from 'fs';
import { StringDecoder } from 'string_decoder';
import crypto from 'crypto';
import { getProbSaveLocation } from './parser';
import { expandLocalHeaders } from './localHeaders';
import { getLanguage, ocHide, ocShow, ocWrite } from './utils';
import { Language } from './types';
import {
    ChildProcess,
    ChildProcessWithoutNullStreams,
    spawn,
    SpawnOptionsWithoutStdio,
} from 'child_process';
import { platform } from 'os';
import path from 'path';
import {
    getCOutputArgPref,
    getCppOutputArgPref,
    getSaveLocationPref,
    getHideStderrorWhenCompiledOK,
    getDefaultOnlineJudge,
} from './preferences';
import * as vscode from 'vscode';
import { getJudgeViewProvider } from './extension';
import { toAsciiFilename } from './utilsPure';
import localize from './i18n';
export let onlineJudgeEnv = getDefaultOnlineJudge();
export const runningCompilers: ChildProcess[] = [];
const compiledFingerprints = new Map<string, string>();

const removeRunningCompiler = (compiler: ChildProcess) => {
    const index = runningCompilers.indexOf(compiler);
    if (index !== -1) {
        runningCompilers.splice(index, 1);
    }
};

export const setOnlineJudgeEnv = (value: boolean) => {
    onlineJudgeEnv = value;
    globalThis.logger.log('online judge env:', onlineJudgeEnv);
    globalThis.logger.log('default online judge env', getDefaultOnlineJudge());
};

/**
 *  Get the location to save the generated binary in. If save location is
 *  available in preferences, returns that, otherwise returns the directory of
 *  active file.
 *
 *  If it is a interpteted language, simply returns the path to the source code.
 *
 *  @param srcPath location of the source code
 */
export const getBinSaveLocation = (srcPath: string, language = getLanguage(srcPath)): string => {
    if (language.skipCompile) {
        return srcPath;
    }
    let ext: string;
    switch (language.name) {
        case 'java': {
            ext = '*.class';
            break;
        }
        case 'csharp': {
            ext = language.compiler.includes('dotnet') ? '_bin' : '.bin';
            break;
        }
        default: {
            ext = '.bin';
        }
    }
    const savePreference = getSaveLocationPref();
    const srcFileName = path.parse(srcPath).name;
    const binFileName = toAsciiFilename(srcFileName) + ext;
    const binDir = path.join(path.dirname(getProbSaveLocation(srcPath)), 'bin', crypto.createHash('sha256').update(srcPath).digest('hex').slice(0, 16));
    if (savePreference && savePreference !== '') {
        return path.join(savePreference, binFileName);
    }
    return path.join(binDir, binFileName);
};

/**
 * Get the complete list of required arguments to be passed to the compiler.
 * Loads additional args from preferences if available.
 *
 * @param language The Language object for the source code
 * @param srcPath location of the source code
 */
const getFlags = (
    language: Language,
    srcPath: string,
    outputPath?: string,
    projectDirectory?: string,
): string[] => {
    const binPath = outputPath || getBinSaveLocation(srcPath, language);
    // The language.args are fetched from user saved preferences, if any.
    let args = language.args;
    if (args[0] === '') args = [];
    let ret: string[];
    switch (language.name) {
        case 'cpp':
        case 'cc':
        case 'cxx': {
            ret = [
                srcPath,
                getCppOutputArgPref(),
                binPath,
                ...args,
                '-D',
                'DEBUG',
                '-D',
                'CPH',
            ];
            if (onlineJudgeEnv) {
                ret.push('-D');
                ret.push('ONLINE_JUDGE');
            }
            break;
        }
        case 'c': {
            {
                ret = [srcPath, getCOutputArgPref(), binPath, ...args];
                if (onlineJudgeEnv) {
                    ret.push('-D');
                    ret.push('ONLINE_JUDGE');
                }
                break;
            }
        }
        case 'rust': {
            ret = [srcPath, '-o', binPath, ...args];
            break;
        }
        case 'go': {
            ret = ['build', '-o', binPath, srcPath, ...args];
            break;
        }
        case 'java': {
            const binDir = path.dirname(binPath);
            ret = [srcPath, '-d', binDir, ...args];
            break;
        }
        case 'hs': {
            ret = [
                srcPath,
                '-o',
                binPath,
                '-no-keep-hi-files',
                '-no-keep-o-files',
                ...args,
            ];
            break;
        }
        case 'csharp': {
            const projDir = getDotnetProjectLocation(
                language,
                srcPath,
                projectDirectory,
            );
            if (language.compiler.includes('dotnet')) {
                ret = [
                    'build',
                    projDir,
                    '-c',
                    'Release',
                    '-o',
                    binPath,
                    '--force',
                    ...args,
                ];
                if (onlineJudgeEnv) {
                    ret.push('/p:DefineConstants="TRACE;ONLINE_JUDGE"');
                }
            } else {
                // mcs will run on shell, need to wrap paths with quotes.
                // otherwise it will raise error when the paths contain whitespace.
                let wrpSrcPath = srcPath;
                let wrpBinPath = binPath;
                if (platform() === 'win32') {
                    wrpSrcPath = '"' + srcPath + '"';
                    wrpBinPath = '"' + binPath + '"';
                }

                ret = [wrpSrcPath, '-out:' + wrpBinPath, ...args];
                if (onlineJudgeEnv) {
                    ret.push('-define:ONLINE_JUDGE');
                }
            }
            break;
        }
        case 'cangjie': {
            ret = [srcPath, '-o', binPath, ...args];
            break;
        }
        default: {
            ret = [];
            break;
        }
    }
    return ret;
};

/**
 * Get the path of the .NET project file (*.csproj) from the location of the source code.
 * If the compiler is not dotnet, simply returns the path to the source code.
 *
 * @param language The Language object for the source code
 * @returns location of the .NET project file (*.csproj)
 */
const getDotnetProjectLocation = (
    language: Language,
    srcPath: string,
    projectDirectory?: string,
): string => {
    if (!language.compiler.includes('dotnet')) {
        return srcPath;
    }

    const projName = '.cphcsrun';
    const projDir =
        projectDirectory || path.join(path.dirname(srcPath), projName);
    return path.join(projDir, projName + '.csproj');
};

/**
 * Create a new .NET project to compile the source code.
 * It would be created under the same directory as the code.
 *
 * @param language The Language object for the source code
 * @param srcPath location of the source code
 */
const createDotnetProject = async (
    language: Language,
    srcPath: string,
    silent = false,
    projectDirectory?: string,
): Promise<boolean> => {
    const result = new Promise<boolean>((resolve) => {
        const projDir = path.dirname(
            getDotnetProjectLocation(language, srcPath, projectDirectory),
        );

        if (!silent) {
            globalThis.logger.log('Creating new .NET project');
        }
        const args = ['new', 'console', '--force', '-o', projDir];
        const newProj = spawn(language.compiler, args, { timeout: vscode.workspace.getConfiguration('judger.execution').get<number>('compilationTimeout', 10000), killSignal: 'SIGKILL' });
        runningCompilers.push(newProj);

        let error = '';

        const capture = (data: Buffer) => { error += data.toString().slice(0, Math.max(0, 1024 * 1024 - error.length)); };
        newProj.stderr.on('data', capture);
        newProj.stdout.on('data', capture);

        newProj.on('close', (exitcode) => {
            removeRunningCompiler(newProj);
            const exitCode = exitcode ?? 0;
            const hideWarningsWhenCompiledOK = getHideStderrorWhenCompiledOK();

            if (exitcode === null || exitCode !== 0) {
                if (!silent) {
                    ocWrite(
                        `Exit code: ${exitCode} Errors while creating new .NET project:\n` +
                            error,
                    );
                    ocShow();
                }
                resolve(false);
                return;
            }

            if (!silent && !hideWarningsWhenCompiledOK && error.trim() !== '') {
                ocWrite(
                    `Exit code: ${exitCode} Warnings while creating new .NET project:\n ` +
                        error,
                );
                ocShow(true);
            }

            const destPath = path.join(projDir, 'Program.cs');
            if (!silent) {
                globalThis.logger.log(
                    'Copying source code to the project',
                    srcPath,
                    destPath,
                );
            }
            try {
                fs.copyFileSync(srcPath, destPath);
                resolve(true);
            } catch (err) {
                globalThis.logger.error('Error while copying source code', err);
                if (!silent) {
                    ocWrite('Errors while creating new .NET project:\n' + err);
                    ocShow();
                }
                resolve(false);
            }
        });

        newProj.on('error', (err) => {
            removeRunningCompiler(newProj);
            if (!silent) {
                globalThis.logger.log(err);
                ocWrite('Errors while creating new .NET project:\n' + err);
                ocShow();
            }
            resolve(false);
        });
    });

    return result;
};

/**
 * Compile a source file, storing the output binary in a location based on user
 * preferences. If `skipCompile` is true for a language, skips the compilation
 * and resolves true. If there is no preference, stores in the current
 * directory. Resolves true if it succeeds, false otherwise.
 *
 * Saves the file before compilation starts.
 *
 * @param srcPath location of the source code
 */
export const compileFile = async (
    srcPath: string,
    options: {
        silent?: boolean;
        outputPath?: string;
        projectDirectory?: string;
        additionalArgs?: string[];
        instrumentation?: boolean;
        useProblemExecutionSettings?: boolean;
        language?: Language;
        compileMode?: 'auto' | 'force' | 'reuse';
    } = {},
): Promise<boolean> => {
    const silent = options.silent === true;
    globalThis.logger.log('Compilation Started');
    await vscode.workspace.openTextDocument(srcPath).then((doc) => doc.save());
    if (!silent) {
        ocHide();
    }
    const language: Language = options.language ?? getLanguage(srcPath);
    if (language.skipCompile) {
        return Promise.resolve(true);
    }

    const spawnOpts: SpawnOptionsWithoutStdio = {
        cwd: path.dirname(srcPath),
        killSignal: 'SIGKILL',
        timeout: vscode.workspace.getConfiguration('judger.execution').get<number>('compilationTimeout', 10000),
        env: process.env,
    };

    if (language.name === 'csharp') {
        if (language.compiler.includes('dotnet')) {
            const projResult = await createDotnetProject(
                language,
                srcPath,
                silent,
                options.projectDirectory,
            );
            if (!projResult) {
                if (!silent) {
                    getJudgeViewProvider().extensionToJudgeViewMessage({
                        command: 'compiling-stop',
                    });
                    getJudgeViewProvider().extensionToJudgeViewMessage({
                        command: 'not-running',
                    });
                }
                return Promise.resolve(false);
            }
        } else {
            // HACK: Mono only provides mcs.bat for Windows?
            // spawn cannot run mcs.bat :(
            if (platform() === 'win32') {
                spawnOpts.shell = true;
            }
        }
    }

    if (!silent) {
        getJudgeViewProvider().extensionToJudgeViewMessage({
            command: 'compiling-start',
        });
    }
    const flags: string[] = getFlags(
        language,
        srcPath,
        options.outputPath,
        options.projectDirectory,
    );
    flags.push(...(options.additionalArgs ?? []));
    if ((!options.outputPath || options.useProblemExecutionSettings) && ['cpp', 'cc', 'cxx'].includes(language.name)) {
        const execution = vscode.workspace.getConfiguration('judger.execution');
        const tools = path.join(globalThis.extensionContext.extensionPath, 'dist/static/tools');
        if (options.instrumentation !== false && execution.get<string>('mode', 'native') === 'instrumented') { flags.push('-include', path.join(tools, 'wrapper.hpp')); }
        if (execution.get('redirectStdio', false)) { flags.push('-include', path.join(tools, 'hook.hpp')); }
    }
    const binary = options.outputPath ?? getBinSaveLocation(srcPath, language);
    await fs.promises.mkdir(path.dirname(binary), { recursive: true });
    const artifact = language.name === 'java' ? path.join(path.dirname(binary), path.parse(srcPath).name + '.class')
        : language.name === 'csharp' && language.compiler.includes('dotnet') ? path.join(binary, process.platform === 'win32' ? '.cphcsrun.exe' : '.cphcsrun') : binary;
    const hasBinary = fs.existsSync(artifact);
    const mode = options.compileMode ?? vscode.workspace.getConfiguration('judger.execution').get<'auto' | 'force' | 'reuse'>('compileMode', 'auto');
    const isCFamily = ['c', 'cpp', 'cc', 'cxx'].includes(language.name);
    const content = isCFamily ? expandLocalHeaders(srcPath) : fs.readFileSync(srcPath, 'utf8');
    // Unknown include search paths and language modules may hide dependencies.
    // In auto mode prefer recompilation over ever running a stale binary.
    const cacheSafe = isCFamily && !/^\s*#\s*(include|include_next|import)\b/m.test(content)
        && !flags.some(flag => /^-(I|isystem|iquote|include|imacros|F)/.test(flag));
    const fingerprint = crypto.createHash('sha256').update(content).update(JSON.stringify([language.compiler, flags])).digest('hex');
    if (hasBinary && (mode === 'reuse' || mode === 'auto' && cacheSafe && compiledFingerprints.get(binary) === fingerprint)) {
        if (!silent) { getJudgeViewProvider().extensionToJudgeViewMessage({ command: 'compiling-stop' }); }
        return true;
    }
    compiledFingerprints.delete(binary);
    // A fresh inode avoids macOS retaining the previous executable's code signature.
    // Keep the old inode alive until the complete new artifact is renamed into place.
    const outputIndex = flags.indexOf(binary);
    const stagedDirectory = platform() === 'darwin' && ['c', 'cpp', 'cc', 'cxx', 'rust', 'go', 'hs', 'cangjie'].includes(language.name) && outputIndex >= 0
        ? await fs.promises.mkdtemp(path.join(path.dirname(binary), '.judger-compile-')) : undefined;
    const compileArtifact = stagedDirectory ? path.join(stagedDirectory, path.basename(binary)) : artifact;
    if (stagedDirectory) { flags[outputIndex] = compileArtifact; }
    else { await fs.promises.rm(artifact, { force: true }); }
    globalThis.logger.log('Compiling with flags', flags);
    const result = new Promise<boolean>((resolve) => {
        let compiler: ChildProcessWithoutNullStreams;
        try {
            compiler = spawn(language.compiler, flags, spawnOpts);
            runningCompilers.push(compiler);
        } catch (err) {
            if (!silent) {
                vscode.window.showErrorMessage(
                    localize(
                        'judger.compiler.launchError',
                        'Could not launch the compiler {0}. Is it installed?',
                        language.compiler,
                    ),
                );
            }
            throw err;
        }
        let error = '';

        const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
        const capture = (key: 'stdout' | 'stderr', data: Buffer) => { error += decoders[key].write(data).slice(0, Math.max(0, 1024 * 1024 - error.length)); };
        compiler.stderr.on('data', data => capture('stderr', data));
        compiler.stdout.on('data', data => capture('stdout', data));

        compiler.on('error', (err) => {
            removeRunningCompiler(compiler);
            globalThis.logger.error(err);
            if (!silent) {
                ocWrite(
                    localize(
                        'judger.compiler.compilationError',
                        'Errors while compiling:\n{0}\n\nHint: Is the compiler {1} installed? Check the compiler command in cph settings for the current language.',
                        err.message,
                        language.compiler,
                    ),
                );
                getJudgeViewProvider().extensionToJudgeViewMessage({
                    command: 'compiling-stop',
                });
                getJudgeViewProvider().extensionToJudgeViewMessage({
                    command: 'not-running',
                });
                ocShow();
            }
            resolve(false);
        });

        compiler.on('close', (exitcode) => {
            removeRunningCompiler(compiler);
            const exitCode = exitcode ?? 0;
            const hideWarningsWhenCompiledOK = getHideStderrorWhenCompiledOK();

            if (exitcode === null || exitCode !== 0 || !fs.existsSync(compileArtifact)) {
                if (!silent) {
                    ocWrite(
                        `Exit code: ${exitCode} Errors while compiling:\n` +
                            error,
                    );
                    ocShow();
                }
                globalThis.logger.error('Compilation failed');
                if (!silent) {
                    getJudgeViewProvider().extensionToJudgeViewMessage({
                        command: 'compiling-stop',
                    });
                    getJudgeViewProvider().extensionToJudgeViewMessage({
                        command: 'not-running',
                    });
                }
                resolve(false);
                return;
            }

            if (!silent && !hideWarningsWhenCompiledOK && error.trim() !== '') {
                ocWrite(
                    `Exit code: ${exitCode} Warnings while compiling:\n ` +
                        error,
                );
                // A successful compile must not steal focus from the source
                // editor while Run All is preparing testcase results.
                ocShow(true);
            }

            globalThis.logger.log('Compilation passed');
            if (!silent) {
                getJudgeViewProvider().extensionToJudgeViewMessage({
                    command: 'compiling-stop',
                });
            }
            resolve(true);
            return;
        });
    });
    try {
        const success = await result;
        if (success) {
            if (stagedDirectory) { await fs.promises.rename(compileArtifact, artifact); }
            compiledFingerprints.set(binary, fingerprint);
        } else { await fs.promises.rm(artifact, { force: true }); }
        return success;
    } finally {
        if (stagedDirectory) { await fs.promises.rm(stagedDirectory, { recursive: true, force: true }); }
    }
};

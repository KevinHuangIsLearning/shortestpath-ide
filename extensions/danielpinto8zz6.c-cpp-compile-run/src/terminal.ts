// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import * as vscode from "vscode";
import { ShellType } from "./enums/shell-type";
import { currentShell, getCDCommand, getCommand } from "./utils/shell-utils";

export interface ITerminalOptions {
    addNewLine?: boolean;
    name: string;
    cwd?: string;
    env?: { [key: string]: string };
    workspaceFolder?: vscode.WorkspaceFolder;
}

export interface ITerminalRunResult {
    terminal: vscode.Terminal;
    /** Resolves to true after shell integration reports that the program ended. */
    completion: Promise<boolean>;
}

class Terminal implements vscode.Disposable {
    private readonly terminals: { [id: string]: vscode.Terminal } = {};

    public async runInTerminal(command: string, options: ITerminalOptions): Promise<ITerminalRunResult> {
        const defaultOptions: ITerminalOptions = { addNewLine: true, name: "C/C++ Compile Run" };
        const { addNewLine, name, cwd, workspaceFolder } = Object.assign(defaultOptions, options);
        const shell : ShellType = currentShell();

        if (this.terminals[name] === undefined) {
            // Open terminal in workspaceFolder if provided
            // See: https://github.com/microsoft/vscode-maven/issues/467#issuecomment-584544090
            const terminalCwd: vscode.Uri | undefined = workspaceFolder ? workspaceFolder.uri : undefined;
            const env: { [envKey: string]: string } = { ...options.env };
            this.terminals[name] = vscode.window.createTerminal({ name, env, cwd: terminalCwd });
            // Workaround for WSL custom envs.
            // See: https://github.com/Microsoft/vscode/issues/71267
            if (shell === ShellType.wsl) {
                setupEnvForWSL(this.terminals[name], env);
            }
        }
        this.terminals[name].show();
        let commandLine = getCommand(command, shell);
        if (cwd) {
            const separator = shell === ShellType.powerShell ? "; " : " && ";
            commandLine = `${await getCDCommand(cwd, shell)}${separator}${commandLine}`;
        }
        const activeTerminal = this.terminals[name];
        const completion = this.executeTracked(activeTerminal, commandLine, addNewLine);
        return { terminal: activeTerminal, completion };
    }

    private async executeTracked(term: vscode.Terminal, commandLine: string, addNewLine: boolean): Promise<boolean> {
        let shellIntegration = term.shellIntegration;
        if (!shellIntegration) {
            shellIntegration = await new Promise<vscode.TerminalShellIntegration | undefined>(resolve => {
                const listener = vscode.window.onDidChangeTerminalShellIntegration(event => {
                    if (event.terminal === term) {
                        clearTimeout(timeout);
                        listener.dispose();
                        resolve(event.shellIntegration);
                    }
                });
                const timeout = setTimeout(() => {
                    listener.dispose();
                    resolve(undefined);
                }, 3000);
            });
        }

        if (!shellIntegration) {
            term.sendText(commandLine, addNewLine);
            return false;
        }

        const execution = shellIntegration.executeCommand(commandLine);
        return new Promise<boolean>(resolve => {
            const endListener = vscode.window.onDidEndTerminalShellExecution(event => {
                if (event.execution === execution) {
                    cleanup();
                    resolve(true);
                }
            });
            const closeListener = vscode.window.onDidCloseTerminal(closedTerminal => {
                if (closedTerminal === term) {
                    cleanup();
                    resolve(true);
                }
            });
            const cleanup = () => {
                endListener.dispose();
                closeListener.dispose();
            };
        });
    }

    public dispose(terminalName?: string): void {
        if (terminalName === undefined) {// If the name is not passed, dispose all.
            Object.keys(this.terminals).forEach((id: string) => {
                this.terminals[id].dispose();
                delete this.terminals[id];
            });
        } else if (this.terminals[terminalName] !== undefined) {
            this.terminals[terminalName].dispose();
            delete this.terminals[terminalName];
        }
    }
}

export const terminal: Terminal = new Terminal();

function setupEnvForWSL(term: vscode.Terminal, env: { [envKey: string]: string }): void {
    if (term !== undefined) {
        Object.keys(env).forEach(key => {
            term.sendText(`export ${key}="${env[key]}"`, true);
        });
    }
}

import path = require("path");
import { env } from "vscode";
import { ShellType } from "../enums/shell-type";
import { outputChannel } from "../output-channel";
import { executeCommand } from "./cp-utils";
import { quoteCmdArgument, quotePowerShellArgument } from "./shell-quoting";

export function parseShell(executable: string): ShellType {
    switch (executable.toLowerCase()) {
        case "cmd.exe":
            return ShellType.cmd;
        case "pwsh.exe":
        case "powershell.exe":
        case "pwsh": // pwsh on mac/linux
            return ShellType.powerShell;
        case "bash.exe":
        case "git-cmd.exe":
            return ShellType.gitBash;
        case "wsl.exe":
        case "ubuntu.exe":
        case "ubuntu1804.exe":
        case "kali.exe":
        case "debian.exe":
        case "opensuse-42.exe":
        case "sles-12.exe":
            return ShellType.wsl;
        default:
            return ShellType.others;
    }
}

export function getCommand(cmd: string, shell: ShellType): string {
    if (shell === ShellType.powerShell) {
        return `& ${cmd}`;
    } else {
        return cmd;
    }
}

export async function getCDCommand(cwd: string, shellType: ShellType): Promise<string> {
    if (shellType === ShellType.powerShell) {
        return `Set-Location -LiteralPath ${quotePowerShellArgument(cwd)}`;
    }
    const parsedPath = await getPath(cwd, shellType);
    return shellType === ShellType.cmd ? `cd /d ${parsedPath}` : `cd ${parsedPath}`;
}

export async function getPath(cwd: string, shellType: ShellType): Promise<string> {
    if (process.platform === "win32") {
        switch (shellType) {
            case ShellType.gitBash:
                return `"${cwd.replace(/\\+$/, "")}"`; // Git Bash: remove trailing '\'
            case ShellType.powerShell:
                return quotePowerShellArgument(cwd);
            case ShellType.cmd:
                return quoteCmdArgument(cwd);
            case ShellType.wsl:
                return `"${await toWslPath(cwd)}"`; // WSL
            default:
                return `"${cwd}"`; // Unknown, try using common one.
        }
    } else {
        return `"${cwd}"`;
    }
}

export async function toWslPath(filepath: string): Promise<string> {
    if (path.posix.isAbsolute(filepath)) {
        return filepath;
    }

    try {
        return (await executeCommand("wsl", ["wslpath", "-u", `"${filepath.replace(/\\/g, "/")}"`])).trim();
    } catch (error) {
        outputChannel.appendLine(String(error), "WSL");
        return toDefaultWslPath(filepath);
    }
}

function toDefaultWslPath(p: string): string {
    const arr: string[] = p.split(":\\");
    if (arr.length === 2) {
        const drive: string = arr[0].toLowerCase();
        const dir: string = arr[1].replace(/\\/g, "/");
        return `/mnt/${drive}/${dir}`;
    } else {
        return p.replace(/\\/g, "/");
    }
}

export function getRunPrefix(shell: ShellType): string {
    if (shell === ShellType.cmd || shell === ShellType.powerShell) {
        return ".\\";
    }

    return "./";
}

export function currentShell(): ShellType {
    const currentShellPath: string = env.shell;
    const executable: string = path.basename(currentShellPath);
    return parseShell(executable);
}

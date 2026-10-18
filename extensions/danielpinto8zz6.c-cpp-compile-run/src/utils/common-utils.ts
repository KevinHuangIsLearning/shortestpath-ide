import find, { ProcessInfo, FindConfig } from "find-process";
import { lookpath } from "lookpath";
import { isStringNullOrWhiteSpace } from "./string-utils";
import isWsl from "is-wsl";
import path = require("path");
import { promises as fs } from "fs";

/**
 * Checks if a command exists in the system PATH.
 */
export async function commandExists(command: string): Promise<boolean> {
    const result = await lookpath(command);
    return !isStringNullOrWhiteSpace(result);
}

/**
 * Checks the executable path when available, falling back to its process name.
 */
export async function isProcessRunning(processName: string): Promise<boolean> {
    if (isWsl) {
        return false;
    }
    if (isWindows() && path.isAbsolute(processName)) {
        // Windows denies write access to a loaded executable. Avoid a costly
        // process enumeration for the usual case of an idle output file.
        try {
            const handle = await fs.open(processName, "r+");
            await handle.close();
            return false;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") { return false; }
            // A lock can also come from permissions or antivirus software. Check
            // the process list before attributing it to a running program.
        }
    }
    try {
        const config: FindConfig = { strict: true };
        const list: ProcessInfo[] = await find("name", path.basename(processName), config);
        return list.some(proc => {
            if (!path.isAbsolute(processName) || !proc.bin) { return true; }
            const normalize = (value: string) => isWindows() ? path.normalize(value).toLowerCase() : path.normalize(value);
            return normalize(proc.bin) === normalize(processName);
        });
    } catch (error) {
        return false;
    }
}

/**
 * Returns true if the current platform is Windows.
 */
export function isWindows(): boolean {
    return process.platform === "win32";
}

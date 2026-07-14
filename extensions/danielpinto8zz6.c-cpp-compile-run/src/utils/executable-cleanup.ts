import { promises as fs } from "fs";
import path = require("path");
import find, { FindConfig, ProcessInfo } from "find-process";
import * as vscode from "vscode";

const DEFAULT_CLEANUP_DELAY_SECONDS = 60;
const PROCESS_START_GRACE_MS = 10_000;
const PROCESS_POLL_MS = 250;
const DELETE_RETRY_MS = 2_000;

type FileVersion = { mtimeMs: number; size: number };

const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

function cleanupDelayMs(): number {
    const seconds = vscode.workspace.getConfiguration('shortestpath').get<number>('executableCleanupDelaySeconds', DEFAULT_CLEANUP_DELAY_SECONDS);
    return Math.max(0, Math.min(86_400, Number.isFinite(seconds) ? Math.floor(seconds) : DEFAULT_CLEANUP_DELAY_SECONDS)) * 1_000;
}

function isCleanupEnabled(): boolean {
    return vscode.workspace.getConfiguration('shortestpath').get<boolean>('executableCleanupEnabled', true) !== false;
}

async function getFileVersion(executablePath: string): Promise<FileVersion | undefined> {
    try {
        const stat = await fs.stat(executablePath);
        return { mtimeMs: stat.mtimeMs, size: stat.size };
    } catch {
        return undefined;
    }
}

async function isExecutableRunning(executablePath: string): Promise<boolean> {
    try {
        const config: FindConfig = { strict: true };
        const processes: ProcessInfo[] = await find("name", path.basename(executablePath), config);
        return processes.length > 0;
    } catch {
        return false;
    }
}

async function deleteIfUnchanged(executablePath: string, expectedVersion: FileVersion): Promise<void> {
    const currentVersion = await getFileVersion(executablePath);
    if (!currentVersion || currentVersion.mtimeMs !== expectedVersion.mtimeMs || currentVersion.size !== expectedVersion.size) {
        return;
    }
    try {
        await fs.rm(executablePath, { force: true });
        await fs.rm(`${executablePath}.dSYM`, { recursive: true, force: true });
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
            const retry = setTimeout(() => void deleteIfUnchanged(executablePath, expectedVersion), DELETE_RETRY_MS);
            retry.unref();
            return;
        }
        throw error;
    }
}

function runCleanup(executablePath: string, expectedVersion: FileVersion): void {
    void deleteIfUnchanged(executablePath, expectedVersion).catch(error => {
        console.error(`Failed to delete generated executable ${executablePath}`, error);
    });
}

/** Schedule deletion after the configured delay once the generated executable stops running. */
export async function scheduleExecutableCleanup(executablePath: string): Promise<void> {
    if (!isCleanupEnabled()) {
        return;
    }
    const expectedVersion = await getFileVersion(executablePath);
    if (!expectedVersion) {
        return;
    }
    const timer = setTimeout(() => runCleanup(executablePath, expectedVersion), cleanupDelayMs());
    timer.unref();
}

/** Fallback for terminals without shell integration and external terminals. */
export async function monitorExecutableAndScheduleCleanup(executablePath: string): Promise<void> {
    if (!isCleanupEnabled()) {
        return;
    }
    const detectionDeadline = Date.now() + PROCESS_START_GRACE_MS;
    let observedRunning = false;
    do {
        const running = await isExecutableRunning(executablePath);
        if (running) {
            observedRunning = true;
        } else if (observedRunning || Date.now() >= detectionDeadline) {
            await scheduleExecutableCleanup(executablePath);
            return;
        }
        await delay(PROCESS_POLL_MS);
    } while (true);
}

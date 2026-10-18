import * as assert from "assert";
import { parseShell, getCommand, getRunPrefix, getCDCommand, getPath } from "../utils/shell-utils";
import { ShellType } from "../enums/shell-type";
import { spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, rmdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

suite("Shell Utils Test Suite", () => {
    test("parseShell should identify common executables", () => {
        assert.strictEqual(parseShell("cmd.exe"), ShellType.cmd);
        assert.strictEqual(parseShell("powershell.exe"), ShellType.powerShell);
        assert.strictEqual(parseShell("pwsh"), ShellType.powerShell);
        assert.strictEqual(parseShell("bash"), ShellType.others);
        assert.strictEqual(parseShell("wsl.exe"), ShellType.wsl);
        assert.strictEqual(parseShell("ubuntu.exe"), ShellType.wsl);
        assert.strictEqual(parseShell("zsh"), ShellType.others);
    });

    test("getCommand should format for PowerShell correctly", () => {
        const cmd = "gcc main.c";
        assert.strictEqual(getCommand(cmd, ShellType.powerShell), `& ${cmd}`);
        assert.strictEqual(getCommand(cmd, ShellType.cmd), cmd);
        assert.strictEqual(getCommand(cmd, ShellType.others), cmd);
    });

    test("getRunPrefix should return correct prefix per shell", () => {
        // Windows shells
        assert.strictEqual(getRunPrefix(ShellType.cmd), ".\\");
        assert.strictEqual(getRunPrefix(ShellType.powerShell), ".\\");
        
        // Unix-like shells
        assert.strictEqual(getRunPrefix(ShellType.gitBash), "./");
        assert.strictEqual(getRunPrefix(ShellType.wsl), "./");
        assert.strictEqual(getRunPrefix(ShellType.others), "./");
    });

    test("Windows shells enter directories containing literal brackets, quotes and percent signs", async function () {
        if (process.platform !== "win32") { this.skip(); }
        this.timeout(10_000);
        const root = mkdtempSync(join(tmpdir(), "shortestpath-shell-test-"));
        const directory = join(root, "[SPOJ] \u2018\u4e2d\u6587\u2019 Alice's %SHORTESTPATH_QUOTING_TEST%");
        mkdirSync(directory);
        try {
            for (const shell of [ShellType.powerShell, ShellType.cmd]) {
                const invocation = `${await getPath(process.execPath, shell)} -p "JSON.stringify(process.cwd())"`;
                const command = `${await getCDCommand(directory, shell)}${shell === ShellType.powerShell ? "; " : " && "}${getCommand(invocation, shell)}`;
                const options = { encoding: "utf8" as const, timeout: 5000, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", SHORTESTPATH_QUOTING_TEST: "must not expand" } };
                const child = shell === ShellType.powerShell
                    ? spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], options)
                    : spawnSync(command, [], { ...options, shell: process.env.ComSpec });
                assert.ifError(child.error);
                assert.strictEqual(child.status, 0, child.stderr);
                assert.strictEqual(JSON.parse(child.stdout), directory);
            }
        } finally {
            rmdirSync(directory);
            rmdirSync(root);
        }
    });
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import { readFileSync } from "fs";
import { createRequire } from "module";
import path = require("path");
import { runInNewContext } from "vm";
import { FileType } from "../enums/file-type";

// Load a fresh compiled module with narrow API substitutes so these regressions
// exercise orchestration without launching terminals or modifying global VS Code APIs.
function loadModule<T>(name: string, substitutes: Record<string, object>): T {
	const filename = require.resolve(name);
	const nativeRequire = createRequire(filename);
	const exports = {};
	runInNewContext(readFileSync(filename, "utf8"), {
		exports, process, console, setTimeout, clearTimeout,
		require: (id: string) => substitutes[id] ?? nativeRequire(id)
	}, { filename });
	return exports as T;
}

function emitter<T>() {
	const listeners = new Set<(event: T) => void>();
	return {
		event: (listener: (event: T) => void) => {
			listeners.add(listener);
			return { dispose: () => { listeners.delete(listener); } };
		},
		fire: (event: T) => { for (const listener of listeners) { listener(event); } },
		get size() { return listeners.size; }
	};
}

suite("Compile/run Windows regressions", () => {
	test("workspace compilation passes Chinese paths directly and runs only after a successful exit", async () => {
		class Execution {
			constructor(public process: string, public args: string[], public options: { cwd: string; env: Record<string, string> }) {}
		}
		class Task {
			constructor(_definition: object, _scope: number, _name: string, _source: string, public execution: Execution) {}
		}
		const ended = emitter<{ execution: object; exitCode: number }>();
		let task: Task;
		const execution = {};
		const compiler = path.resolve("工具链", "g++.exe");
		const source = path.resolve("中文目录", "中文题目.cpp");
		const output = path.resolve("中文目录", "output");
		const { Compiler } = loadModule<typeof import("../compiler")>("../compiler", {
			vscode: {
				ProcessExecution: Execution, Task, TaskScope: { Workspace: 1 }, window: {},
				workspace: { workspaceFolders: [{}] },
				tasks: {
					executeTask: async (value: Task) => { task = value; return execution; },
					onDidEndTaskProcess: ended.event
				}
			},
			"./configuration": { Configuration: {
				cppCompiler: () => compiler, cppFlags: () => "-std=c++20 -Wl,--stack,268435456", cppLinkerFlags: () => "",
				saveBeforeCompile: () => false, skipIfCompiled: () => false,
				additionalIncludePaths: () => [path.resolve("中文头文件")], includePathsFromCppProperties: (): string[] => []
			} },
			"./notification": { Notification: { showInformationMessage() {}, showErrorMessage() {} } },
			"./utils/workspace-utils": { ensureWorkspaceIsTrusted: async () => true },
			"./utils/common-utils": { commandExists: async () => true, isProcessRunning: async () => false },
			"./utils/file-utils": { getOutputLocation: () => output },
			"./utils/compiler-environment": { getCompilerEnvironment: async () => ({ PATH: "selected-toolchain" }) }
		});
		const instance = new Compiler({ path: source, directory: path.dirname(source), name: "中文题目.cpp", title: "中文题目", type: FileType.cplusplus, executable: "shortestpath-test.exe" });
		let runs = 0;
		const callback = async () => { runs++; };
		await instance.compile(callback);
		assert.strictEqual(task.execution.process, compiler);
		assert.deepStrictEqual([...task.execution.args], [
			"-std=c++20", "-Wl,--stack,268435456", "-I", path.resolve("中文头文件"), source, "-o", path.join(output, "shortestpath-test.exe")
		]);
		assert.strictEqual(task.execution.options.cwd, path.dirname(source));
		assert.strictEqual(task.execution.options.env.PATH, "selected-toolchain");
		assert.strictEqual(task.execution.options.env.LC_ALL, undefined);
		assert.strictEqual(runs, 0);
		ended.fire({ execution: {}, exitCode: 0 });
		await new Promise<void>(resolve => setImmediate(resolve));
		assert.strictEqual(runs, 0);
		ended.fire({ execution, exitCode: 1 });
		await new Promise<void>(resolve => setImmediate(resolve));
		assert.strictEqual(runs, 0);
		assert.strictEqual(ended.size, 0);
		await instance.compile(callback);
		ended.fire({ execution, exitCode: 0 });
		await new Promise<void>(resolve => setImmediate(resolve));
		assert.strictEqual(runs, 1);
		assert.strictEqual(ended.size, 0);
	});

	test("changing runtime PATH creates a new terminal and closing an old terminal leaves the new one usable", async () => {
		const closed = emitter<object>();
		const shellEnded = emitter<object>();
		const created: Array<{ options: { name: string; env: Record<string, string> }; executions: string[]; show(): void; dispose(): void; shellIntegration: { executeCommand(command: string): object } }> = [];
		const { terminal } = loadModule<typeof import("../terminal")>("../terminal", {
			vscode: { window: {
				onDidCloseTerminal: closed.event,
				onDidEndTerminalShellExecution: shellEnded.event,
				createTerminal: (options: { name: string; env: Record<string, string> }) => {
					const executions: string[] = [];
					const term = { options, executions, show() {}, dispose() { closed.fire(term); }, shellIntegration: {
						executeCommand: (command: string) => { executions.push(command); return {}; }
					} };
					created.push(term);
					return term;
				}
			} },
			"./utils/shell-utils": { currentShell: () => 0, getCommand: (cmd: string) => cmd }
		});
		try {
			const options = { name: "C/C++ Compile Run", env: { PATH: "toolchain-A" } };
			const first = await terminal.runInTerminal("first.exe", options);
			await terminal.runInTerminal("second.exe", options);
			const next = await terminal.runInTerminal("third.exe", { ...options, env: { PATH: "toolchain-B" } });
			assert.strictEqual(created.length, 2);
			assert.notStrictEqual(first.terminal, next.terminal);
			created[0].dispose();
			const reused = await terminal.runInTerminal("fourth.exe", { ...options, env: { PATH: "toolchain-B" } });
			assert.strictEqual(reused.terminal, next.terminal);
			assert.strictEqual(created.length, 2);
			created[1].dispose();
			await terminal.runInTerminal("fifth.exe", options);
			assert.strictEqual(created.length, 3);
		} finally {
			terminal.dispose();
		}
		assert.strictEqual(closed.size, 0);
		assert.strictEqual(shellEnded.size, 0);
	});
});

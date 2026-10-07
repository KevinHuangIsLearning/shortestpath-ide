/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import * as protocol from '../shortestpathOjProtocol';
import * as recency from '../workspaceProblemCache';
import * as recordStorage from '../workspaceProblemRecordStorage';
import * as migration from '../workspaceProblemCacheMigration';
import * as versions from '../problemStatementVersion';
import * as history from '../submissionHistory';
import * as sourcePath from '../sourcePath';
import { bindPayload } from './fixtures';

type Cache = {
	problems: Record<string, protocol.ImportedProblem>;
	sourcePaths: Record<string, string>;
	lastUsedAt: Record<string, number>;
	recoveryContexts?: Record<string, recency.WorkspaceProblemRecoveryContext>;
	editorials?: Record<string, protocol.EditorialResult>;
	previousStatements?: Record<string, versions.ProblemStatementSnapshot[]>;
	submissions?: Record<string, history.SubmissionHistoryEntry[]>;
};

function problem(index: number): protocol.ImportedProblem {
	const ref = `topic/found/P${index}`;
	return protocol.parseProblemBindData({ ...structuredClone(bindPayload), problem: {
		...structuredClone(bindPayload.problem), ref, url: `https://shortestpath.cn/problem/${ref}`, accountId: '11',
		target: { kind: 'training', problemId: String(index + 1), problemRef: ref },
		publicContent: { title: bindPayload.problem.title }, localTest: { enabled: true, reason: '' },
	} }, 2);
}

async function fixture() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shortestpath-lru-'));
	const storageRoot = path.join(root, 'internal-storage');
	const directory = path.join(storageRoot, 'problem-cache', createHash('sha256').update(root).digest('hex'));
	const projectDirectory = path.join(root, '.shortestpath');
	await fs.mkdir(path.dirname(directory), { recursive: true });
	const writes: string[] = [];
	const deletes: string[] = [];
	const warnings: string[] = [];
	let failedWrite: string | undefined;
	let delayedWrite: { name: string; started: () => void; ready: Promise<void> } | undefined;
	let corruptedWrite: string | undefined;
	type TestUri = { scheme: string; fsPath: string; path: string; toString(): string; with(change: { path: string }): TestUri };
	const uri = (value: string): TestUri => ({ scheme: 'file', fsPath: value, path: value, toString: () => value, with: change => uri(change.path) });
	class FileSystemError extends Error {
		constructor(readonly code: string) { super(code); }
	}
	const io = async <T>(operation: () => Promise<T>): Promise<T> => {
		try { return await operation(); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') { throw new FileSystemError('FileNotFound'); }
			throw error;
		}
	};
	const fileName = (index: number) => recency.getWorkspaceProblemRecordFileName(problem(index).ref);
	const compiled = await fs.readFile(path.resolve(__dirname, '../extension.js'), 'utf8');
	const start = compiled.indexOf('function getWorkspaceCacheDirectoryUri(');
	const end = compiled.indexOf('async function submitCphProblem(', start);
	const load = (workspaceRoot = root) => {
		const recoveries: recency.WorkspaceProblemRecoveryContext[] = [];
		const shown: string[] = [];
		let showForCph!: (url: string) => Promise<void>;
		const context = vm.createContext({
			console: { ...console, warn: (message: string) => warnings.push(message) }, TextDecoder, TextEncoder,
			context: { subscriptions: [] },
			panel: { showProblem: (value: protocol.ImportedProblem) => shown.push(value.ref) },
			bridge: { isBound: () => false }, recovery: { select: (identity: recency.WorkspaceProblemRecoveryContext) => recoveries.push(identity) },
			workspaceCacheDirectoryName: '.shortestpath', legacyWorkspaceCacheFileName: 'oj-problems.json', workspaceProblemRecordVersion: 2,
			workspaceCacheMutationTail: Promise.resolve(), workspaceCacheMigration: undefined,
			workspaceCacheStorageRoot: uri(storageRoot), workspaceCacheLocationsMigrated: new Set(), workspaceCacheLegacyContents: new WeakMap(),
			workspaceCachesNeedingRewrite: new WeakSet(), workspaceCacheRecordContents: new WeakMap(), workspaceCacheRecordLocations: new WeakMap(), workspaceCacheSourceContents: new WeakMap(),
			hintAnswerCache: new Map(),
			path: path, path_1: { default: path }, workspaceProblemRecordStorage_1: recordStorage, workspaceProblemCache_1: recency, workspaceProblemCacheMigration_1: migration,
			crypto_1: { createHash },
			shortestpathOjProtocol_1: protocol, problemStatementVersion_1: versions, submissionHistory_1: history, sourcePath_1: sourcePath,
			localization_1: { localizeFormat: (text: string) => text },
			vscode: {
				commands: { registerCommand: (_name: string, handler: (url: string) => Promise<void>) => { showForCph = handler; return {}; } },
				FileSystemError, FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
				Uri: { file: uri, joinPath: (parent: { path: string }, ...segments: string[]) => uri(path.join(parent.path, ...segments)) },
				workspace: { workspaceFolders: [{ uri: uri(workspaceRoot) }], fs: {
					readDirectory: (uri: { path: string }) => io(async () => (await fs.readdir(uri.path, { withFileTypes: true })).map(entry => [entry.name, entry.isFile() ? 1 : 2])),
					readFile: (uri: { path: string }) => io(() => fs.readFile(uri.path)),
					stat: (uri: { path: string }) => io(async () => { const stat = await fs.lstat(uri.path); return { mtime: stat.mtimeMs, type: stat.isSymbolicLink() ? 64 : stat.isDirectory() ? 2 : 1 }; }),
					createDirectory: (uri: { path: string }) => fs.mkdir(uri.path, { recursive: true }),
					writeFile: async (uri: { path: string }, content: Uint8Array) => {
						if (path.basename(uri.path) === failedWrite) { throw new Error('simulated write failure'); }
						if (path.basename(uri.path) === delayedWrite?.name) {
							const delay = delayedWrite; delayedWrite = undefined; delay.started(); await delay.ready;
						}
						if (path.basename(uri.path) === corruptedWrite) { corruptedWrite = undefined; content = new TextEncoder().encode('corrupted'); }
						await fs.writeFile(uri.path, content); writes.push(path.basename(uri.path));
					},
					delete: (uri: { path: string }) => io(async () => { if ((await fs.lstat(uri.path)).isDirectory()) { await fs.rmdir(uri.path); } else { await fs.unlink(uri.path); } deletes.push(path.basename(uri.path)); }),
				} },
			},
		});
		vm.runInContext(`${compiled.slice(start, end)}; globalThis.api = { read: readWorkspaceProblemCache, mutate: mutateWorkspaceProblemCache };`, context);
		const commandStart = compiled.indexOf(`context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.showProblemForCph'`);
		const commandEnd = compiled.indexOf(`context.subscriptions.push(vscode.commands.registerCommand('shortestpath.oj.hideProblemForCphSourcePath'`, commandStart);
		vm.runInContext(compiled.slice(commandStart, commandEnd), context);
		return { read: context.api.read as (access?: string) => Promise<Cache>, mutate: context.api.mutate as (action: (cache: Cache) => void, write: boolean) => Promise<void>, hints: context.hintAnswerCache as Map<string, object>, showForCph, recoveries, shown };
	};
	const insert = (cache: Cache, index: number) => {
		const value = problem(index);
		cache.problems[value.ref] = value;
		cache.sourcePaths[value.ref] = path.join(root, `P${index}.cpp`);
		recency.touchWorkspaceProblemCache(cache, value.ref, index + 1);
	};
	return {
		root, directory, projectDirectory, writes, deletes, warnings, fileName, load, insert,
		corruptWrite: (name: string) => { corruptedWrite = name; },
		failWrite: (name: string | undefined) => { failedWrite = name; },
		delayWrite: (name: string) => {
			let started!: () => void; let release!: () => void;
			const waiting = new Promise<void>(resolve => { started = resolve; });
			const ready = new Promise<void>(resolve => { release = resolve; });
			delayedWrite = { name, started, ready };
			return { waiting, release };
		},
		files: async () => (await fs.readdir(directory)).filter(name => name !== '.source-paths.json').sort(),
		cleanup: () => fs.rm(root, { recursive: true, force: true }),
	};
}

test('disk LRU survives restart, ignores background updates, and retains source bindings and user files', async () => {
	const f = await fixture();
	try {
		const cache = f.load();
		await cache.mutate(value => { for (let i = 0; i < 30; i++) { f.insert(value, i); } }, true);
		const source = path.join(f.root, 'P1.cpp');
		const cases = path.join(f.root, 'P1.cph');
		await fs.writeFile(source, 'user code'); await fs.writeFile(cases, 'custom cases');
		f.writes.length = 0;
		await cache.read(problem(0).ref);
		assert.deepEqual(f.writes, [f.fileName(0)]);
		await f.load().mutate(value => f.insert(value, 30), true);
		assert.deepEqual({ count: (await f.files()).length, evicted: f.deletes }, { count: 30, evicted: [f.fileName(1)] });
		assert.deepEqual([await fs.readFile(source, 'utf8'), await fs.readFile(cases, 'utf8')], ['user code', 'custom cases']);
		const index = await f.load().read();
		assert.equal(index.sourcePaths[problem(1).ref], source);
		assert.deepEqual(structuredClone(index.recoveryContexts?.[problem(1).ref]), recency.getWorkspaceProblemRecoveryContext(problem(1)));
		const reopened = f.load();
		await reopened.showForCph(problem(1).url);
		assert.deepEqual(structuredClone(reopened.recoveries), [recency.getWorkspaceProblemRecoveryContext(problem(1))]);
		assert.deepEqual(reopened.shown, []);
		await reopened.showForCph(problem(0).url);
		assert.deepEqual(reopened.shown, [problem(0).ref]);
		await cache.mutate(value => { value.problems[problem(2).ref].state.progress.submitCount++; }, true);
		await cache.mutate(value => f.insert(value, 31), true);
		assert.equal(f.deletes.at(-1), f.fileName(2));
		await Promise.all([cache.mutate(value => f.insert(value, 32), true), cache.mutate(value => f.insert(value, 33), true)]);
		const restored = await f.load().read();
		assert.equal((await f.files()).length, 30);
		assert.ok(restored.problems[problem(0).ref] && restored.problems[problem(32).ref] && restored.problems[problem(33).ref]);
	} finally { await f.cleanup(); }
});

test('old snapshots use file timestamps, and the initially selected old problem is retained during trimming', async () => {
	const f = await fixture();
	try {
		await fs.mkdir(f.directory);
		for (let i = 0; i < 35; i++) {
			const file = path.join(f.directory, f.fileName(i));
			await fs.writeFile(file, JSON.stringify({ version: 2, problem: problem(i), sourcePath: path.join(f.root, `P${i}.cpp`), submissions: [] }));
			await fs.utimes(file, i + 1, i + 1);
		}
		const cache = f.load();
		cache.hints.set(`${problem(1).ref}/hint`, {});
		const restored = await cache.read(problem(0).ref);
		assert.equal((await f.files()).length, 30);
		assert.ok(restored.problems[problem(0).ref]);
		assert.deepEqual(f.deletes, [1, 2, 3, 4, 5].map(f.fileName));
		assert.equal(cache.hints.size, 0);
		assert.equal(Object.keys(restored.sourcePaths).length, 35);
		const before = f.writes.length;
		await f.load().read();
		assert.equal(f.writes.length, before);
	} finally { await f.cleanup(); }
});

test('a failed new snapshot write preserves the existing 30 snapshots and does not poison later operations', async () => {
	const f = await fixture();
	try {
		const cache = f.load();
		await cache.mutate(value => { for (let i = 0; i < 30; i++) { f.insert(value, i); } }, true);
		f.failWrite(f.fileName(30));
		await assert.rejects(cache.mutate(value => f.insert(value, 30), true), /simulated write failure/);
		assert.deepEqual({ files: (await f.files()).length, deleted: f.deletes }, { files: 30, deleted: [] });
		f.failWrite(undefined);
		await cache.mutate(value => f.insert(value, 30), true);
		assert.deepEqual({ files: (await f.files()).length, deleted: f.deletes }, { files: 30, deleted: [f.fileName(0)] });
	} finally { await f.cleanup(); }
});

test('legacy aggregate migration retains the selected snapshot and all source associations before enforcing LRU', async () => {
	const f = await fixture();
	try {
		await fs.mkdir(f.directory);
		const legacy: Cache & { version: number } = { version: 4, problems: {}, sourcePaths: {}, lastUsedAt: {} };
		for (let i = 0; i < 35; i++) { f.insert(legacy, i); }
		const ref = problem(0).ref;
		const evicted = problem(42);
		const editorial: protocol.EditorialResult = { state: 'available', simpleContent: { format: 'markdown', content: 'cached summary' }, content: { format: 'markdown', content: 'cached solution' }, solutionCode: '', hints: [], updatedAt: '2026-10-07T00:00:00Z' };
		legacy.editorials = { [ref]: editorial };
		legacy.previousStatements = { [ref]: [{ ...problem(0), title: 'previous title' }] };
		legacy.sourcePaths[evicted.ref] = path.join(f.root, 'P42.cpp');
		legacy.recoveryContexts = { [evicted.ref]: recency.getWorkspaceProblemRecoveryContext(evicted) };
		await fs.writeFile(path.join(f.directory, 'oj-problems.json'), JSON.stringify(legacy));
		const restored = await f.load().read(problem(0).ref);
		assert.equal((await f.files()).length, 30);
		assert.ok(restored.problems[problem(0).ref]);
		assert.equal(Object.keys(restored.sourcePaths).length, 36);
		assert.deepEqual(structuredClone(restored.editorials?.[ref]), editorial);
		assert.equal(restored.previousStatements?.[ref][0].title, 'previous title');
		assert.deepEqual(structuredClone(restored.recoveryContexts?.[evicted.ref]), recency.getWorkspaceProblemRecoveryContext(evicted));
		assert.ok(f.deletes.includes('oj-problems.json'));
	} finally { await f.cleanup(); }
});

test('a failed parallel write waits for its sibling before the next queued mutation can run', async () => {
	const f = await fixture();
	try {
		const cache = f.load();
		await cache.mutate(value => { f.insert(value, 0); f.insert(value, 1); }, true);
		f.failWrite(f.fileName(0));
		const delay = f.delayWrite(f.fileName(1));
		const failed = cache.mutate(value => {
			value.problems[problem(0).ref].state.progress.submitCount = 10;
			value.problems[problem(1).ref].state.progress.submitCount = 10;
		}, true);
		const rejected = assert.rejects(failed, /simulated write failure/);
		await delay.waiting;
		let nextStarted = false;
		const next = cache.mutate(value => { nextStarted = true; value.problems[problem(1).ref].state.progress.submitCount = 20; }, true);
		await new Promise<void>(resolve => setImmediate(resolve));
		assert.equal(nextStarted, false);
		delay.release();
		await rejected;
		f.failWrite(undefined);
		await next;
		assert.equal((await cache.read()).problems[problem(1).ref].state.progress.submitCount, 20);
	} finally { await f.cleanup(); }
});

test('a corrupt source index falls back to surviving snapshot identities and paths', async () => {
	const f = await fixture();
	try {
		await f.load().mutate(value => f.insert(value, 0), true);
		await fs.writeFile(path.join(f.directory, '.source-paths.json'), '{broken');
		const restored = await f.load().read(problem(0).ref);
		assert.equal(restored.sourcePaths[problem(0).ref], path.join(f.root, 'P0.cpp'));
		assert.deepEqual(structuredClone(restored.recoveryContexts?.[problem(0).ref]), recency.getWorkspaceProblemRecoveryContext(problem(0)));
		assert.equal(f.warnings.length, 1);
	} finally { await f.cleanup(); }
});

test('project caches migrate into internal storage with complete contents and unchanged source and test files', async () => {
	const f = await fixture();
	try {
		const ref = problem(0).ref;
		const editorial: protocol.EditorialResult = { state: 'available', simpleContent: { format: 'markdown', content: 'cached explanation' }, content: { format: 'markdown', content: 'cached solution' }, solutionCode: 'user editorial code', hints: [], updatedAt: '2026-10-07T00:00:00Z' };
		const previous = { ...problem(0), title: 'previous title' };
		const submission = { submissionId: '100', status: 'AC', score: 100, maxTimeMs: 1, maxMemoryKB: 2, judgedAt: null };
		await f.load().mutate(value => {
			f.insert(value, 0);
			value.editorials![ref] = editorial;
			value.previousStatements![ref] = [previous];
			value.submissions![ref] = [submission];
		}, true);
		await fs.rename(f.directory, f.projectDirectory);
		await fs.writeFile(path.join(f.root, 'P0.cpp'), 'user source');
		await fs.writeFile(path.join(f.root, 'P0.cph'), 'custom cases');
		const restored = await f.load().read();
		assert.equal(await fs.stat(f.projectDirectory).then(() => true, () => false), false);
		assert.deepEqual({ recency: restored.lastUsedAt[ref], editorial: structuredClone(restored.editorials?.[ref]), previous: restored.previousStatements?.[ref]?.[0].title, submissions: structuredClone(restored.submissions?.[ref]) }, {
			recency: 1, editorial, previous: 'previous title', submissions: [submission],
		});
		assert.deepEqual([await fs.readFile(path.join(f.root, 'P0.cpp'), 'utf8'), await fs.readFile(path.join(f.root, 'P0.cph'), 'utf8')], ['user source', 'custom cases']);
		const reloaded = f.load();
		await reloaded.showForCph(problem(0).url);
		assert.deepEqual(reloaded.shown, [ref]);
	} finally { await f.cleanup(); }
});

test('relocation keeps newer private snapshots, merges older bindings, and preserves unrelated project files', async () => {
	const f = await fixture();
	try {
		await f.load().mutate(value => { f.insert(value, 0); value.problems[problem(0).ref].state.progress.submitCount = 20; }, true);
		await fs.mkdir(f.projectDirectory);
		await fs.writeFile(path.join(f.projectDirectory, f.fileName(0)), JSON.stringify({ version: 2, problem: problem(0), submissions: [], sourcePath: path.join(f.root, 'old.cpp'), lastUsedAt: 1 }));
		const extra = problem(42);
		await fs.writeFile(path.join(f.projectDirectory, '.source-paths.json'), JSON.stringify({ sourcePaths: { [extra.ref]: path.join(f.root, 'P42.cpp') }, recoveryContexts: { [extra.ref]: recency.getWorkspaceProblemRecoveryContext(extra) } }));
		await fs.writeFile(path.join(f.projectDirectory, 'notes.txt'), 'unrelated user notes');
		const restored = await f.load().read();
		assert.equal(restored.problems[problem(0).ref].state.progress.submitCount, 20);
		assert.equal(restored.sourcePaths[problem(0).ref], path.join(f.root, 'P0.cpp'));
		assert.equal(restored.sourcePaths[extra.ref], path.join(f.root, 'P42.cpp'));
		assert.deepEqual(structuredClone(restored.recoveryContexts?.[extra.ref]), recency.getWorkspaceProblemRecoveryContext(extra));
		assert.deepEqual(await fs.readdir(f.projectDirectory), ['notes.txt']);
	} finally { await f.cleanup(); }
});

test('relocation failures preserve original caches and retry safely after a failed write or verification', async () => {
	const f = await fixture();
	try {
		await f.load().mutate(value => f.insert(value, 0), true);
		await fs.rename(f.directory, f.projectDirectory);
		const file = path.join(f.projectDirectory, f.fileName(0));
		const original = await fs.readFile(file, 'utf8');
		f.failWrite(f.fileName(0));
		const reader = f.load();
		await assert.rejects(reader.read(), /simulated write failure/);
		assert.equal(await fs.readFile(file, 'utf8'), original);
		f.failWrite(undefined);
		f.corruptWrite(f.fileName(0));
		await assert.rejects(reader.read(), /cache_relocation_verification_failed/);
		assert.equal(await fs.readFile(file, 'utf8'), original);
		await reader.read();
		assert.equal(await fs.stat(f.projectDirectory).then(() => true, () => false), false);
		assert.ok((await f.load().read()).problems[problem(0).ref]);
	} finally { await f.cleanup(); }
});

test('one internal storage root isolates different workspaces and leaves project directories free of new caches', async () => {
	const f = await fixture();
	try {
		const first = f.load();
		await first.mutate(value => f.insert(value, 0), true);
		const otherRoot = path.join(f.root, 'another-workspace');
		await fs.mkdir(otherRoot);
		const second = f.load(otherRoot);
		assert.deepEqual(Object.keys((await second.read()).problems), []);
		await second.mutate(value => f.insert(value, 1), true);
		assert.deepEqual(Object.keys((await first.read()).problems), [problem(0).ref]);
		assert.deepEqual(Object.keys((await second.read()).problems), [problem(1).ref]);
		for (const root of [f.root, otherRoot]) { assert.equal(await fs.stat(path.join(root, '.shortestpath')).then(() => true, () => false), false); }
	} finally { await f.cleanup(); }
});

test('project-level legacy aggregates relocate without losing cached editorials or LRU metadata', async () => {
	const f = await fixture();
	try {
		await fs.mkdir(f.projectDirectory);
		const ref = problem(0).ref;
		const editorial: protocol.EditorialResult = { state: 'available', simpleContent: { format: 'markdown', content: 'cached summary' }, content: { format: 'markdown', content: 'cached solution' }, solutionCode: '', hints: [], updatedAt: '2026-10-07T00:00:00Z' };
		await fs.writeFile(path.join(f.projectDirectory, 'oj-problems.json'), JSON.stringify({ version: 4, problems: { [ref]: problem(0) }, sourcePaths: { [ref]: path.join(f.root, 'P0.cpp') }, editorials: { [ref]: editorial }, lastUsedAt: { [ref]: 123 } }));
		const restored = await f.load().read();
		assert.equal(restored.lastUsedAt[ref], 123);
		assert.deepEqual(structuredClone(restored.editorials?.[ref]), editorial);
		assert.equal(await fs.stat(f.projectDirectory).then(() => true, () => false), false);
	} finally { await f.cleanup(); }
});


test('indexed project records relocate to private snapshots while preserving Judger cases and custom source files', async () => {
    const f = await fixture();
    try {
        const value = problem(1), source = path.join(f.root, 'custom.cpp');
        const owned = path.join(f.root, 'custom.prob.judger');
        const record = path.join(owned, `oj-${f.fileName(1)}`);
        await fs.mkdir(owned, { recursive: true }); await fs.mkdir(f.projectDirectory, { recursive: true });
        await fs.writeFile(source, 'user source');
        await fs.writeFile(path.join(owned, 'problem.json'), 'user cases');
        await fs.writeFile(record, JSON.stringify({ version: 2, problem: value, sourcePath: source, submissions: [], previousStatements: [], lastUsedAt: 42 }));
        await fs.writeFile(path.join(f.projectDirectory, 'oj-index.json'), JSON.stringify([{ problemRef: value.ref, path: path.relative(f.projectDirectory, record) }]));
        const restored = await f.load().read(value.ref);
        assert.equal(restored.problems[value.ref].ref, value.ref); assert.equal(restored.sourcePaths[value.ref], source);
        assert.deepEqual([await fs.readFile(source, 'utf8'), await fs.readFile(path.join(owned, 'problem.json'), 'utf8')], ['user source', 'user cases']);
        await assert.rejects(fs.stat(record), { code: 'ENOENT' });
        assert.deepEqual(await f.files(), [f.fileName(1)]);
    } finally { await f.cleanup(); }
});

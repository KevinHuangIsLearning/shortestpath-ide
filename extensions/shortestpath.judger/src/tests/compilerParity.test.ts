import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
jest.mock('vscode', () => ({
    workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback }), openTextDocument: async () => ({ save: async () => true }) },
    window: { showErrorMessage: jest.fn() },
}), { virtual: true });
jest.mock('../utils', () => ({ getLanguage: () => ({ name: 'cpp', compiler: 'c++', args: [], skipCompile: false }), ocHide: jest.fn(), ocShow: jest.fn(), ocWrite: jest.fn() }));
jest.mock('../preferences', () => ({ getSaveLocationPref: () => '', getCollectProblemsInRoot: () => false, getDefaultOnlineJudge: () => false, getCppOutputArgPref: () => '-o', getHideStderrorWhenCompiledOK: () => true }));
jest.mock('../extension', () => ({ getJudgeViewProvider: () => ({ extensionToJudgeViewMessage: jest.fn() }) }));
jest.mock('../i18n', () => ({ __esModule: true, default: (_: string, text: string) => text }));
import { compileFile } from '../compiler';
import { expandLocalHeaders } from '../localHeaders';
const hasCompiler = spawnSync('c++', ['--version']).status === 0;
(hasCompiler ? test : test.skip)('real compiler cache tracks local headers, force and reuse modes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-cache-'));
    globalThis.logger = { log: jest.fn(), error: jest.fn() } as unknown as typeof globalThis.logger;
    try {
        const source = path.join(root, 'main.cpp'); const header = path.join(root, 'answer.h'); const binary = path.join(root, 'run');
        fs.writeFileSync(header, '#pragma once\n#define ANSWER 1\n');
        fs.writeFileSync(source, '#include "answer.h"\nint main(){return ANSWER;}');
        const options = { outputPath: binary, silent: true };
        expect(await compileFile(source, options)).toBe(true);
        fs.utimesSync(binary, 1, 1);
        expect(await compileFile(source, options)).toBe(true);
        expect(fs.statSync(binary).mtimeMs).toBe(1000);
        fs.writeFileSync(header, '#pragma once\n#define ANSWER 2\n');
        expect(await compileFile(source, options)).toBe(true);
        expect(spawnSync(binary).status).toBe(2);
        fs.utimesSync(binary, 1, 1);
        expect(await compileFile(source, { ...options, compileMode: 'force' })).toBe(true);
        expect(fs.statSync(binary).mtimeMs).toBeGreaterThan(1000);
        const includeDirectory = path.join(root, 'include'); fs.mkdirSync(includeDirectory);
        const externalHeader = path.join(includeDirectory, 'project.h');
        fs.writeFileSync(externalHeader, '#define ANSWER 3');
        fs.writeFileSync(source, '#include <project.h>\nint main(){return ANSWER;}');
        const includeOptions = { ...options, additionalArgs: ['-I', includeDirectory] };
        expect(await compileFile(source, includeOptions)).toBe(true);
        fs.writeFileSync(externalHeader, '#define ANSWER 4');
        expect(await compileFile(source, includeOptions)).toBe(true);
        expect(spawnSync(binary).status).toBe(4);
        fs.writeFileSync(source, 'not valid C++');
        expect(await compileFile(source, { ...options, compileMode: 'reuse' })).toBe(true);
        fs.unlinkSync(binary);
        expect(await compileFile(source, { ...options, compileMode: 'reuse' })).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
}, 20000);

test('header expansion handles nested pragma-once headers and cycles without changing source', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-headers-'));
    try {
        const source = path.join(root, 'main.cpp');
        const text = '#include <iostream>\n#include "a.h"\n#include "a.h"\n';
        fs.writeFileSync(source, text);
        fs.writeFileSync(path.join(root, 'a.h'), '#pragma once\n#include "b.h"\nint a;');
        fs.writeFileSync(path.join(root, 'b.h'), '#pragma once\n#include "a.h"\nint b;');
        const expanded = expandLocalHeaders(source);
        expect(expanded).toContain('#include <iostream>');
        expect(expanded).not.toContain('#include "');
        expect(expanded).toContain('int b;');
        expect(fs.readFileSync(source, 'utf8')).toBe(text);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('compiler consumes stdout and requires a fresh artifact rather than accepting an old binary', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-fake-compiler-'));
    globalThis.logger = { log: jest.fn(), error: jest.fn() } as unknown as typeof globalThis.logger;
    try {
        const source = path.join(root, 'main.cpp'), binary = path.join(root, 'run'), wrapper = path.join(root, 'compiler.js');
        fs.writeFileSync(source, 'int main(){}');
        const language = { name: 'cpp' as const, compiler: wrapper, args: [], skipCompile: false };
        fs.writeFileSync(wrapper, "#!/usr/bin/env node\nconst fs=require('fs'); process.stdout.write('x'.repeat(256*1024)); const a=process.argv; fs.writeFileSync(a[a.indexOf('-o')+1],'new');");
        fs.chmodSync(wrapper, 0o755);
        expect(await compileFile(source, { language, outputPath: binary, silent: true, compileMode: 'force' })).toBe(true);
        expect(fs.readFileSync(binary, 'utf8')).toBe('new');
        fs.writeFileSync(wrapper, '#!/usr/bin/env node\nprocess.exit(0)');
        expect(await compileFile(source, { language, outputPath: binary, silent: true, compileMode: 'force' })).toBe(false);
        expect(fs.existsSync(binary)).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

import { getBinSaveLocation } from '../compiler';
test('C# artifacts follow the effective toolchain rather than the global language settings', () => {
    const source = '/tmp/main.cs';
    const dotnet = getBinSaveLocation(source, { name: 'csharp', compiler: 'dotnet', args: [], skipCompile: false });
    const mono = getBinSaveLocation(source, { name: 'csharp', compiler: 'mcs', args: [], skipCompile: false });
    expect(dotnet).toMatch(/_bin$/);
    expect(mono).toMatch(/\.bin$/);
    expect(mono).not.toBe(dotnet);
});

test('dotnet project creation copies source through file APIs and verifies the platform apphost', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-dotnet-'));
    globalThis.logger = { log: jest.fn(), error: jest.fn() } as unknown as typeof globalThis.logger;
    try {
        const source = path.join(root, 'Main.cs'), wrapper = path.join(root, 'fake-dotnet'), output = path.join(root, 'app');
        fs.writeFileSync(source, '// source');
        fs.writeFileSync(wrapper, "#!/usr/bin/env node\nconst fs=require('fs'),p=require('path'),a=process.argv.slice(2),out=a[a.indexOf('-o')+1];fs.mkdirSync(out,{recursive:true});if(a[0]==='new')fs.writeFileSync(p.join(out,'.cphcsrun.csproj'),'');else fs.writeFileSync(p.join(out,process.platform==='win32'?'.cphcsrun.exe':'.cphcsrun'),'apphost');");
        fs.chmodSync(wrapper, 0o755);
        expect(await compileFile(source, { language: { name: 'csharp', compiler: wrapper, args: [], skipCompile: false }, outputPath: output, projectDirectory: path.join(root, 'project'), silent: true })).toBe(true);
        expect(fs.readFileSync(path.join(root, 'project', 'Program.cs'), 'utf8')).toBe('// source');
        expect(fs.existsSync(path.join(output, process.platform === 'win32' ? '.cphcsrun.exe' : '.cphcsrun'))).toBe(true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

(hasCompiler ? test : test.skip)('freshly recompiled native artifacts run on their first launch with a new inode on macOS', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-first-launch-'));
    globalThis.logger = { log: jest.fn(), error: jest.fn() } as typeof globalThis.logger;
    try {
        const source = path.join(root, 'main.cpp'), binary = path.join(root, 'run');
        let previousInode: number | undefined;
        for (let iteration = 0; iteration < 8; iteration++) {
            fs.writeFileSync(source, `int main(){return ${iteration};}`);
            expect(await compileFile(source, { outputPath: binary, silent: true, compileMode: 'force' })).toBe(true);
            const inode = fs.statSync(binary).ino;
            if (process.platform === 'darwin' && previousInode !== undefined) { expect(inode).not.toBe(previousInode); }
            const run = spawnSync(binary);
            expect([run.status, run.signal]).toEqual([iteration, null]);
            previousInode = inode;
        }
        expect(fs.readdirSync(root).some(name => name.startsWith('.judger-compile-'))).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
}, 20000);

(process.platform === 'darwin' ? test : test.skip)('Haskell compiler receives a staged output and publishes it without temporary files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judger-haskell-stage-'));
    globalThis.logger = { log: jest.fn(), error: jest.fn() } as typeof globalThis.logger;
    try {
        const source = path.join(root, 'main.hs'), binary = path.join(root, 'run'), compiler = path.join(root, 'ghc.js');
        fs.writeFileSync(source, 'main = pure ()');
        fs.writeFileSync(binary, 'old');
        const oldInode = fs.statSync(binary).ino;
        fs.writeFileSync(compiler, "#!/usr/bin/env node\nconst fs=require('fs');const path=require('path');const a=process.argv;const out=a[a.indexOf('-o')+1];if(!path.dirname(out).includes('.judger-compile-'))process.exit(1);fs.writeFileSync(out,'new');");
        fs.chmodSync(compiler, 0o755);
        expect(await compileFile(source, { outputPath: binary, silent: true, compileMode: 'force', language: { name: 'hs', compiler, args: [], skipCompile: false } })).toBe(true);
        expect(fs.readFileSync(binary, 'utf8')).toBe('new');
        expect(fs.statSync(binary).ino).not.toBe(oldInode);
        expect(fs.readdirSync(root).some(name => name.startsWith('.judger-compile-'))).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

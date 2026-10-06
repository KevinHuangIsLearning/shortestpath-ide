/* Copyright (c) 2026 ShortestPath IDE contributors. Licensed under GPL-3.0-or-later. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const commit = 'df90fabb52e8f566ea3382405e22d246af5d6a69';
const [upstream, dependencyRoot] = process.argv.slice(2).map(value => path.resolve(value));
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim() !== commit) {
	throw new Error('Competitive Companion checkout does not match the pinned commit');
}
const require = createRequire(path.join(dependencyRoot, 'package.json'));
const esbuild = require('esbuild');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = await esbuild.build({
	entryPoints: [path.join(root, 'scripts/companion/entry.ts')],
	metafile: true, write: false, bundle: true, format: 'esm', minify: true,
	nodePaths: [path.join(dependencyRoot, 'node_modules')],
	alias: { upstream: path.join(upstream, 'src') },
	banner: { js: `/* Competitive Companion 2.65.0, MIT, Jasper van Merle. Upstream ${commit}. See LICENSE and NOTICE.md. */` },
	plugins: [{ name: 'companion-adapter', setup(build) {
		build.onLoad({ filter: /src\/utils\/browser\.ts$/ }, () => ({ contents: fs.readFileSync(path.join(root, 'scripts/companion/browser.ts'), 'utf8'), loader: 'ts' }));
		// Match upstream's build substitutions for PDF/ZIP libraries.
		build.onLoad({ filter: /jszip|pdfjs-dist/ }, args => ({
			contents: fs.readFileSync(args.path, 'utf8').replace(/new Function\(/g, 'new Error(')
				.replace(/await import\(this.workerSrc\)/g, 'null').replace(/export\{[^ ]+ as WorkerMessageHandler};/g, ''),
			loader: args.path.endsWith('.worker.min.mjs') ? 'text' : 'js',
		}));
	} }],
});
fs.writeFileSync(path.join(root, 'static/competitive-companion/parsers.bundle.txt'), '(async () => {\n' + result.outputFiles[0].text.replace(/\/\*![\s\S]*?\*\//g, (comment: string) => comment.replace(/[ \t]+$/gm, '')) + '\nreturn await globalThis.ShortestPathCompanionParse();\n})()');
fs.copyFileSync(path.join(upstream, 'LICENSE'), path.join(root, 'static/competitive-companion/LICENSE'));
for (const file of ['package.json', 'package-lock.json']) {
	const source = path.join(dependencyRoot, file);
	const target = path.join(root, 'scripts/companion', file);
	if (source !== target) { fs.copyFileSync(source, target); }
}

const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
	if (input.startsWith('(disabled):') || !input.includes('node_modules/')) { continue; }
	let directory = path.dirname(path.resolve(input));
	while (!fs.existsSync(path.join(directory, 'package.json'))) {
		const parent = path.dirname(directory);
		if (parent === directory) { throw new Error(`Missing package metadata for ${input}`); }
		directory = parent;
	}
	packages.add(directory);
}
// JSZip's prebuilt browser file embeds pako, which is absent from esbuild's module graph.
packages.add(path.join(dependencyRoot, 'node_modules/pako'));
const notices = [...packages].sort().map(directory => {
	const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
	const licenses = fs.readdirSync(directory).filter(file => /^(license|copying|notice)([.-]|$)/i.test(file));
	if (!licenses.length) { throw new Error(`Missing license text for ${metadata.name}`); }
	return `${metadata.name} ${metadata.version} (${metadata.license})\n` + licenses.map(file => fs.readFileSync(path.join(directory, file), 'utf8')).join('\n');
});
fs.writeFileSync(path.join(root, 'static/competitive-companion/THIRD-PARTY-LICENSES.txt'), notices.join('\n\n----------------------------------------\n\n'));

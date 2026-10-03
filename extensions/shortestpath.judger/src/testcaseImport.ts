/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import crypto from 'crypto';

export type ImportPair = { name: string; input?: string; output?: string };
export type ImportExtensions = { inputs: string[]; outputs: string[] };
const defaults: ImportExtensions = {
	inputs: ['.in'],
	outputs: ['.ans', '.out'],
};
const collator = new Intl.Collator('en', { numeric: true });

export function scanTestcases(
	directory: string,
	extensions = defaults,
): ImportPair[] {
	const files: string[] = [];
	const visit = (folder: string) => {
		for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
			const file = path.join(folder, entry.name);
			if (entry.isDirectory()) {
				visit(file);
			} else if (entry.isFile()) {
				files.push(file);
			}
		}
	};
	visit(directory);
	const remaining = new Set(files);
	const pairs: ImportPair[] = [];
	for (const file of files.sort(collator.compare)) {
		const suffix = extensions.inputs.find((ext) => file.endsWith(ext));
		if (!suffix) {
			continue;
		}
		const base = file.slice(0, -suffix.length);
		const output = extensions.outputs
			.map((ext) => base + ext)
			.find((candidate) => remaining.has(candidate));
		remaining.delete(file);
		if (output) {
			remaining.delete(output);
		}
		pairs.push({
			name: path.relative(directory, base),
			input: file,
			output,
		});
	}
	for (const file of remaining) {
		if (extensions.outputs.some((ext) => file.endsWith(ext))) {
			pairs.push({ name: path.relative(directory, file), output: file });
		}
	}
	return pairs.sort(
		(a, b) =>
			Number(!a.input) - Number(!b.input) ||
			collator.compare(a.name, b.name),
	);
}

/** Validate the entire archive before writing; never follow archive links or overwrite a folder. */
export function extractTestcaseZip(zipPath: string, destination: string): string {
	const maxBytes = 128 * 1024 * 1024;
	if (fs.statSync(zipPath).size > maxBytes) {
		throw new Error('ZIP exceeds 128 MiB');
	}
	const bytes = fs.readFileSync(zipPath);
	const digest = crypto.createHash('sha256').update(bytes).digest('hex');
	const requested = path.resolve(destination);
	const markerName = '.shortestpath-zip-sha256';
	for (let suffix = 1; ; suffix++) {
		const candidate = suffix === 1 ? requested : `${requested}-${suffix}`;
		if (!fs.existsSync(candidate)) { break; }
		const marker = path.join(candidate, markerName);
		if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === digest) { return candidate; }
	}
	const zip = new AdmZip(bytes);
	const entries = zip.getEntries();
	if (entries.length > 10000) {
		throw new Error('ZIP has too many entries');
	}
	const names = new Set<string>();
	let total = 0;
	for (const entry of entries) {
		const name = entry.entryName.replace(/\\/g, '/');
		const components = name.split('/');
		if (
			name.startsWith('/') ||
			components.some(
				(part) => part === '..' || part === '.' || part.includes(':'),
			) ||
			name.includes('\0') ||
			((entry.attr >>> 16) & 0xf000) === 0xa000
		) {
			throw new Error('Unsafe ZIP entry');
		}
		const normalized = name.replace(/\/$/, '').toLowerCase();
		if (!normalized || names.has(normalized)) {
			throw new Error('Duplicate ZIP entry');
		}
		names.add(normalized);
		total += entry.header.size;
		if (total > maxBytes) {
			throw new Error('Expanded ZIP exceeds 128 MiB');
		}
	}
	// Claim a new directory only for changed or previously unimported archives.
	if (names.has(markerName)) { throw new Error('Reserved ZIP entry'); }
	let target = requested;
	for (let suffix = 2; ; suffix++) {
		try {
			fs.mkdirSync(target, { recursive: false });
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') { throw error; }
			if (fs.existsSync(path.join(target, markerName)) && fs.readFileSync(path.join(target, markerName), 'utf8') === digest) { return target; }
			target = `${requested}-${suffix}`;
		}
	}
	try {
		for (const entry of entries) {
			const file = path.join(
				target,
				entry.entryName.replace(/\\/g, '/'),
			);
			if (entry.isDirectory) {
				fs.mkdirSync(file, { recursive: true });
			} else {
				fs.mkdirSync(path.dirname(file), { recursive: true });
				fs.writeFileSync(file, entry.getData(), { flag: 'wx' });
			}
		}
		fs.writeFileSync(path.join(target, markerName), digest, { flag: 'wx' });
	} catch (error) {
		fs.rmSync(target, { recursive: true, force: true });
		throw error;
	}
	return target;
}

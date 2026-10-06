/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import fs from 'fs';
import path from 'path';
import {
	extractTestcaseZip,
	scanTestcases,
	ImportPair,
} from './testcaseImport';
import { getProblemDirectory } from './parser';
import { TestCase } from './types';
import localize from './i18n';

// Quick picks share one UI surface. Serialize imports so a cancellation cannot
// remove an extraction that another still-pending import has reused.
let importQueue = Promise.resolve();
export async function importTestcases(
	srcPath: string,
	pathOrUri?: string,
	fromFiles = false,
	fromFolder = false,
): Promise<TestCase[]> {
	const previous = importQueue;
	let release!: () => void;
	importQueue = new Promise<void>(resolve => { release = resolve; });
	await previous;
	try { return await importTestcasesNow(srcPath, pathOrUri, fromFiles, fromFolder); }
	finally { release(); }
}

async function importTestcasesNow(
	srcPath: string,
	pathOrUri?: string,
	fromFiles = false,
	fromFolder = false,
): Promise<TestCase[]> {
	const uri = pathOrUri
		? pathOrUri.startsWith('file:')
			? vscode.Uri.parse(pathOrUri)
			: vscode.Uri.file(pathOrUri)
		: (
				await vscode.window.showOpenDialog({
					canSelectMany: false,
					canSelectFolders: fromFolder,
					canSelectFiles: !fromFolder,
					filters: fromFolder ? undefined : fromFiles
						? { Data: ['in', 'out', 'ans', 'txt'] }
						: { ZIP: ['zip'] },
				})
		  )?.[0];
	if (!uri) {
		return [];
	}
	if (uri.scheme !== 'file') {
		throw new Error(
			localize('judger.import.local', 'Select a local ZIP file.'),
		);
	}
	const config = vscode.workspace.getConfiguration(
		'judger.problem',
		vscode.Uri.file(srcPath),
	);
	const filePath = uri.fsPath;
	const extensions = {
		inputs: config.get('inputFileExtensionList', ['.in']),
		outputs: config.get('outputFileExtensionList', ['.ans', '.out']),
	};
	let newExtraction: string | undefined;
	let firstCreatedParent: string | undefined;
	let extractionParent: string | undefined;
	let imported = false;
	try {
		let pairs: ImportPair[];
		if (fs.statSync(filePath).isDirectory()) {
			pairs = scanTestcases(filePath, extensions);
		} else if (path.extname(filePath).toLowerCase() !== '.zip') {
			const isOutput = extensions.outputs.some((ext) =>
				filePath.endsWith(ext),
			);
			const behavior = config.get<string>(
				'foundMatchTestcaseBehavior',
				'always',
			);
			const suffix = [...extensions.inputs, ...extensions.outputs].find(
				(ext) => filePath.endsWith(ext),
			);
			const base = suffix ? filePath.slice(0, -suffix.length) : filePath;
			const candidate =
				behavior === 'never'
					? undefined
					: (isOutput ? extensions.inputs : extensions.outputs)
							.map((ext) => base + ext)
							.find(
								(file) =>
									fs.existsSync(file) &&
									fs.statSync(file).isFile(),
							);
			const paired: ImportPair = {
				name: path.basename(base),
				input: isOutput ? candidate : filePath,
				output: isOutput ? filePath : candidate,
			};
			let usePair = behavior === 'always';
			if (behavior === 'ask' && paired?.input && paired?.output) {
				const yes = localize('judger.import.pairYes', 'Import both files');
				usePair =
					(await vscode.window.showQuickPick(
						[
							yes,
							localize(
								'judger.import.pairNo',
								'Import only this file',
							),
						],
						{
							title: localize(
								'judger.import.pair',
								'A matching testcase file was found',
							),
						},
					)) === yes;
			}
			pairs =
				usePair && paired
					? [paired]
					: [
							{
								name: path.basename(filePath),
								...(isOutput
									? { output: filePath }
									: { input: filePath }),
							},
					  ];
		} else {
			const workspace =
				vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(srcPath);
			const values: Record<string, string> = {
				workspace,
				problem: getProblemDirectory(srcPath),
				zipDirname: path.dirname(filePath),
				zipBasename: path.basename(filePath),
				zipBasenameNoExt: path.basename(filePath, path.extname(filePath)),
			};
			const template = config.get<string>(
				'unzipFolder',
				'${problem}/testcases/${zipBasenameNoExt}',
			);
			const directory = template.replace(
				/\$\{(\w+)\}/g,
				(_, key: string) => values[key] ?? '${' + key + '}',
			);
			if (!path.isAbsolute(directory) || /\$\{/.test(directory)) {
				throw new Error(
					localize(
						'judger.import.folder',
						'The extraction folder must be an absolute path with supported placeholders.',
					),
				);
			}
			extractionParent = path.dirname(directory);
			firstCreatedParent = fs.mkdirSync(extractionParent, { recursive: true });
			const extractedDirectory = extractTestcaseZip(filePath, directory, created => { newExtraction = created; });
			pairs = scanTestcases(extractedDirectory, extensions);
		}
		if (!pairs.length) {
			void vscode.window.showWarningMessage(
				localize('judger.import.empty', 'No testcase files were found.'),
			);
			return [];
		}
		const selected = await vscode.window.showQuickPick(
			pairs.map((pair) => ({
				label: pair.name,
				description: [
					pair.input ?? localize('judger.import.noInput', 'No input'),
					pair.output ?? localize('judger.import.noAnswer', 'No answer'),
				].join(' → '),
				picked: true,
				pair,
			})),
			{
				canPickMany: true,
				title: localize(
					'judger.import.select',
					'Select testcases to import',
				),
			},
		);
		if (!selected?.length) {
			return [];
		}
		const tests = selected.map(({ pair }, id) => ({
			id,
			input: '',
			output: '',
			...(pair.input ? { inputPath: path.resolve(pair.input) } : {}),
			...(pair.output ? { outputPath: path.resolve(pair.output) } : {}),
		}));
		if (
			path.extname(filePath).toLowerCase() === '.zip' &&
			config.get('deleteAfterUnzip', false)
		) {
			fs.unlinkSync(filePath);
		}
		imported = true;
		return tests;
	} finally {
		if (!imported) {
			// Cached extractions belong to earlier imports and must never be rolled back.
			if (newExtraction) { fs.rmSync(newExtraction, { recursive: true, force: true }); }
			if (firstCreatedParent) {
				let parent = extractionParent!;
				while (true) {
					try { fs.rmdirSync(parent); } catch (error) {
						if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { break; }
					}
					if (parent === firstCreatedParent) { break; }
					parent = path.dirname(parent);
				}
			}
		}
	}
}


export async function importTestcasesWithPicker(srcPath: string): Promise<TestCase[] | 'json'> {
	const selected = await vscode.window.showQuickPick([
		{ label: localize('judger.import.sourceZip', 'ZIP archive'), source: 'zip' },
		{ label: localize('judger.import.sourceFile', 'Testcase file'), source: 'file' },
		{ label: localize('judger.import.sourceFolder', 'Folder'), source: 'folder' },
		{ label: localize('judger.import.sourceJson', 'JSON'), source: 'json' },
	], { title: localize('judger.import.chooseSource', 'Choose how to import testcases') });
	if (!selected) { return []; }
	if (selected.source === 'json') { return 'json'; }
	return importTestcases(srcPath, undefined, selected.source === 'file', selected.source === 'folder');
}

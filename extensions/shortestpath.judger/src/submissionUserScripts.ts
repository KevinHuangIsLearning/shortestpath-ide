/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { parseUserScript, matchesUserScript } from './userScripts';
import { SubmissionTemplate, SubmissionValues } from './submissionTemplates';
import localize from './i18n';

export function builtinSubmissionRoute(
	url: string,
): { name: string; url: string; values: SubmissionValues } | undefined {
	const parsed = new URL(url);
	let match: RegExpMatchArray | null;
	if (/^(?:(?:m[123]|www)\.)?codeforces\.com$/.test(parsed.hostname)) {
		match = parsed.pathname.match(
			/^\/(contest|gym)\/(\d+)\/problem\/(\w+)\/?$/,
		);
		if (match) {
			return {
				name: 'codeforces',
				url: `${parsed.origin}/${match[1]}/${match[2]}/submit`,
				values: { contestId: match[2], problemId: match[3] },
			};
		}
		match = parsed.pathname.match(
			/^\/problemset\/problem\/(\d+)\/(\w+)\/?$/,
		);
		if (match) {
			return {
				name: 'codeforces',
				url: `${parsed.origin}/problemset/submit`,
				values: { contestId: match[1], problemId: match[2] },
			};
		}
	}
	if (parsed.hostname === 'atcoder.jp') {
		match = parsed.pathname.match(
			/^\/contests\/([^/]+)\/tasks\/([^/]+)\/?$/,
		);
		if (match) {
			return {
				name: 'atcoder',
				url: `${parsed.origin}/contests/${
					match[1]
				}/submit?taskScreenName=${encodeURIComponent(match[2])}`,
				values: {},
			};
		}
	}
	if (
		parsed.hostname === 'hydro.ac' &&
		/\/p\/[^/]+\/?$/.test(parsed.pathname)
	) {
		return {
			name: 'hydro',
			url: `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}/submit`,
			values: {},
		};
	}
	if (
		parsed.hostname === 'vjudge.net' &&
		/^\/problem\//.test(parsed.pathname)
	) {
		return { name: 'vjudge', url, values: {} };
	}
	if (
		parsed.hostname === 'www.luogu.com.cn' &&
		/^\/problem\//.test(parsed.pathname)
	) {
		return { name: 'luogu', url, values: {} };
	}
	return undefined;
}

export function resolveUserSubmission(
	url: string,
):
	| { template: SubmissionTemplate; values: SubmissionValues; kind: 'custom' }
	| undefined {
	const config = vscode.workspace.getConfiguration('judger.submission');
	const route = builtinSubmissionRoute(url);
	const target = route?.url ?? url;
	const files = config.get<string[]>('userScripts', []);
	let source: string | undefined;
	for (const file of files) {
		try {
			const contents = fs.readFileSync(file, 'utf8');
			if (matchesUserScript(parseUserScript(contents), target)) {
				source = contents;
				break;
			}
		} catch (error) {
			globalThis.logger?.warn(
				'Cannot load submission userscript',
				file,
				String(error),
			);
		}
	}
	if (!source && route && config.get('builtinScripts', true)) {
		source = fs.readFileSync(
			path.join(
				globalThis.extensionContext.extensionPath,
				'dist/static/userscripts',
				`${route.name}.user.js`,
			),
			'utf8',
		);
	}
	if (!source) {
		return undefined;
	}
	if (!matchesUserScript(parseUserScript(source), target)) {
		return undefined;
	}
	return {
		template: { urlTemplate: target, script: source },
		values: {
			...route?.values,
			url,
			autoSubmit: String(config.get('autoSubmit', false)),
			languageValue:
				config.get<Record<string, string>>('languages', {})[
					new URL(url).hostname
				] ?? '',
		},
		kind: 'custom',
	};
}

export function registerUserScriptCommands(
	context: vscode.ExtensionContext,
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'judger.installSubmissionScript',
			async () => {
				const selected = await vscode.window.showOpenDialog({
					canSelectMany: false,
					filters: { Userscript: ['js'] },
				});
				if (!selected?.[0]) {
					return;
				}
				try {
					const source = fs.readFileSync(selected[0].fsPath, 'utf8');
					parseUserScript(source);
					const directory = path.join(
						context.globalStorageUri.fsPath,
						'userscripts',
					);
					fs.mkdirSync(directory, { recursive: true });
					const file = path.join(
						directory,
						`${crypto
							.createHash('sha256')
							.update(source)
							.digest('hex')}.user.js`,
					);
					fs.writeFileSync(file, source);
					const config =
						vscode.workspace.getConfiguration('judger.submission');
					await config.update(
						'userScripts',
						[
							...new Set([
								file,
								...config.get<string[]>('userScripts', []),
							]),
						],
						vscode.ConfigurationTarget.Global,
					);
					void vscode.window.showInformationMessage(
						localize(
							'judger.script.installed',
							'Submission userscript installed.',
						),
					);
				} catch (error) {
					void vscode.window.showErrorMessage(
						localize(
							'judger.script.invalid',
							'Could not install userscript: {0}',
							String(error),
						),
					);
				}
			},
		),
	);
}

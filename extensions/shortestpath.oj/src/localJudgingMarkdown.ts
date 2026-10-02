/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from './localization';
import type { LocalJudging } from './generated/api-contract';
const headings = { main: localize('\u672C\u5730\u8BC4\u6D4B'), files: localize('\u6240\u9700\u6587\u4EF6'), prepare: localize('\u51C6\u5907'), compile: localize('\u7F16\u8BD1'), run: localize('\u8FD0\u884C'), input: localize('\u672C\u5730\u6D4B\u8BD5\u683C\u5F0F'), result: localize('\u7ED3\u679C\u8BF4\u660E') };
const roles: Record<string, string> = { checker: localize('\u72EC\u7ACB\u68C0\u67E5\u7A0B\u5E8F'), grader: localize('\u672C\u5730\u9A71\u52A8\u7A0B\u5E8F'), header: localize('\u63A5\u53E3\u5934\u6587\u4EF6'), library: localize('\u672C\u5730\u5B9E\u73B0\u5E93') };
const names = { source: 'solution.cpp', input: 'sample.in', answer: 'sample.out', output: 'user.out', program: 'solution.exe', checker: 'checker.exe' };
const platforms = { posix: 'Linux / macOS / WSL', powershell: 'Windows / PowerShell' } as const;
const commands = {
	compile: 'g++ -std=c++20 -O2 -pipe {sources} -o {target}',
	posix_stdin: './{program} < {input}', posix_capture: './{program} < {input} > {output}', posix_file: './{program}', posix_checker: './{checker} {arguments}',
	powershell_stdin: 'cmd /d /c ".\\{program} < {input}"', powershell_capture: 'cmd /d /c ".\\{program} < {input} > {output}"', powershell_file: '.\\{program}', powershell_checker: '.\\{checker} {arguments}',
	init_declaration: 'extern void {function}(const char *fileName);', init_call: '{function}("{input}");',
};
const text: Record<string, string> = {
	prepare: localize('\u4EE5\u4EE3\u7801\u6587\u4EF6\u540D\u4E3A `{source}` \u4F8B\uFF0C\u4E0E\u4E0B\u5217\u6587\u4EF6\u653E\u5728\u540C\u4E00\u76EE\u5F55\uFF1B\u4E0B\u8F7D\u6587\u4EF6\u6309\u5217\u8868\u4E2D\u7684\u540D\u79F0\u4FDD\u5B58\u3002'),
	grader_main: localize('\u53EA\u5B9E\u73B0\u9898\u9762\u8981\u6C42\u7684\u63A5\u53E3\uFF0C\u4E0D\u5B9A\u4E49 `main`\uFF1B\u5165\u53E3\u7531\u672C\u5730\u9A71\u52A8\u63D0\u4F9B\u3002'),
	solution_main: localize('\u6309\u9898\u9762\u8981\u6C42\u5B9A\u4E49 `main`\uFF0C\u5E76\u8C03\u7528\u63D0\u4F9B\u7684\u63A5\u53E3\u3002'),
	init_declaration: localize('\u5728\u4EE3\u7801\u7684\u5168\u5C40\u4F5C\u7528\u57DF\u4E34\u65F6\u52A0\u5165\u58F0\u660E\uFF1A'), init_call: localize('\u5728 `main` \u4E2D\u3001\u7B2C\u4E00\u6B21\u8C03\u7528 `{before}` \u4E4B\u524D\u6267\u884C\uFF1A'),
	init_input: localize('\u8FD9\u91CC\u7684 `{input}` \u662F\u672C\u6B21\u4F7F\u7528\u7684\u6D4B\u8BD5\u8F93\u5165\uFF1B\u5982\u9700\u6D4B\u8BD5\u5176\u4ED6\u6570\u636E\uFF0C\u8BF7\u66FF\u6362\u6210\u5BF9\u5E94\u7684\u6587\u4EF6\u540D\u3002'), init_remove: localize('\u63D0\u4EA4\u524D\u5220\u9664\u8FD9\u4E24\u5904\u672C\u5730\u521D\u59CB\u5316\u4EE3\u7801\u3002'),
	compile: localize('\u8BF7\u6839\u636E\u672C\u673A\u7F16\u8BD1\u5668\u9009\u62E9\u5BF9\u5E94\u7684 C++ \u6807\u51C6\uFF0C\u5EFA\u8BAE\u4F7F\u7528 C++20\u3002\u4EE5\u4E0B\u547D\u4EE4\u4EE5 g++ \u548C C++20 \u4E3A\u4F8B\uFF0C\u4E0D\u540C\u7CFB\u7EDF\u90FD\u53EF\u4EE5\u4F7F\u7528\u4EE5\u4E0B\u7F16\u8BD1\u547D\u4EE4\u3002'),
	checker_run_files: localize('\u4EE5\u4E0B\u547D\u4EE4\u4E2D\uFF0C`{input}` \u662F\u6D4B\u8BD5\u8F93\u5165\uFF0C`{answer}` {answer_description}\uFF1B\u5982\u9700\u6D4B\u8BD5\u5176\u4ED6\u6570\u636E\uFF0C\u8BF7\u66FF\u6362\u6210\u5BF9\u5E94\u7684\u6587\u4EF6\u540D\u3002`{output}` \u7528\u4E8E\u4FDD\u5B58\u7A0B\u5E8F\u8F93\u51FA\u3002'),
	grader_run_files: localize('\u4EE5\u4E0B\u547D\u4EE4\u4E2D\uFF0C`{input}` \u662F\u6D4B\u8BD5\u8F93\u5165\uFF0C`{answer}` \u662F\u4E0E\u5176\u914D\u5957\u7684\u53C2\u8003\u7B54\u6848\uFF08\u82E5\u6709\uFF09\uFF1B\u5982\u9700\u6D4B\u8BD5\u5176\u4ED6\u6570\u636E\uFF0C\u8BF7\u66FF\u6362\u6210\u5BF9\u5E94\u7684\u6587\u4EF6\u540D\u3002'),
	objective_value: localize('\u53EA\u4FDD\u5B58\u4E0E\u5176\u914D\u5957\u7684\u6700\u4F18\u503C'), reference_output: localize('\u662F\u4E0E\u5176\u914D\u5957\u7684\u53C2\u8003\u7B54\u6848'), summary: localize('\u4FDD\u5B58\u4E0E\u5176\u914D\u5957\u7684\u7B54\u6848\u6458\u8981'),
	silent_success: localize('\u68C0\u67E5\u901A\u8FC7\u65F6\u6CA1\u6709\u63D0\u793A\uFF1B\u68C0\u67E5\u5931\u8D25\u65F6\u663E\u793A\u539F\u56E0\u3002'), return_value: localize('\u6807\u51C6\u8F93\u51FA\u4E3A\u51FD\u6570\u8FD4\u56DE\u503C\u3002'), return_sequence: localize('\u6807\u51C6\u8F93\u51FA\u4E3A\u51FD\u6570\u8FD4\u56DE\u7684\u5E8F\u5217\uFF0C\u6BCF\u6B21\u8C03\u7528\u5360\u4E00\u884C\u3002'), compare: localize('\u5982\u6709\u53C2\u8003\u7B54\u6848\uFF0C\u53EF\u4E0E `{answer}` \u6838\u5BF9\u3002'),
};
function format(template: string, values: Record<string, string>): string {
	return template.replace(/\{([a-z_]+)\}/g, (_, key: string) => values[key] ?? '');
}
function code(value: string, language = 'sh'): string { return `\`\`\`${language}\n${value}\n\`\`\``; }
function phrase(key: string, values: Record<string, string> = {}): string { return format(text[key], { ...names, ...values }); }
export function renderLocalJudgingMarkdown(local: LocalJudging): string {
	const parts: string[] = [`## ${headings.main}`];
	const section = (key: keyof typeof headings, body: string) => parts.push(`### ${headings[key]}\n\n${body}`);
	const files = local.files.map((file) => `- [${file.name}](${file.url})：${roles[file.role]}`);
	section('files', `${phrase('prepare')}\n\n${files.join('\n')}`);
	if (local.kind === 'grader' && local.grader) {
		const prepare = [phrase(`${local.grader.entry_point}_main`)];
		if (local.grader.input.mode === 'file_init') {
			prepare.push(phrase('init_declaration'), code(format(commands.init_declaration, { function: local.grader.input.function ?? '' }), 'cpp'), phrase('init_call', { before: local.grader.input.before ?? '' }), code(format(commands.init_call, { ...names, function: local.grader.input.function ?? '' }), 'cpp'), phrase('init_input'), phrase('init_remove'));
		}
		section('prepare', prepare.join('\n\n'));
	}
	const compile: string[] = [];
	let sources: string;
	if (local.kind === 'checker') {
		sources = local.files.filter((file) => file.role !== 'header').map((file) => file.name).join(' ');
		compile.push(format(commands.compile, { sources, target: names.checker }));
		sources = names.source;
	}
	else {
		sources = [names.source, ...local.files.filter((file) => file.role !== 'header').map((file) => file.name)].join(' ');
	}
	compile.push(format(commands.compile, { sources, target: names.program }));
	section('compile', `${phrase('compile')}\n\n${code(compile.join('\n'))}`);
	let runFiles = '';
	if (local.kind === 'checker' && local.checker) {
		runFiles = phrase('checker_run_files', { answer_description: phrase(local.checker.answer_kind) });
	} else if (local.grader?.input.mode !== 'file_init') {
		runFiles = phrase('grader_run_files');
	}
	const runCommands = Object.entries(platforms).map(([platform, label]) => {
		let lines: string[];
		if (local.kind === 'checker' && local.checker) {
			const args = local.checker.arguments.map((key) => names[key as keyof typeof names]).join(' ');
			lines = [format(commands[`${platform}_capture` as keyof typeof commands], names), format(commands[`${platform}_checker` as keyof typeof commands], { ...names, arguments: args })];
		}
		else {
			const mode = local.grader?.input.mode === 'stdin' ? 'stdin' : 'file';
			lines = [format(commands[`${platform}_${mode}` as keyof typeof commands], names)];
		}
		return `**${label}**\n\n${code(lines.join('\n'), platform === 'powershell' ? 'powershell' : 'sh')}`;
	}).join('\n\n');
	section('run', [runFiles, runCommands].filter(Boolean).join('\n\n'));
	if (local.kind === 'checker') {
		section('result', phrase('silent_success'));
	} else if (local.grader) {
		const input = [local.grader.input.format];
		if (local.grader.example?.input) {
			input.push(`**${names.input}**\n\n${code(local.grader.example.input, 'text')}`);
		}
		if (local.grader.example?.output) {
			input.push(`**${names.answer}**\n\n${code(local.grader.example.output, 'text')}`);
		}
		section('input', input.join('\n\n'));
		if (local.grader.output !== 'diagnostics') {
			section('result', `${phrase(local.grader.output)}\n\n${phrase('compare')}`);
		}
	}
	return parts.join('\n\n');
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ImportedProblem } from './shortestpathOjProtocol';
import { LocalTestResult, LocalTestsSnapshot, localTestErrorMessage, isOfficialLocalTest } from './localTests';

type ViewHelpers = { escape(value: string): string; text(value: string): string; markdown(content: string, baseUrl: string): string };

function resultLabel(result: LocalTestResult): string {
	if (result.timeOut) { return '超时'; }
	if (result.outputLimitExceeded) { return '输出超限'; }
	if (result.signal || result.code !== 0 || (result.stderr && result.pass === false && result.stdout === '')) { return '运行错误'; }
	return result.pass === true ? '通过' : result.pass === false ? '答案不符' : '已运行';
}

const icons: Record<string, string> = {
	run: '<path d="m6 3 9 5-9 5Z"/>',
	all: '<path d="m3 3 7 5-7 5Z"/><path d="m10 3 7 5-7 5Z"/>',
	stop: '<rect x="4" y="3" width="10" height="10" rx="1"/>',
	add: '<path d="M9 2v12M3 8h12"/>',
	delete: '<path d="M3 4h12M7 4V2h4v2M5 4l1 10h6l1-10M8 7v4M10 7v4"/>',
	save: '<path d="m3 8 4 4 8-8"/>',
	copy: '<rect x="6" y="5" width="9" height="9" rx="1"/><path d="M11 5V2H3v9h3"/>',
};

function icon(name: string): string {
	return `<svg viewBox="0 0 18 16" width="18" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}

function iconButton(command: string, label: string, name: string, tone: string, text: ViewHelpers['text'], attributes = '', disabled = ''): string {
	return `<button type="button" class="local-test-icon ${tone}" data-command="${command}" title="${text(label)}" aria-label="${text(label)}"${attributes}${disabled}>${icon(name)}</button>`;
}

export function renderLocalTestsToolbar(snapshot: LocalTestsSnapshot | undefined, pending: boolean, text: ViewHelpers['text']): string {
	if (!snapshot) { return ''; }
	const running = snapshot.status !== 'idle';
	const disabled = running || pending ? ' disabled' : '';
	const passed = snapshot.tests.filter(test => test.result?.pass === true).length;
	const summary = snapshot.tests.some(test => test.result) ? `<span class="local-test-count" aria-live="polite">${passed} / ${snapshot.tests.length} ${text('通过')}</span>` : '';
	return `<div class="local-tests-toolbar"><div class="local-tests-status">${summary}${running ? `<span role="status">${text(runStatus(snapshot))}</span>` : ''}</div><div class="local-tests-actions">${iconButton('localTestRunAll', '运行全部', 'all', 'run', text, '', disabled || (!snapshot.tests.length ? ' disabled' : ''))}${running ? iconButton('localTestStop', '停止', 'stop', 'delete', text, '', snapshot.status === 'stopping' ? ' disabled' : '') : ''}${iconButton('localTestNew', '添加用例', 'add', 'add', text, '', disabled)}</div></div>`;
}

function runStatus(snapshot: LocalTestsSnapshot): string {
	return snapshot.status === 'compiling' ? '编译中…' : snapshot.status === 'checking' ? '检查中…' : snapshot.status === 'stopping' ? '正在停止…' : '运行中…';
}

/** Mark differing tokens, preserving the original text for copying. */
function comparedOutput(value: string, other: string, failed: boolean, e: ViewHelpers['escape']): string {
	if (!failed) { return e(value); }
	const tokens = Array.from(value.matchAll(/\S+/g));
	const peers = other.match(/\S+/g) ?? [];
	let start = 0;
	let end = tokens.length;
	let peerEnd = peers.length;
	while (start < end && start < peerEnd && tokens[start][0] === peers[start]) { start++; }
	while (end > start && peerEnd > start && tokens[end - 1][0] === peers[peerEnd - 1]) { end--; peerEnd--; }
	const changed = new Set<number>();
	const rows = end - start;
	const columns = peerEnd - start;
	if (!rows || !columns) {
		for (let i = start; i < end; i++) { changed.add(i); }
	} else if (rows * columns <= 40_000) {
		const dp = Array.from({ length: rows + 1 }, () => new Uint32Array(columns + 1));
		for (let i = 1; i <= rows; i++) {
			for (let j = 1; j <= columns; j++) {
				dp[i][j] = tokens[start + i - 1][0] === peers[start + j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
		let i = rows;
		let j = columns;
		while (i || j) {
			if (i && j && tokens[start + i - 1][0] === peers[start + j - 1]) { i--; j--; }
			else if (j && (!i || dp[i][j - 1] >= dp[i - 1][j])) { j--; }
			else { changed.add(start + --i); }
		}
	} else {
		// Keep comparison cost bounded for large program output.
		for (let i = start; i < end; i++) { if (tokens[i][0] !== peers[i]) { changed.add(i); } }
	}
	let offset = 0;
	let html = '';
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		html += e(value.slice(offset, token.index));
		html += changed.has(i) ? `<span class="local-test-mismatch">${e(token[0])}</span>` : e(token[0]);
		offset = token.index + token[0].length;
	}
	return html + e(value.slice(offset));
}

/** Ordinary samples and custom tests share execution, but supplied samples are immutable. */
export function renderLocalTests(snapshot: LocalTestsSnapshot | undefined, problem: ImportedProblem, error: string | undefined, pending: boolean, helpers: ViewHelpers): string {
	const { escape: e, text: t } = helpers;
	if (problem.localTest?.enabled === false) { return `<p class="warning" data-i18n-ignore>${e(problem.localTest.reason)}</p>`; }
	if (!snapshot) {
		return `<p role="status">${t(error ?? '正在加载本地测试…')}</p>${error ? `<button type="button" data-command="localTestLoad">${t('重试')}</button>` : ''}`;
	}
	const running = snapshot.status !== 'idle';
	const disabled = running || pending ? ' disabled' : '';
	const button = (command: string, label: string, name: string, tone: string, attributes = '', unavailable = disabled) => iconButton(command, label, name, tone, t, attributes, unavailable);
	const copy = (label: string) => `<button type="button" class="copy-btn local-test-icon" title="${t(label)}" aria-label="${t(label)}">${icon('copy')}</button>`;
	const status = runStatus(snapshot);
	const tests = snapshot.tests.map((test, index) => {
		const official = isOfficialLocalTest(test);
		const sample = official ? problem.samples[test.sampleIndex ?? 0] : undefined;
		const number = official ? (test.sampleIndex ?? 0) + 1 : index + 1;
		const title = t(official ? '样例 {0}' : '测试用例 {0}').replace('{0}', String(number));
		const result = test.result;
		const active = running && snapshot.activeId === test.id;
		const label = active ? status : result ? resultLabel(result) : '';
		const resultClass = result?.pass === true ? 'passed' : result ? 'failed' : '';
		const io = (label: string, value: string, html: string, field?: 'input' | 'output') => {
			const preview = `<pre data-i18n-ignore><code>${html}</code></pre>`;
			const content = field && !official ? `<details class="local-test-value" data-persist-key="${field}:${test.id}"><summary title="${t('点击编辑')}" aria-label="${t('点击编辑')} ${t(label)}">${preview}</summary><textarea name="local-${field}-${test.id}" data-local-${field} aria-label="${t(label)}" data-i18n-ignore spellcheck="false"${disabled}>${e(value)}</textarea></details>` : preview;
			return `<div class="io-block${label === '期望输出' ? ' expected' : ''}"><div class="io-header"><h4>${t(label)}</h4>${copy(label === '输入' ? '复制样例输入' : label === '期望输出' ? '复制期望输出' : '复制实际输出')}</div>${content}</div>`;
		};
		const output = `<div class="local-test-output-grid">${io('期望输出', test.output, comparedOutput(test.output, result?.stdout ?? '', result?.pass === false, e), 'output')}${result ? io('实际输出', result.stdout, comparedOutput(result.stdout, test.output, result.pass === false, e)) : ''}</div>`;
		const diagnostics = result?.stderr ? `<details data-persist-key="stderr:${test.id}"><summary>${t('标准错误')}</summary><pre data-i18n-ignore>${e(result.stderr)}</pre></details>` : '';
		const checker = result?.checkerRun ? `<details data-persist-key="checker:${test.id}"><summary>${t('检查器输出')}</summary><pre data-i18n-ignore>${e(result.checkerRun.stdout)}${e(result.checkerRun.stderr)}</pre></details>` : '';
		const attributes = ` data-test-id="${test.id}"`;
		const requested = snapshot.runMode === 'all' || snapshot.runTestId === test.id;
		const expand = requested && snapshot.runId ? `${snapshot.runId}:${test.id}` : '';
		const collapse = snapshot.runMode === 'all' && result?.pass === true ? `${snapshot.runId}:${test.id}:passed` : '';
		return `<details data-persist-key="card:${test.id}" data-auto-expand-key="${expand}" data-auto-collapse-key="${collapse}"${collapse ? '' : ' open'} class="sample local-test ${resultClass}${official ? ' official' : ' custom'}" data-test-id="${test.id}"><summary class="local-test-heading"><h3>${title}</h3><span class="local-test-result ${resultClass}" role="status">${label ? t(label) : ''}${result && Number.isFinite(result.time) ? ` · ${result.time.toFixed(1)} ms` : ''}</span><div class="local-tests-actions">${button('localTestRun', '运行', 'run', 'run', attributes)}${official ? '' : button('localTestSave', '保存用例', 'save', 'save', attributes) + button('localTestDelete', '删除', 'delete', 'delete', attributes)}</div></summary>${io('输入', test.input, e(test.input), 'input')}${output}${diagnostics}${checker}${sample?.explanation.trim() ? `<div class="sample-explanation" data-render-math data-i18n-ignore>${helpers.markdown(sample.explanation, problem.url)}</div>` : ''}</details>`;
	}).join('');
	const add = `<details class="local-test-add" data-persist-key="add-test"><summary class="local-test-add-heading" title="${t('添加用例')}" aria-label="${t('添加用例')}">${icon('add')}<h3 class="local-test-add-title">${t('添加用例')}</h3></summary><div class="io-block"><div class="io-header"><h4>${t('输入')}</h4></div><textarea name="local-new-input" data-local-input aria-label="${t('输入')}" data-i18n-ignore spellcheck="false"${disabled}></textarea></div><div class="local-test-output-grid"><div class="io-block expected"><div class="io-header"><h4>${t('期望输出')}</h4></div><textarea name="local-new-output" data-local-output aria-label="${t('期望输出')}" data-i18n-ignore spellcheck="false"${disabled}></textarea></div></div><div class="local-test-add-actions">${button('localTestAdd', '添加', 'save', 'save')}</div></details>`;
	const message = error ?? (snapshot.error ? localTestErrorMessage(snapshot.error) : undefined);
	const compile = snapshot.diagnostics ? `<details class="local-test-diagnostics" data-persist-key="compile-diagnostics"${snapshot.error ? ' open' : ''}><summary>${t('编译及运行信息')}</summary><pre data-i18n-ignore>${e(snapshot.diagnostics)}</pre></details>` : '';
	return `${message ? `<p class="error" role="alert">${t(message)}</p>` : ''}${compile}${tests || `<p>${t('暂无测试用例，可以添加用例。')}</p>`}${add}`;
}

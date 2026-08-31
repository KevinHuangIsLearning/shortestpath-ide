/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

const english: Readonly<Record<string, string>> = {
	'提交代码': 'Submit Code',
	'关闭': 'Close',
	'关闭兼容性提示': 'Close compatibility warning',
	'操作长时间没有响应，可能是因为触发了安全验证，请到浏览器处理。': 'The operation has not responded for a long time, possibly because it triggered verification. Complete it in the browser.',
	'核心算法': 'Core Algorithm',
	'辅助算法': 'Auxiliary Algorithms',
	'暂无标签': 'No tags',
	'时间限制': 'Time Limit',
	'内存限制': 'Memory Limit',
	'题目难度': 'Difficulty',
	'题目标签': 'Tags',
	'题目描述': 'Description',
	'输入格式': 'Input',
	'输出格式': 'Output',
	'数据范围': 'Constraints',
	'样例': 'Sample',
	'样例输入': 'Sample Input',
	'样例输出': 'Sample Output',
	'复制': 'Copy',
	'已复制': 'Copied',
	'提示': 'Hint',
	'解题报告': 'Editorial',
	'正在加载解题报告…': 'Loading editorial…',
	'加载中…': 'Loading…',
	'正在提交…': 'Submitting…',
	'查看解题报告': 'View Editorial',
	'提示回顾': 'Hints',
	'简化题解': 'Concise Solution',
	'详细题解': 'Detailed Solution',
	'参考代码': 'Reference Code',
	'问题': 'Question',
	'答案': 'Answer',
	'点赞': 'Like',
	'取消点赞': 'Unlike',
	'确认提交': 'Confirm Submission',
	'等待网页同步': 'Waiting for website synchronization',
	'等待网页同步。': 'Waiting for website synchronization.',
	'测试点': 'Test',
	'状态': 'Status',
	'时间': 'Time',
	'内存': 'Memory'
	, '解题报告已打开，但未能保存到本地缓存；请稍后重新打开。': 'The editorial opened, but could not be saved to the local cache. Please reopen it later.'
	, '题目视图': 'Problem View'
	, '题面': 'Problem Statement'
	, '评测': 'Submissions'
	, '已连接题目网页。': 'Connected to the problem webpage.'
	, '等待用户从网站重新发送题目。': 'Waiting for the website to resend the problem.'
	, '暂无内容。': 'No content.'
	, '已查看答案': 'Answer viewed'
	, '已解锁': 'Unlocked'
	, '提示尚未解锁': 'Hint locked'
	, '提示问题尚未解锁。': 'The hint question is still locked.'
	, '显示答案': 'Show Answer'
	, '关闭提示': 'Close Hint'
	, '调整题解和参考代码宽度': 'Resize editorial and reference code'
	, '此提交来自本地保存的历史记录，未存储具体评测信息，因此没有更多可用信息。': 'This submission comes from locally saved history. Detailed judging data was not stored.'
	, '评测转发已断开；后端任务状态未知，请重新连接并恢复观察。': 'The judging relay disconnected. Reconnect and resume watching to learn the backend task status.'
	, '恢复观察': 'Resume Watching'
	, '已有提交 ID': 'Existing submission ID'
	, '暂无评测记录。': 'No submissions.'
	, '运行中，网站尚未提供轮数进度': 'Running; the website has not provided round progress.'
	, '反例': 'Counterexample'
	, '输入': 'Input'
	, '期望输出': 'Expected Output'
	, '实际输出': 'Actual Output'
	, '对拍转发已断开；后端任务仍可能继续，请重新连接并刷新对拍上下文。': 'The stress-test relay disconnected. The backend task may still be running; reconnect and refresh the stress-test context.'
	, '提交出现 WA，可以使用对拍找到错误数据。': 'The submission received WA. Use stress testing to find a counterexample.'
	, '发起对拍': 'Start Stress Test'
	, 'ShortestPath OJ 集成无法启动：端口 {0} 已被占用。请关闭占用该端口的程序后重启 ShortestPath IDE。': 'ShortestPath OJ integration cannot start: port {0} is already in use. Close the program using it and restart ShortestPath IDE.'
	, '网页连接已断开，请从网站重新打开。': 'The webpage connection was lost. Reopen the problem from the website.'
	, '正在通过网页提交；如浏览器出现安全验证，请在浏览器中完成。': 'Submitting through the webpage. Complete any browser verification if prompted.'
	, '请先打开当前提示后再查看答案。': 'Open the current hint before viewing its answer.'
	, '网站尚未确认提示答案可查看。': 'The website has not confirmed that the hint answer is available.'
	, '测评中': 'Judging'
	, '已添加到 CPH': 'Added to CPH'
	, '正在添加到 CPH…': 'Adding to CPH…'
	, '添加到 CPH': 'Add to CPH'
	, '确认查看': 'View Anyway'
	, '确认查看吗？': 'View the editorial?'
	, '取消': 'Cancel'
	, '继续': 'Continue'
	, '重试': 'Retry'
	, '新建提交': 'Create New Submission'
	, '上一次对拍启动结果未知。再次发起可能创建另一个任务，是否继续？': 'The previous stress-test start result is unknown. Starting again may create another task. Continue?'
	, '请先在 ShortestPath IDE 中打开一个文件夹，再从网站导入题目。': 'Open a folder in ShortestPath IDE before importing a problem from the website.'
	, '提交 ID 必须是十进制字符串。': 'The submission ID must be a decimal string.'
	, '请选择可用提交并填写正整数轮数。': 'Select an available submission and enter a positive number of rounds.'
	, '当前对拍任务还没有可添加的反例。': 'The current stress-test task has no counterexample to add.'
	, '当前连接尚未导入题目。': 'No problem has been imported from the current connection.'
	, '当前 CPH 活动题目不是 ShortestPath OJ 题目。': 'The active CPH problem is not a ShortestPath OJ problem.'
	, '网页未提供可用的提交语言，无法发起提交。': 'The webpage did not provide an available submission language.'
	, '题目网页未连接，请从网站重新在 ShortestPath IDE 中打开。': 'The problem webpage is disconnected. Reopen it in ShortestPath IDE from the website.'
	, '请先将题目导入 CPH Plus 再从题目面板提交。': 'Import the problem into CPH Plus before submitting from the problem panel.'
	, '提交前请先保存源文件。': 'Save the source file before submitting.'
	, '源文件为空。': 'The source file is empty.'
	, '提交源码必须位于当前工作区。': 'The submission source file must be inside the current workspace.'
	, '请先将题目添加到 CPH。': 'Add the problem to CPH first.'
	, '当前对拍任务没有反例。': 'The current stress-test task has no counterexample.'
	, '无法将反例添加到 CPH。': 'Could not add the counterexample to CPH.'
	, '无法连接 CPH，请确认 CPH Plus 已启用。': 'Could not connect to CPH. Make sure CPH Plus is enabled.'
	, '网页提供的题目状态不兼容，已关闭计时、提示和题解等辅助功能。': 'The problem state provided by the webpage is incompatible. Timer, hints, editorial, and related features have been disabled.'
	, '网页提供的功能信息不兼容，已关闭提交、对拍等增强功能。': 'The capability information provided by the webpage is incompatible. Submission, stress testing, and related features have been disabled.'
	, '选择 ShortestPath OJ 提交语言': 'Select ShortestPath OJ Submission Language'
	, '使用网站当前提供的语言': 'Use a language currently provided by the website'
	, '{0} & ShortestPath OJ 上的 {1}': '{0} & {1} on ShortestPath OJ'
	, '{0}题面': '{0} Problem Statement'
	, '旧题目缓存的键 {0} 与题目路径 {1} 不一致。': 'The legacy problem cache key {0} does not match the problem path {1}.'
	, '拒绝提交工作区之外的文件：{0}': 'Refusing to submit a file outside the workspace: {0}'
	, '网站操作结果未知，请先查看网页状态。': 'The website operation result is unknown. Check the webpage status first.'
	, '提示答案响应与请求不匹配。': 'The hint-answer response does not match the request.'
	, '点赞响应与请求不匹配。': 'The like response does not match the request.'
	, '提交响应的语言与请求不匹配。': 'The submission response language does not match the request.'
	, '观察提交响应与请求不匹配。': 'The submission-watch response does not match the request.'
	, '对拍响应的提交 ID 与请求不匹配。': 'The stress-test response submission ID does not match the request.'
	, '会话已被另一道题替换。': 'The session was replaced by another problem.'
	, '当前会话已有一个提交请求正在处理。': 'The current session already has a submission request in progress.'
	, '响应会话与当前活动题目不匹配。': 'The response session does not match the active problem.'
	, '题目网页连接已断开。': 'The problem webpage connection was closed.'
	, '题目导入超时。': 'Problem import timed out.'
	, '消息必须是 JSON 对象。': 'The message must be a JSON object.'
	, '提示答案响应无效。': 'The hint-answer response is invalid.'
	, '点赞响应无效。': 'The like response is invalid.'
	, '解题报告响应无效。': 'The editorial response is invalid.'
	, '提交响应无效。': 'The submission response is invalid.'
	, '观察提交响应无效。': 'The submission-watch response is invalid.'
	, '对拍上下文响应无效。': 'The stress-test context response is invalid.'
	, '启动对拍响应无效。': 'The stress-test start response is invalid.'
	, '提交快照无效。': 'The submission snapshot is invalid.'
	, '允许的精度误差：{0}': 'Allowed precision error: {0}'
};

export function localizeFormat(value: string, ...args: string[]): string {
	let result = localize(value);
	args.forEach((arg, index) => result = result.replace(`{${index}}`, arg));
	return result;
}

export function localize(value: string): string {
	if (vscode.env.language.toLowerCase().startsWith('zh')) {
		return value;
	}
	return english[value]
		?? value
			.replace(/^请求超时：(.+)$/, 'Request timed out: $1')
			.replace(/^响应类型不匹配：应为 (.+)，实际为 (.+)。$/, 'Response type mismatch: expected $1, received $2.')
			.replace(/^题目路径过长，无法生成跨平台安全的缓存文件名：(.+)。$/, 'The problem path is too long for a cross-platform-safe cache file name: $1.')
			.replace(/^题目缓存文件名冲突：(.+) 与 (.+)。$/, 'Problem cache file-name collision: $1 and $2.')
			.replace(/^(.+) 必须是数组。$/, '$1 must be an array.')
			.replace(/^(.+) 必须是 Markdown 内容。$/, '$1 must be Markdown content.')
			.replace(/^(.+) 必须是非空字符串。$/, '$1 must be a non-empty string.')
			.replace(/^(.+) 必须是十进制字符串。$/, '$1 must be a decimal string.')
			.replace(/^(.+) 必须是字符串。$/, '$1 must be a string.')
			.replace(/^(.+) 必须是布尔值。$/, '$1 must be a boolean.')
			.replace(/^(.+) 必须是非负数。$/, '$1 must be a non-negative number.')
			.replace(/^(.+) 必须是数字。$/, '$1 must be a number.')
			.replace(/^(.+) 必须是整数。$/, '$1 must be an integer.')
			.replace(/^(.+) 必须是正整数。$/, '$1 must be a positive integer.')
			.replace(/^(.+) 的值无效。$/, '$1 has an invalid value.')
			.replace(/^(.+) 不能重复。$/, '$1 must not contain duplicates.')
			.replace(/^(.+) 无效。$/, '$1 is invalid.');
}

export function localizeWebviewHtml(html: string): string {
	if (vscode.env.language.toLowerCase().startsWith('zh')) {
		return html;
	}
	const strings = JSON.stringify(english).replace(/</g, '\\u003c');
	const nonce = randomBytes(16).toString('base64');
	const script = `<script nonce="${nonce}">(()=>{const strings=${strings};const ignoredText=new Set(['CODE','PRE','SCRIPT','STYLE','TEXTAREA','INPUT']);const translate=value=>{if(strings[value])return strings[value];return value.replace(/^样例 (\\d+)$/,'Sample $1').replace(/^提示 (\\d+)，已查看答案$/,'Hint $1, answer viewed').replace(/^提示 (\\d+)，已解锁$/,'Hint $1, unlocked').replace(/^提示 (\\d+)，提示尚未解锁$/,'Hint $1, locked').replace(/^提示 (\\d+)$/,'Hint $1').replace(/^提示尚未解锁，剩余 (.+)。$/,'The hint is locked. Remaining: $1.').replace(/^解题报告尚未解锁，剩余 (.+)$/,'The editorial is locked. Remaining $1').replace(/^查看提示后仍需等待，剩余 (.+)$/,'You must still wait after viewing hints. Remaining $1').replace(/^解题报告暂不可查看：(.+)。$/,'The editorial is temporarily unavailable: $1.').replace(/^剩余 (.+)$/,'Remaining $1').replace(/^(\\d+) 个标签$/,'$1 tags').replace(/^复制样例输入$/,'Copy sample input').replace(/^复制样例输出$/,'Copy sample output').replace(/^点赞提示问题，当前 (\\d+) 赞$/,'Like hint question, currently $1 likes').replace(/^点赞提示答案，当前 (\\d+) 赞$/,'Like hint answer, currently $1 likes').replace(/^取消点赞提示问题，当前 (\\d+) 赞$/,'Unlike hint question, currently $1 likes').replace(/^取消点赞提示答案，当前 (\\d+) 赞$/,'Unlike hint answer, currently $1 likes').replace(/^上一次提交结果未知。重试将原样提交 (.+)，并复用同一个操作 ID。$/,'The previous submission result is unknown. Retry will submit $1 unchanged and reuse the same operation ID.').replace(/^拒绝提交工作区之外的文件：(.+)$/,'Refusing to submit a file outside the workspace: $1').replace(/^旧题目缓存的键 (.+) 与题目路径 (.+) 不一致。$/,'The legacy problem cache key $1 does not match the problem path $2.').replace(/^结果已结束，详情暂不可用：(.+)$/,'The result has finished, but details are unavailable: $1').replace(/^提交 (.+) · (.+)$/,'Submission $1 · $2').replace(/^对拍任务 (.+) · (.+)$/,'Stress test $1 · $2').replace(/ 分 · /g,' points · ');};const visit=node=>{if(node.nodeType===Node.TEXT_NODE){const parent=node.parentElement;if(parent&&!ignoredText.has(parent.tagName)&&!parent.closest('[data-i18n-ignore]')){const current=node.nodeValue||'';const translated=translate(current);if(translated!==current)node.nodeValue=translated;}return;}if(!(node instanceof HTMLElement)||node.closest('[data-i18n-ignore]'))return;for(const attribute of ['aria-label','placeholder','title']){if(node.hasAttribute(attribute)){const current=node.getAttribute(attribute)||'';const translated=translate(current);if(translated!==current)node.setAttribute(attribute,translated);}}if(ignoredText.has(node.tagName))return;node.childNodes.forEach(visit);};document.documentElement.lang='en';visit(document.body);new MutationObserver(records=>records.forEach(record=>{if(record.type==='characterData')visit(record.target);else if(record.type==='attributes')visit(record.target);else record.addedNodes.forEach(visit)})).observe(document.body,{childList:true,characterData:true,attributes:true,subtree:true,attributeFilter:['aria-label','placeholder','title']});})();</script>`;
	const htmlWithNonce = /script-src[^;]*'unsafe-inline'/.test(html)
		? html
		: html.replace(/(script-src[^;]*)(;)/, `$1 'nonce-${nonce}'$2`);
	return htmlWithNonce.replace('</body>', `${script}</body>`);
}

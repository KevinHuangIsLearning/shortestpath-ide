/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

const english: Readonly<Record<string, string>> = {
	'点击编辑': 'Click to edit',
	'题目自带样例不能修改或删除。': 'The problem samples cannot be edited or deleted.',
	'测试用例 {0}': 'Test Case {0}',
	'复制期望输出': 'Copy expected output',
	'复制实际输出': 'Copy actual output',
	'正在加载本地测试…': 'Loading local tests…',
	'运行全部': 'Run All',
	'运行中…': 'Running…',
	'编译中…': 'Compiling…',
	'检查中…': 'Checking…',
	'正在停止…': 'Stopping…',
	'停止': 'Stop',
	'添加用例': 'Add Test Case',
	'添加': 'Add',
	'编辑用例': 'Edit Test Case',
	'保存用例': 'Save Test Case',
	'通过': 'Passed',
	'答案不符': 'Wrong Answer',
	'运行错误': 'Runtime Error',
	'超时': 'Time Limit Exceeded',
	'输出超限': 'Output Limit Exceeded',
	'已运行': 'Finished',
	'标准错误': 'Standard Error',
	'检查器输出': 'Checker Output',
	'输出差异': 'Output Difference',
	'行': 'Line',
	'编译及运行信息': 'Compilation and Execution Details',
	'暂无测试用例，可以添加用例。': 'No test cases yet. Add a test case to begin.',
	'请先停止正在进行的测试。': 'Stop the current test run first.',
	'未找到该文件的本地测试数据。': 'Local test data for this file was not found.',
	'没有可运行的测试用例。': 'There are no test cases to run.',
	'编译失败': 'Compilation Failed',
	'本地测试执行失败': 'Local Test Failed',
	'测试输入或期望输出无效。': 'Invalid test input or expected output.',
	'交互题不支持本地样例运行。': 'Interactive problems do not support local sample runs.',
	'本地测试暂时不可用，请重试。': 'Local testing is unavailable. Try again.',
	'删除这个测试用例？': 'Delete this test case?',
	'未找到该题目的本地代码文件。': 'The local source file for this problem was not found.',
	'已添加到样例': 'Added to test cases',
	'正在添加到样例…': 'Adding to test cases…',
	'添加到样例': 'Add to Test Cases',
	'请去网页登录': 'Sign in on the website',
	'请去网页登录原账号': 'Sign in with the original account',
	'请去网页完成验证': 'Complete verification on the website',
	'请去网页登录或完成验证': 'Sign in or complete verification on the website',
	'样例 {0}': 'Sample {0}',
	'所需文件': 'Required Files',
	'准备': 'Preparation',
	'编译': 'Compile',
	'运行': 'Run',
	'本地测试格式': 'Local Test Format',
	'结果说明': 'Result Description',
	'独立检查程序': 'Standalone Checker',
	'本地驱动程序': 'Local Driver',
	'接口头文件': 'Interface Header',
	'本地实现库': 'Local Library',
	'以代码文件名为 `{source}` 例，与下列文件放在同一目录；下载文件按列表中的名称保存。': 'Use `{source}` as the source filename and put these files in the same directory. Save downloaded files with the listed names.',
	'只实现题面要求的接口，不定义 `main`；入口由本地驱动提供。': 'Implement the required interface without defining `main`; the local driver provides the entry point.',
	'按题面要求定义 `main`，并调用提供的接口。': 'Define `main` as required by the statement and call the provided interface.',
	'在代码的全局作用域临时加入声明：': 'Temporarily add this declaration at global scope:',
	'在 `main` 中、第一次调用 `{before}` 之前执行：': 'In `main`, before the first call to `{before}`, run:',
	'这里的 `{input}` 是本次使用的测试输入；如需测试其他数据，请替换成对应的文件名。': '`{input}` is the test input. Replace it to test other data.',
	'提交前删除这两处本地初始化代码。': 'Remove both local initialization additions before submitting.',
	'请根据本机编译器选择对应的 C++ 标准，建议使用 C++20。以下命令以 g++ 和 C++20 为例，不同系统都可以使用以下编译命令。': 'Choose the C++ standard supported by your compiler. C++20 is recommended; these commands use g++ and C++20 on each platform.',
	'以下命令中，`{input}` 是测试输入，`{answer}` {answer_description}；如需测试其他数据，请替换成对应的文件名。`{output}` 用于保存程序输出。': '`{input}` is the test input; `{answer}` {answer_description}. Replace both for other test data. `{output}` stores the program output.',
	'以下命令中，`{input}` 是测试输入，`{answer}` 是与其配套的参考答案（若有）；如需测试其他数据，请替换成对应的文件名。': '`{input}` is the test input; `{answer}` is its reference answer, if available. Replace them for other data.',
	'只保存与其配套的最优值': 'stores only the corresponding optimal value',
	'是与其配套的参考答案': 'is the corresponding reference answer',
	'保存与其配套的答案摘要': 'stores the corresponding answer summary',
	'检查通过时没有提示；检查失败时显示原因。': 'A successful check prints nothing; a failed check explains the reason.',
	'标准输出为函数返回值。': 'Standard output contains the function return value.',
	'标准输出为函数返回的序列，每次调用占一行。': 'Standard output contains the returned sequence, with one call per line.',
	'如有参考答案，可与 `{answer}` 核对。': 'Compare with `{answer}` if a reference answer is available.',
	'已有订正任务已结束，是否重新订正？': 'The previous correction has finished. Start a new correction?',
	'重新订正': 'Retry Correction',
	'比赛结果暂未公开': 'Contest Results Are Hidden',
	'等待比赛结果公开': 'Waiting for contest results to become public',
	'反例已截断，只能查看，不能加入本地测试。': 'The counterexample is truncated. It can be viewed but cannot be used as a local test.',
	'交互轨迹': 'Interaction Trace',
	'费用': 'Cost',
	'AI 订正': 'AI Correction',
	'退款': 'Refund',
	'诊断': 'Diagnosis',
	'另存订正源码': 'Save Corrected Source As',
	'AI 订正暂不可用。': 'AI correction is currently unavailable.',
	'源码与题目内容将由外部 AI 服务处理，请确认继续。': 'An external AI service will process the source and problem content. Confirm to continue.',
	'确认订正': 'Confirm Correction',
	'题目评价': 'Problem Rating',
	'好': 'Good',
	'一般': 'Average',
	'差': 'Bad',
	'{0}，{1} 人': '{0}, {1} people',
	'连接恢复后可评价': 'Rate after the connection is restored',
	'保存中…': 'Saving…',
	'评价暂时不可用': 'Ratings are temporarily unavailable',
	'正在加载评价…': 'Loading ratings…',
	'AC 或计时满 5 小时后可评价': 'Rate after AC or 5 hours of solving',
	'已评价：{0}，可点击修改': 'Rated: {0}. Click to change',
	'这道题怎么样？': 'How was this problem?',
	'首次 AC，恭喜！': 'First AC, congratulations!',
	'这道题体验如何？留下你的评价吧。': 'How was solving this problem? Leave your rating.',
	'稍后再说': 'Maybe Later',
	'评价响应无效。': 'Invalid rating response.',
	'评分规则': 'Scoring Rules',
	'交互协议': 'Interaction Protocol',
	'用户输出': 'Solver Output',
	'交互器回复': 'Interactor Reply',
	'限制要求': 'Requirements',
	'固定隐藏内容': 'Fixed Hidden Contents',
	'交互样例': 'Interaction Samples',
	'公开评测接口': 'Public Judge Interface',
	'本地评测': 'Local Testing',
	'确认发起': 'Confirm Start',
	'上一次对拍结果未知，请先在网页查看任务记录。': 'The previous stress-test result is unknown. Check task history on the website first.',

	'提交代码': 'Submit Code',
	'在网页中查看': 'View on Website',
	'选择代码保存文件夹': 'Choose a Folder for Your Code',
	'使用此文件夹': 'Use This Folder',
	'正在打开代码保存文件夹，题目将自动恢复。': 'Opening the code folder. Your problem will resume automatically.',
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
	'弹框查看（代码在右）': 'Open Popup (Code on Right)',
	'弹框查看': 'Open in Dialog',
	'解题报告尚未解锁，': 'The editorial is locked. ',
	'查看提示后仍需等待，': 'You must still wait after viewing hints. ',
	'解题报告尚未解锁。': 'The editorial is still locked.',
	'正在迁移配置': 'Migrating configuration',
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
	, '题面版本': 'Statement Version'
	, '当前': 'Current'
	, '旧版 {0}': 'Old {0}'
	, '删除旧版题面': 'Delete Previous Statement'
	, '确认删除当前旧版题面吗？': 'Delete this previous statement?'
	, '删除': 'Delete'
	, '评测': 'Submissions'
	, '已连接题目网页。': 'Connected to the problem webpage.'
	, '正在重新连接…': 'Reconnecting…'
	, '登录后继续': 'Sign in to continue'
	, '请登录原账号后继续': 'Sign in with the original account to continue'
	, '暂时无法连接': 'Unable to connect right now'
	, '登录': 'Sign in'
	, '等待用户从网站重新发送题目。': 'Waiting for the website to resend the problem.'
	, '暂无内容。': 'No content.'
	, '已查看答案': 'Answer viewed'
	, '已解锁': 'Unlocked'
	, '提示尚未解锁': 'Hint locked'
	, '查看提示': 'View hint'
	, '提示问题尚未解锁。': 'The hint question is still locked.'
	, '显示答案': 'Show Answer'
	, '关闭提示': 'Close Hint'
	, '调整题解和参考代码宽度': 'Resize editorial and reference code'
	, '评测转发已断开；后端任务状态未知，请重新连接并恢复观察。': 'The judging relay disconnected. Reconnect and resume watching to learn the backend task status.'
	, '连接恢复后将继续更新评测结果。': 'Judging results will continue updating once the connection is restored.'
	, '恢复观察': 'Resume Watching'
	, '已有提交 ID': 'Existing submission ID'
	, '暂无评测记录。': 'No submissions.'
	, '对拍中…': 'Stress testing…'
	, '发现反例': 'Counterexample Found'
	, '未发现反例': 'No Counterexample Found'
	, '对拍超时': 'Stress Test Timed Out'
	, '对拍失败': 'Stress Test Failed'
	, '反例': 'Counterexample'
	, '输入': 'Input'
	, '期望输出': 'Expected Output'
	, '实际输出': 'Actual Output'
	, '对拍转发已断开；后端任务仍可能继续，请重新连接并刷新对拍上下文。': 'The stress-test relay disconnected. The backend task may still be running; reconnect and refresh the stress-test context.'
	, '连接恢复后将继续更新对拍结果。': 'Stress-test results will continue updating once the connection is restored.'
	, '提交出现 WA，可以使用对拍找到错误数据。': 'The submission received WA. Use stress testing to find a counterexample.'
	, '发起对拍': 'Start Stress Test'
	, 'ShortestPath OJ 集成无法启动：端口 {0} 已被占用。请关闭占用该端口的程序后重启 ShortestPath IDE。': 'ShortestPath OJ integration cannot start: port {0} is already in use. Close the program using it and restart ShortestPath IDE.'
	, '网页连接已断开，请从网站重新打开。': 'The webpage connection was lost. Reopen the problem from the website.'
	, '正在通过网页提交；如浏览器出现安全验证，请在浏览器中完成。': 'Submitting through the webpage. Complete any browser verification if prompted.'
	, '请先打开当前提示后再查看答案。': 'Open the current hint before viewing its answer.'
	, '网站尚未确认提示答案可查看。': 'The website has not confirmed that the hint answer is available.'
	, '测评中': 'Judging'
	, '已添加到 Judger': 'Added to Judger'
	, '正在添加到 Judger…': 'Adding to Judger…'
	, '添加到 Judger': 'Add to Judger'
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
	, '当前 Judger 活动题目不是 ShortestPath OJ 题目。': 'The active Judger problem is not a ShortestPath OJ problem.'
	, '网页未提供可用的提交语言，无法发起提交。': 'The webpage did not provide an available submission language.'
	, '题目网页未连接，请从网站重新在 ShortestPath IDE 中打开。': 'The problem webpage is disconnected. Reopen it in ShortestPath IDE from the website.'
	, '正在恢复题目连接，请稍后重试。': 'Restoring the problem connection. Please try again shortly.'
	, '请先将题目导入 ShortestPath Judger 再从题目面板提交。': 'Import the problem into ShortestPath Judger before submitting from the problem panel.'
	, '提交前请先保存源文件。': 'Save the source file before submitting.'
	, '源文件为空。': 'The source file is empty.'
	, '提交源码必须位于当前工作区。': 'The submission source file must be inside the current workspace.'
	, '请先将题目添加到 Judger。': 'Add the problem to Judger first.'
	, '当前对拍任务没有反例。': 'The current stress-test task has no counterexample.'
	, '无法将反例添加到 Judger。': 'Could not add the counterexample to Judger.'
	, '无法连接 Judger，请确认 ShortestPath Judger 已启用。': 'Could not connect to Judger. Make sure ShortestPath Judger is enabled.'
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

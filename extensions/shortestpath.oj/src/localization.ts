/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

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
	,'解题报告已打开，但未能保存到本地缓存；请稍后重新打开。': 'The editorial opened, but could not be saved to the local cache. Please reopen it later.'
	,'ShortestPath OJ 集成无法启动：端口 {0} 已被占用。请关闭占用该端口的程序后重启 ShortestPath IDE。': 'ShortestPath OJ integration cannot start: port {0} is already in use. Close the program using it and restart ShortestPath IDE.'
};

export function localizeFormat(value: string, ...args: string[]): string {
	let result = localize(value);
	args.forEach((arg, index) => result = result.replace(`{${index}}`, arg));
	return result;
}

export function localize(value: string): string {
	return vscode.env.language.toLowerCase().startsWith('zh') ? value : (english[value] ?? value);
}

export function localizeWebviewHtml(html: string): string {
	if (vscode.env.language.toLowerCase().startsWith('zh')) {
		return html;
	}
	const strings = JSON.stringify(english).replace(/</g, '\\u003c');
	const script = `<script>(()=>{const strings=${strings};const ignored=new Set(['CODE','PRE','SCRIPT','STYLE','TEXTAREA','INPUT']);const translate=value=>{if(strings[value])return strings[value];return value.replace(/^样例 (\\d+)$/,'Sample $1').replace(/^提示 (\\d+)$/,'Hint $1');};const visit=node=>{if(node.nodeType===Node.TEXT_NODE){const parent=node.parentElement;if(parent&&!ignored.has(parent.tagName)&&!parent.closest('[data-i18n-ignore]'))node.nodeValue=translate(node.nodeValue||'');return;}if(!(node instanceof HTMLElement)||ignored.has(node.tagName)||node.closest('[data-i18n-ignore]'))return;for(const attribute of ['aria-label','placeholder','title']){if(node.hasAttribute(attribute))node.setAttribute(attribute,translate(node.getAttribute(attribute)||''));}node.childNodes.forEach(visit);};document.documentElement.lang='en';visit(document.body);new MutationObserver(records=>records.forEach(record=>{if(record.type==='characterData')visit(record.target);else if(record.type==='attributes')visit(record.target);else record.addedNodes.forEach(visit)})).observe(document.body,{childList:true,characterData:true,attributes:true,subtree:true,attributeFilter:['aria-label','placeholder','title']});})();</script>`;
	return html.replace('</body>', `${script}</body>`);
}

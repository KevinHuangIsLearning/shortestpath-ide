/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const english = {
	title: 'Sketchpad', loading: 'Loading sketchpad…', saved: 'Saved locally', saving: 'Saving…',
	unsaved: 'Changes have not been saved', saveFailed: 'Could not save the sketchpad. Retry or export a copy.',
	loadFailed: 'Could not restore the sketchpad. Your saved draft has been kept.',
	retry: 'Retry', clear: 'New Draft', clearPrompt: 'Clear the current draft? Export a copy first if you want to keep it.',
	clearAction: 'Clear', import: 'Import', export: 'Export', beside: 'Draw beside Code', mode: 'Open Sketchpad Mode',
	importFailed: 'Could not import the drawing.', importPrompt: 'Replace the current draft with the imported drawing?',
	importAction: 'Replace', actionFailed: 'Could not complete the sketchpad action: {0}',
	exportTitle: 'Export Drawing', importTitle: 'Import Drawing', image: 'PNG Image', vector: 'SVG Image',
	drawing: 'Excalidraw Drawing', empty: 'Draw a graph, tree, or a few notes to work through a problem.',
	libraryNames: {
		'shortestpath-competition-array-10': 'Array · 10 Cells',
		'shortestpath-competition-indexed-array-10': 'Indexed Array · 10 Cells',
		'shortestpath-competition-grid-3': 'Grid · 3 × 3',
		'shortestpath-competition-grid-5': 'Grid · 5 × 5',
		'shortestpath-competition-binary-tree-3': 'Binary Tree · 3 Nodes',
		'shortestpath-competition-binary-tree-7': 'Binary Tree · 7 Nodes',
		'shortestpath-competition-linked-list-5': 'Linked List · 5 Nodes',
		'shortestpath-competition-key-value-table-5': 'Key-Value Table · 5 Rows',
		'shortestpath-competition-undirected-graph-6': 'Undirected Graph · 6 Vertices',
		'shortestpath-competition-diamond-graph-4': 'Diamond Graph · 4 Vertices',
		'shortestpath-competition-first-quadrant': 'First-Quadrant Axes',
		'shortestpath-competition-four-quadrants': 'Four-Quadrant Axes',
		'shortestpath-competition-number-line': 'Number Line',
		'shortestpath-competition-venn-diagram': 'Two-Set Venn Diagram',
		'shortestpath-competition-triangle': 'Triangle',
		'shortestpath-competition-hexagon': 'Hexagon',
	},
};

export type DrawStrings = typeof english;

const chinese: DrawStrings = {
	title: '草稿', loading: '正在加载草稿…', saved: '已保存在本机', saving: '正在保存…',
	unsaved: '改动尚未保存', saveFailed: '草稿保存失败，请重试或导出备份。',
	loadFailed: '无法恢复草稿，已保留原有草稿文件。',
	retry: '重试', clear: '新草稿', clearPrompt: '清空当前草稿？如需保留，请先导出备份。',
	clearAction: '清空', import: '导入', export: '导出', beside: '与代码并排', mode: '打开草稿模式',
	importFailed: '无法导入画图文件。', importPrompt: '用导入的画图文件替换当前草稿？',
	importAction: '替换', actionFailed: '无法完成草稿操作：{0}',
	exportTitle: '导出画图', importTitle: '导入画图', image: 'PNG 图片', vector: 'SVG 图片',
	drawing: 'Excalidraw 画图', empty: '画图、画树，或记下几步推演，理清题目思路。',
	libraryNames: {
		'shortestpath-competition-array-10': '数组 · 10 格',
		'shortestpath-competition-indexed-array-10': '带下标数组 · 10 格',
		'shortestpath-competition-grid-3': '网格 · 3 × 3',
		'shortestpath-competition-grid-5': '网格 · 5 × 5',
		'shortestpath-competition-binary-tree-3': '二叉树 · 3 节点',
		'shortestpath-competition-binary-tree-7': '二叉树 · 7 节点',
		'shortestpath-competition-linked-list-5': '单链表 · 5 节点',
		'shortestpath-competition-key-value-table-5': '键值表 · 5 行',
		'shortestpath-competition-undirected-graph-6': '无向图 · 6 顶点',
		'shortestpath-competition-diamond-graph-4': '菱形图 · 4 顶点',
		'shortestpath-competition-first-quadrant': '第一象限坐标轴',
		'shortestpath-competition-four-quadrants': '四象限坐标轴',
		'shortestpath-competition-number-line': '数轴',
		'shortestpath-competition-venn-diagram': '两集合 Venn 图',
		'shortestpath-competition-triangle': '三角形',
		'shortestpath-competition-hexagon': '六边形',
	},
};

export function getDrawStrings(language: string): DrawStrings {
	return language.toLowerCase().startsWith('zh') ? chinese : english;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const english = {
	// allow-any-unicode-next-line
	files: 'Files', newFile: 'New Drawing', newFolder: 'New Folder', rename: 'Rename', move: 'Move', delete: 'Delete', root: 'Drawings', namePrompt: 'Enter a name', folderPrompt: 'Choose a destination folder', deletePrompt: 'Delete this item and everything inside it?', defaultName: 'Untitled', invalidName: 'Use a unique name of 1–128 characters without slashes or control characters.', fileActionFailed: 'Could not update drawing files. Your current drawing has been kept.',
	// allow-any-unicode-next-line
	title: 'Sketchpad', loading: 'Loading sketchpad…', saved: 'Saved locally', saving: 'Saving…',
	unsaved: 'Changes have not been saved', saveFailed: 'Could not save the sketchpad. Retry or export a copy.',
	loadFailed: 'Could not restore the sketchpad. Your saved draft has been kept.',
	retry: 'Retry', clear: 'Clear Drawing', clearPrompt: 'Clear the current draft? Export a copy first if you want to keep it.',
	clearAction: 'Clear', import: 'Import', export: 'Export', beside: 'Draw beside Code', mode: 'Open Sketchpad Mode',
	importFailed: 'Could not import the drawing.', importPrompt: 'Replace the current draft with the imported drawing?',
	importAction: 'Replace', actionFailed: 'Could not complete the sketchpad action: {0}',
	exportTitle: 'Export Drawing', importTitle: 'Import Drawing', image: 'PNG Image', vector: 'SVG Image',
	drawing: 'Excalidraw Drawing', empty: 'Draw a graph, tree, or a few notes to work through a problem.',
	libraryNames: {
		// allow-any-unicode-next-line
		'shortestpath-competition-array-10': 'Array · 10 Cells',
		// allow-any-unicode-next-line
		'shortestpath-competition-indexed-array-10': 'Indexed Array · 10 Cells',
		// allow-any-unicode-next-line
		'shortestpath-competition-grid-3': 'Grid · 3 × 3',
		// allow-any-unicode-next-line
		'shortestpath-competition-grid-5': 'Grid · 5 × 5',
		// allow-any-unicode-next-line
		'shortestpath-competition-binary-tree-3': 'Binary Tree · 3 Nodes',
		// allow-any-unicode-next-line
		'shortestpath-competition-binary-tree-7': 'Binary Tree · 7 Nodes',
		// allow-any-unicode-next-line
		'shortestpath-competition-linked-list-5': 'Linked List · 5 Nodes',
		// allow-any-unicode-next-line
		'shortestpath-competition-key-value-table-5': 'Key-Value Table · 5 Rows',
		// allow-any-unicode-next-line
		'shortestpath-competition-undirected-graph-6': 'Undirected Graph · 6 Vertices',
		// allow-any-unicode-next-line
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
	// allow-any-unicode-next-line
	files: '文件', newFile: '新建画图', newFolder: '新建文件夹', rename: '重命名', move: '移动', delete: '删除', root: '画图文件', namePrompt: '输入名称', folderPrompt: '选择目标文件夹', deletePrompt: '删除此项目及其全部内容？', defaultName: '未命名', invalidName: '请输入不含斜杠或控制字符、长度为 1–128 字符且不重复的名称。', fileActionFailed: '无法更新画图文件，已保留当前画图。',
	// allow-any-unicode-next-line
	title: '草稿', loading: '正在加载草稿…', saved: '已保存在本机', saving: '正在保存…',
	// allow-any-unicode-next-line
	unsaved: '改动尚未保存', saveFailed: '草稿保存失败，请重试或导出备份。',
	// allow-any-unicode-next-line
	loadFailed: '无法恢复草稿，已保留原有草稿文件。',
	// allow-any-unicode-next-line
	retry: '重试', clear: '清空画图', clearPrompt: '清空当前草稿？如需保留，请先导出备份。',
	// allow-any-unicode-next-line
	clearAction: '清空', import: '导入', export: '导出', beside: '与代码并排', mode: '打开草稿模式',
	// allow-any-unicode-next-line
	importFailed: '无法导入画图文件。', importPrompt: '用导入的画图文件替换当前草稿？',
	// allow-any-unicode-next-line
	importAction: '替换', actionFailed: '无法完成草稿操作：{0}',
	// allow-any-unicode-next-line
	exportTitle: '导出画图', importTitle: '导入画图', image: 'PNG 图片', vector: 'SVG 图片',
	// allow-any-unicode-next-line
	drawing: 'Excalidraw 画图', empty: '画图、画树，或记下几步推演，理清题目思路。',
	libraryNames: {
		// allow-any-unicode-next-line
		'shortestpath-competition-array-10': '数组 · 10 格',
		// allow-any-unicode-next-line
		'shortestpath-competition-indexed-array-10': '带下标数组 · 10 格',
		// allow-any-unicode-next-line
		'shortestpath-competition-grid-3': '网格 · 3 × 3',
		// allow-any-unicode-next-line
		'shortestpath-competition-grid-5': '网格 · 5 × 5',
		// allow-any-unicode-next-line
		'shortestpath-competition-binary-tree-3': '二叉树 · 3 节点',
		// allow-any-unicode-next-line
		'shortestpath-competition-binary-tree-7': '二叉树 · 7 节点',
		// allow-any-unicode-next-line
		'shortestpath-competition-linked-list-5': '单链表 · 5 节点',
		// allow-any-unicode-next-line
		'shortestpath-competition-key-value-table-5': '键值表 · 5 行',
		// allow-any-unicode-next-line
		'shortestpath-competition-undirected-graph-6': '无向图 · 6 顶点',
		// allow-any-unicode-next-line
		'shortestpath-competition-diamond-graph-4': '菱形图 · 4 顶点',
		// allow-any-unicode-next-line
		'shortestpath-competition-first-quadrant': '第一象限坐标轴',
		// allow-any-unicode-next-line
		'shortestpath-competition-four-quadrants': '四象限坐标轴',
		// allow-any-unicode-next-line
		'shortestpath-competition-number-line': '数轴',
		// allow-any-unicode-next-line
		'shortestpath-competition-venn-diagram': '两集合 Venn 图',
		// allow-any-unicode-next-line
		'shortestpath-competition-triangle': '三角形',
		// allow-any-unicode-next-line
		'shortestpath-competition-hexagon': '六边形',
	},
};

export function getDrawStrings(language: string): DrawStrings {
	return language.toLowerCase().startsWith('zh') ? chinese : english;
}

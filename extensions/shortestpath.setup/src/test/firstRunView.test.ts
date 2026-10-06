/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { test } from 'node:test';
import { firstRunView, type FirstRunEditorState } from '../firstRunView';
import type { EnvironmentSetupState } from '../environmentSetup';

class Element {
	textContent = '';
	className = '';
	hidden = false;
	disabled = false;
	open = false;
	value: string | number = '';
	checked = false;
	style: Record<string, string> = {};
	getContext(): null { return null; }
	replaceChildren(): void { this.children = []; }
	onclick?: () => void;
	oninput?: () => void;
	onchange?: () => void;
	onfocus?: () => void;
	onblur?: () => void;
	children: Element[] = [];
	attributes = new Map<string, string>();
	append(...elements: Element[]): void { this.children.push(...elements); }
	setAttribute(key: string, value: string): void { this.attributes.set(key, value); }
}

test('checklist renders host progress, gates finishing, and preserves external logs', () => {
	const state: EnvironmentSetupState = { running: false, ready: false, steps: [{ id: 'toolchain', title: '编译器', description: '检测工具链', status: 'pending', log: '' }] };
	const ui = { title: '环境配置', intro: 'C++20', start: '开始', retry: '重试', finish: '完成', pending: '待检查', running: '正在配置', complete: '已完成', error: '失败', ready: '就绪', failed: '请重试', waiting: '等待', fontLoading: '加载字体', fontError: '字体读取失败', noFonts: '无字体', defaultFont: '默认' };
	const editor: FirstRunEditorState = { fontFamily: 'monospace', fontSize: 14, tabSize: 2, cppTemplate: 'int main() {}', fontLigatures: false, colorTheme: 'dark', autoDetectColorScheme: false, themes: [{ id: 'dark', label: 'Dark' }], autoSave: 'off', autoFormat: false, clangdVariableTypeHints: true };
	const html = firstRunView(state, ui, editor);
	assert.doesNotMatch(html, /cppStandard|type:'skip'|pageLabels/);
	assert.match(html, /script-src 'unsafe-inline'/);
	const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]; assert.ok(script);
	const elements = new Map(['title', 'intro', 'finish', 'start', 'next', 'back', 'nextTemplate', 'backEditor', 'nextWorkspace', 'backTemplate', 'chooseWorkspace', 'workspaceTitle', 'workspaceIntro', 'workspaceFolderLabel', 'workspaceFolder', 'workspaceEmpty', 'workspaceError', 'workspacePage', 'workspaceLabel', 'progress', 'notice', 'steps', 'compilePage', 'editorPage', 'templatePage', 'compileLabel', 'editorLabel', 'templateLabel', 'editorTitle', 'editorIntro', 'templateTitle', 'templateIntro', 'cppTemplate', 'templateSaved', 'templatePreview', 'templatePreviewStatus', 'retryTemplatePreview', 'fontSize', 'fontSizeLabel', 'tabSize', 'indentLabel', 'themeLabel', 'colorTheme', 'autoFormatLabel', 'autoFormat', 'hintsLabel', 'clangdVariableTypeHints', 'formatHint', 'typeHint', 'preview', 'previewStatus', 'retryPreview', 'saved'].map(id => [id, new Element()]));
	const messages: unknown[] = [];
	let update!: (event: { data: Record<string, unknown> }) => void;
	vm.runInNewContext(script, { acquireVsCodeApi: () => ({ postMessage: (message: unknown) => messages.push(message) }), document: { getElementById: (id: string) => elements.get(id), createElement: () => new Element() }, window: { addEventListener: (_event: string, handler: typeof update) => { update = handler; } } });
	const finish = elements.get('finish')!, start = elements.get('start')!;
	assert.equal(finish.disabled, true); finish.onclick!(); assert.equal(messages.length, 1);
	start.onclick!(); assert.equal(JSON.stringify(messages.at(-1)), '{"type":"startEnvironment"}');
	const send = () => update({ data: { type: 'environmentState', value: state } });
	state.running = true; state.steps[0].status = 'running'; state.steps[0].log = '<script>external log</script>'; send();
	assert.equal(start.disabled, true); assert.equal(finish.disabled, true);
	const details = elements.get('steps')!.children[0].children[0];
	assert.equal(details.open, true);
	assert.equal(details.children[1].textContent, '<script>external log</script>');
	assert.ok(details.children[1].attributes.has('data-i18n-ignore'));
	state.running = false; state.steps[0].status = 'error'; send();
	assert.equal(start.textContent, '重试'); assert.equal(finish.disabled, true);
	state.ready = true; state.steps[0].status = 'complete'; send();
	assert.equal(finish.disabled, true);
	const count = messages.length; finish.onclick!(); assert.equal(messages.length, count);
	elements.get('next')!.onclick!(); assert.equal(JSON.stringify(messages.at(-1)), '{"type":"nextEditor"}');
	assert.equal(elements.get('editorPage')!.hidden, true);
	update({ data: { type: 'firstRunPage', value: 'editor', state: editor } });
	assert.equal(elements.get('compilePage')!.hidden, true);
	assert.equal(elements.get('editorPage')!.hidden, false);
	const request = messages.at(-1) as { requestId: number };
	update({ data: { type: 'editorPreview', requestId: request.requestId, value: { source: editor.cppTemplate, lines: [[{ text: 'int main() {}', style: 'color:red' }]], hints: [] } } });
	assert.equal(elements.get('preview')!.children[0].children[0].style.cssText, 'color:red');
	elements.get('autoFormat')!.checked = true; elements.get('autoFormat')!.onchange!();
	assert.equal(elements.get('previewStatus')!.textContent, '');
	const save = messages.findLast(message => (message as { type: string }).type === 'save') as { requestId: number };
	update({ data: { type: 'saveResult', requestId: save.requestId, success: true } });
	assert.equal(elements.get('saved')!.hidden, true);
	assert.equal(elements.get('saved')!.textContent, '');
	finish.onclick!(); assert.notEqual((messages.at(-1) as { type: string }).type, 'complete');
	elements.get('nextTemplate')!.onclick!();
	assert.equal((messages.at(-1) as { type: string }).type, 'nextTemplate');
	update({ data: { type: 'firstRunPage', value: 'template', state: editor } });
	const templateRequest = messages.at(-1) as { requestId: number; source: string; page: string };
	assert.deepEqual([templateRequest.page, templateRequest.source], ['template', editor.cppTemplate]);
	assert.equal(elements.get('templatePreview')!.children[0].children[0].textContent, editor.cppTemplate);
	update({ data: { type: 'editorPreview', requestId: templateRequest.requestId, message: 'preview unavailable' } });
	assert.equal(elements.get('templatePreview')!.children[0].children[0].textContent, editor.cppTemplate);
	update({ data: { type: 'editorPreview', requestId: templateRequest.requestId, value: { source: editor.cppTemplate, lines: [[{ text: 'int main() {}', style: 'color:blue' }]], hints: [] } } });
	assert.equal(elements.get('templatePreview')!.children[0].children[0].style.cssText, 'color:blue');
	assert.equal(elements.get('templatePreview')!.style.fontSize, '14px');
	elements.get('cppTemplate')!.onfocus!();
	assert.equal((messages.at(-1) as { autoFormat: boolean }).autoFormat, false);
	elements.get('cppTemplate')!.value = 'int main(){return 3;}'; elements.get('cppTemplate')!.oninput!();
	assert.equal((messages.at(-1) as { source: string }).source, 'int main(){return 3;}');
	const edited = { ...editor, cppTemplate: 'int main(){return 3;}' };
	finish.onclick!(); assert.notEqual((messages.at(-1) as { type: string }).type, 'complete');
	elements.get('nextWorkspace')!.onclick!();
	assert.equal((messages.at(-1) as { type: string }).type, 'nextWorkspace');
	update({ data: { type: 'firstRunPage', value: 'workspace', state: edited } });
	assert.equal(elements.get('templatePage')!.hidden, true);
	assert.equal(elements.get('workspacePage')!.hidden, false);
	assert.equal(finish.disabled, true);
	elements.get('chooseWorkspace')!.onclick!();
	assert.equal((messages.at(-1) as { type: string }).type, 'chooseWorkspace');
	assert.equal(elements.get('chooseWorkspace')!.disabled, true);
	update({ data: { type: 'workspaceResult' } }); // Cancelling leaves completion gated.
	assert.equal(finish.disabled, true);
	elements.get('chooseWorkspace')!.onclick!();
	update({ data: { type: 'workspaceResult', workspaceFolder: '/code/<script>external</script>' } });
	assert.equal(elements.get('workspaceFolder')!.textContent, '/code/<script>external</script>');
	assert.match(html, /id="workspaceFolder" data-i18n-ignore/);
	assert.equal(finish.disabled, false);
	elements.get('chooseWorkspace')!.onclick!();
	assert.equal(finish.disabled, true);
	update({ data: { type: 'workspaceResult', workspaceFolder: '/code/<script>external</script>' } });
	elements.get('backTemplate')!.onclick!();
	assert.equal((messages.at(-1) as { type: string }).type, 'nextTemplate');
	update({ data: { type: 'firstRunPage', value: 'template', state: edited, workspaceFolder: '/code/<script>external</script>' } });
	update({ data: { type: 'firstRunPage', value: 'workspace', state: edited, workspaceFolder: '/code/<script>external</script>' } });
	assert.equal(elements.get('workspaceFolder')!.textContent, '/code/<script>external</script>');
	finish.onclick!(); assert.equal((messages.at(-1) as { type: string }).type, 'complete');
	assert.deepEqual((messages.at(-1) as { value: FirstRunEditorState }).value, edited);
	assert.equal(elements.get('fontSize')!.disabled, true);
	assert.equal(elements.get('back')!.disabled, true);
	update({ data: { type: 'folderOpenRequested' } });
	assert.equal(finish.disabled, false);
	finish.onclick!();
	update({ data: { type: 'completeError', message: 'save failed' } });
	assert.equal(elements.get('fontSize')!.disabled, false);
	assert.equal(elements.get('back')!.disabled, false);
	assert.equal(elements.get('workspaceError')!.hidden, false);
	assert.equal(finish.disabled, false);
	assert.match(html, /footer\{justify-content:space-between/);
	assert.doesNotMatch(html, /class="secondary"|ui\.saving|ui\.saved|ui\.previewLoading/);

});

test('platform differences are confined to preparation items', () => {
	const root = path.resolve(__dirname, '../..', 'resources');
	const presets = ['mac', 'windows'].map(platform => JSON.parse(fs.readFileSync(path.join(root, platform + '.json'), 'utf8')));
	assert.deepEqual(presets[0].setupStages.map((item: { id: string }) => item.id), ['xcode', 'homebrew', 'toolchain']);
	assert.deepEqual(presets[1].setupStages.map((item: { id: string }) => item.id), ['toolchain']);
	const gettingStarted = fs.readFileSync(path.resolve(__dirname, '../..', 'src/gettingStarted.ts'), 'utf8');
	assert.doesNotMatch(gettingStarted, /id: 'configuration'/);
	assert.match(gettingStarted, /id: 'selfTest'/);
	assert.match(gettingStarted, /firstRunEditorSession.complete\(ready/);
	assert.doesNotMatch(gettingStarted, /默认使用 C\+\+20，无需选择代码目录/);
	assert.match(gettingStarted, /environmentRunner\?\.snapshot.ready/);
	assert.doesNotMatch(gettingStarted, /configureLocale|pickWorkspaceFolder|type: 'skip'/);
});

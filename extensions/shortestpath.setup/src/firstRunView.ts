/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { FirstRunPage } from './firstRunEditorSession';
import type { EnvironmentSetupState } from './environmentSetup';
import { previewLineSegments } from './firstRunPreview';
import { codeFontDetectionScript } from './fontSelection';

export type FirstRunEditorState = {
	fontFamily: string;
	fontSize: number;
	tabSize: number;
	cppTemplate: string;
	fontLigatures: boolean;
	colorTheme: string;
	autoDetectColorScheme: boolean;
	themes: Array<{ id: string; label: string }>;
	autoSave: string;
	autoFormat: boolean;
	clangdVariableTypeHints: boolean;
};

export function firstRunView(state: EnvironmentSetupState, ui: Record<string, string>, editor: FirstRunEditorState, page: FirstRunPage = 'compile', completing = false, workspaceFolder?: string, choosingWorkspace = false): string {
	const payload = JSON.stringify({ state, ui, editor, page, completing, workspaceFolder, choosingWorkspace }).replace(/</g, '\\u003c');
	return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>${ui.title}</title><style>
*{box-sizing:border-box}body{margin:0;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:850px;margin:0 auto;padding:32px}h1{font-size:32px;margin:14px 0 12px}p{color:var(--vscode-descriptionForeground)}nav{display:flex;flex-wrap:wrap;gap:12px 24px;color:var(--vscode-descriptionForeground)}nav .active{color:var(--vscode-editor-foreground);font-weight:600}ol{list-style:none;padding:0;margin:28px 0}li{border:1px solid var(--vscode-widget-border,#555);border-radius:8px;margin:12px 0;padding:16px}summary{cursor:pointer;display:flex;gap:14px;align-items:center;list-style:none}summary::-webkit-details-marker{display:none}.indicator{width:26px;height:26px;border:1px solid var(--vscode-descriptionForeground);border-radius:50%;text-align:center;flex-shrink:0}.complete .indicator{background:var(--vscode-testing-iconPassed,#388a34);color:white;border-color:transparent}.running .indicator{border-color:var(--vscode-progressBar-background);animation:pulse 1s infinite alternate}.error .indicator{color:var(--vscode-errorForeground);border-color:currentColor}.heading{flex:1}strong{font-size:16px}.description{font-size:13px;color:var(--vscode-descriptionForeground)}.status{font-size:12px;color:var(--vscode-descriptionForeground)}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;font:12px/1.5 var(--vscode-editor-font-family,monospace);background:var(--vscode-textCodeBlock-background);padding:12px}footer{display:flex;align-items:center;gap:12px;flex-wrap:wrap}button{font:inherit;border:0;border-radius:5px;padding:9px 22px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);cursor:pointer}button:disabled{opacity:.45;cursor:default}button:focus-visible,summary:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--vscode-focusBorder)}#notice{margin-top:20px}progress{width:100%;height:4px}[hidden]{display:none!important}.settings{border:1px solid var(--vscode-widget-border,#555);border-radius:8px;padding:0 20px;margin:24px 0}.setting{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:13px 0;border-bottom:1px solid var(--vscode-widget-border,#555)}.setting:last-child{border:0}.setting label{font-weight:600}.setting input:not([type=checkbox]),.setting select{width:240px;max-width:55%;font:inherit;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,#555);border-radius:4px;padding:6px 8px}.setting input[type=checkbox]{width:18px;height:18px}.setting .description{max-width:400px}#preview{font-size:14px;line-height:1.6;border-radius:5px;padding:18px;background:var(--vscode-editor-background);border:1px solid var(--vscode-widget-border,#555);overflow:auto;margin:20px 0}.code-line{white-space:pre;min-height:1.6em}.inlay-hint{font-size:90%;color:var(--vscode-editorInlayHint-typeForeground,var(--vscode-editorInlayHint-foreground));background:var(--vscode-editorInlayHint-typeBackground,var(--vscode-editorInlayHint-background));border-radius:3px;padding:0 2px}textarea{display:block;width:100%;min-height:400px;resize:vertical;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);border:1px solid var(--vscode-widget-border,#555);border-radius:5px;padding:18px;margin:24px 0;line-height:1.6;tab-size:2}#workspaceFolder{overflow-wrap:anywhere}#fontStatus{font-size:12px}@keyframes pulse{to{opacity:.35}}@media(prefers-reduced-motion:reduce){.running .indicator{animation:none}}@media(max-width:600px){main{padding:24px 16px}.status{max-width:70px}.setting{gap:12px}}
footer{justify-content:space-between;margin-top:24px}button:hover:not(:disabled){background:var(--vscode-button-hoverBackground)}.save-error,.preview-error{color:var(--vscode-errorForeground)}.template-code{position:relative;margin:24px 0;border:1px solid var(--vscode-widget-border,#555);border-radius:5px;overflow:hidden}.template-code:focus-within{outline:2px solid var(--vscode-focusBorder)}#templatePreview{position:absolute;inset:0;padding:18px;overflow:hidden;pointer-events:none}#cppTemplate{position:relative;display:block;width:100%;min-height:400px;margin:0;resize:none;border:0;border-radius:0;background:transparent;color:transparent;-webkit-text-fill-color:transparent;caret-color:var(--vscode-editor-foreground);white-space:pre;overflow:auto;outline:none}.template-code .inlay-hint{pointer-events:none}
</style></head><body><main>
<nav aria-label="${ui.setupSteps}"><span id="compileLabel"></span><span id="editorLabel"></span><span id="templateLabel"></span><span id="workspaceLabel"></span></nav>
<section id="compilePage"><h1 id="title"></h1><p id="intro"></p><ol id="steps" aria-label="${ui.title}"></ol><progress id="progress" hidden></progress><p id="notice" role="status" aria-live="polite"></p><footer><button id="start"></button><button id="next" disabled></button></footer></section>
<section id="editorPage" hidden><h1 id="editorTitle"></h1><p id="editorIntro"></p><div class="settings">
<div class="setting"><div><label id="fontLabel" for="fontFamily"></label><div id="fontStatus" class="description" role="status" aria-live="polite"></div></div><select id="fontFamily"></select></div>
<div class="setting"><div><label id="fontLigaturesLabel" for="fontLigatures"></label><div id="fontLigaturesHint" class="description"></div></div><input id="fontLigatures" type="checkbox"></div>
<div class="setting"><label id="fontSizeLabel" for="fontSize"></label><input id="fontSize" type="number" min="6" max="40" step="1"></div>
<div class="setting"><label id="indentLabel" for="tabSize"></label><select id="tabSize"><option value="2">2</option><option value="4">4</option><option value="8">8</option></select></div>
<div class="setting"><label id="themeLabel" for="colorTheme"></label><select id="colorTheme"></select></div>
<div class="setting"><div><label id="autoFormatLabel" for="autoFormat"></label><div id="formatHint" class="description"></div></div><input id="autoFormat" type="checkbox"></div>
<div class="setting"><div><label id="hintsLabel" for="clangdVariableTypeHints"></label><div id="typeHint" class="description"></div></div><input id="clangdVariableTypeHints" type="checkbox"></div>
</div><div id="preview" data-i18n-ignore></div><p id="previewStatus" class="preview-error" role="status" aria-live="polite" hidden></p><button id="retryPreview" hidden></button><p id="saved" class="save-error" role="status" aria-live="polite" hidden></p><footer><button id="back"></button><button id="nextTemplate"></button></footer></section>
<section id="templatePage" hidden><h1 id="templateTitle"></h1><p id="templateIntro"></p><div class="template-code"><div id="templatePreview" data-i18n-ignore aria-hidden="true"></div><textarea id="cppTemplate" wrap="off" spellcheck="false" data-i18n-ignore aria-label="${ui.templateTitle}"></textarea></div><p id="templatePreviewStatus" class="preview-error" role="status" aria-live="polite" hidden></p><button id="retryTemplatePreview" hidden></button><p id="templateSaved" class="save-error" role="status" aria-live="polite" hidden></p><footer><button id="backEditor"></button><button id="nextWorkspace"></button></footer></section>
<section id="workspacePage" hidden><h1 id="workspaceTitle"></h1><p id="workspaceIntro"></p><div class="settings"><div class="setting"><div><strong id="workspaceFolderLabel"></strong><p id="workspaceFolder" data-i18n-ignore></p><p id="workspaceEmpty"></p></div><button id="chooseWorkspace"></button></div></div><p id="workspaceError" class="save-error" role="status" aria-live="polite" hidden></p><footer><button id="backTemplate"></button><button id="finish" disabled></button></footer></section>
</main><script>
const vscode = acquireVsCodeApi();
const initial = ${payload};
const ui = initial.ui;
const byId = id => document.getElementById(id);
let state = initial.state;
let editor = initial.editor;
let page = initial.page;
let saveId = 0;
let completing = initial.completing;
let workspaceFolder = initial.workspaceFolder;
let choosingWorkspace = initial.choosingWorkspace;
let previewId = 0;
let templateEditing = false;
let templateResult;
let fontsRequested = false;
let systemCodeFonts = [];
let fontDetectionGeneration = 0;
${codeFontDetectionScript}
const splitTokens = ${previewLineSegments.toString()};
const rows = new Map();
for (const [id, key] of Object.entries({title:'title',intro:'intro',next:'next',nextTemplate:'next',nextWorkspace:'next',workspaceTitle:'workspaceTitle',workspaceIntro:'workspaceIntro',workspaceFolderLabel:'workspaceFolderLabel',workspaceEmpty:'workspaceEmpty',chooseWorkspace:'chooseWorkspace',backTemplate:'back',editorTitle:'editorTitle',editorIntro:'editorIntro',templateTitle:'templateTitle',templateIntro:'templateIntro',finish:'finish',back:'back',backEditor:'back',fontLabel:'fontLabel',fontLigaturesLabel:'fontLigaturesLabel',fontLigaturesHint:'fontLigaturesHint',fontSizeLabel:'fontSizeLabel',indentLabel:'indentLabel',themeLabel:'themeLabel',autoFormatLabel:'autoFormatLabel',hintsLabel:'hintsLabel',formatHint:'formatHint',typeHint:'typeHint',retryPreview:'retryPreview',retryTemplatePreview:'retryPreview'})) { byId(id).textContent = ui[key]; }
byId('compileLabel').textContent = '1 · ' + ui.title;
byId('editorLabel').textContent = '2 · ' + ui.editorTitle;
byId('templateLabel').textContent = '3 · ' + ui.templateTitle;
byId('workspaceLabel').textContent = '4 · ' + ui.workspaceTitle;
byId('progress').setAttribute('aria-label', ui.running);
function showPage(value) {
  page = value;
  templateEditing = false;
  byId('compilePage').hidden = page !== 'compile';
  byId('editorPage').hidden = page !== 'editor';
  byId('templatePage').hidden = page !== 'template';
  byId('workspacePage').hidden = page !== 'workspace';
  byId('compileLabel').className = page === 'compile' ? 'active' : '';
  byId('editorLabel').className = page === 'editor' ? 'active' : '';
  byId('templateLabel').className = page === 'template' ? 'active' : '';
  byId('workspaceLabel').className = page === 'workspace' ? 'active' : '';
  renderWorkspace();
  ++previewId;
  if (page === 'template' && templateResult) renderPreview(templateResult);
  if (page === 'editor' || page === 'template') {
    if (!fontsRequested) { fontsRequested = true; status('fontStatus',ui.fontLoading); vscode.postMessage({type:'systemFonts'}); }
    requestPreview();
  }
}
function render(value) {
  state = value;
  for (const step of state.steps) {
    let row = rows.get(step.id);
    if (!row) {
      const li = document.createElement('li'), details = document.createElement('details'), summary = document.createElement('summary');
      const indicator = document.createElement('span'); indicator.className = 'indicator'; indicator.setAttribute('aria-hidden','true');
      const heading = document.createElement('span'); heading.className = 'heading';
      const title = document.createElement('strong'), description = document.createElement('div'); description.className = 'description'; heading.append(title, description);
      const status = document.createElement('span'); status.className = 'status';
      const log = document.createElement('pre'); log.setAttribute('data-i18n-ignore','');
      summary.append(indicator, heading, status); details.append(summary, log); li.append(details); byId('steps').append(li);
      row = {li, details, indicator, title, description, status, log, previous:'pending'}; rows.set(step.id,row);
    }
    row.li.className = step.status;
    row.indicator.textContent = step.status === 'complete' ? '✓' : step.status === 'error' ? '!' : step.status === 'running' ? '…' : '';
    row.title.textContent = step.title; row.description.textContent = step.description; row.status.textContent = ui[step.status];
    if (row.log.textContent !== step.log) row.log.textContent = step.log;
    row.log.hidden = !step.log;
    if (row.previous !== step.status && (step.status === 'running' || step.status === 'error')) row.details.open = true;
    if (row.previous === 'running' && step.status === 'complete') row.details.open = false;
    row.previous = step.status;
  }
  const failed = state.steps.some(step => step.status === 'error');
  byId('start').textContent = failed ? ui.retry : ui.start;
  byId('start').disabled = state.running || state.ready;
  byId('next').disabled = !state.ready || state.running;
  renderWorkspace();
  byId('progress').hidden = !state.running;
  byId('notice').textContent = state.ready ? ui.ready : state.running ? ui.running : failed ? ui.failed : ui.waiting;
}
function renderWorkspace() {
  byId('workspaceFolder').textContent = workspaceFolder || '';
  byId('workspaceFolder').hidden = !workspaceFolder;
  byId('workspaceEmpty').hidden = !!workspaceFolder;
  byId('chooseWorkspace').disabled = completing || choosingWorkspace;
  byId('backTemplate').disabled = completing || choosingWorkspace;
  byId('finish').disabled = completing || choosingWorkspace || !workspaceFolder || !state.ready || state.running;
}
function option(select, value, label, external = false) {
  const element = document.createElement('option'); element.value = value; element.textContent = label;
  if (external) element.setAttribute('data-i18n-ignore','');
  select.append(element);
}
function renderFonts() {
  const select = byId('fontFamily'); select.replaceChildren();
  const current = (editor.fontFamily || 'Fira Code').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  const fonts = [...new Set(['Fira Code', current, ...systemCodeFonts])];
  for (const font of fonts) option(select, font, font, true);
  select.value = current;
}
async function applySystemFonts(value) {
  const generation = ++fontDetectionGeneration;
  try {
    const fonts = await getMonospaceFonts(value.fonts);
    if (generation !== fontDetectionGeneration) return;
    systemCodeFonts = fonts.filter(font => font.toLowerCase() !== 'fira code').sort((left,right) => codeFontPriority(left)-codeFontPriority(right) || left.localeCompare(right));
    renderFonts();
    status('fontStatus',value.error);
  } catch {
    if (generation === fontDetectionGeneration) status('fontStatus',ui.fontDetectionError);
  }
}
function previewStyle() {
  for (const id of ['preview','templatePreview','cppTemplate']) {
    byId(id).style.fontFamily = editor.fontFamily;
    byId(id).style.fontSize = editor.fontSize + 'px';
    byId(id).style.tabSize = String(editor.tabSize);
    byId(id).style.fontVariantLigatures = editor.fontLigatures ? 'normal' : 'none';
  }
  byId('cppTemplate').style.height = Math.max(400, (editor.cppTemplate.split('\\n').length + 1) * editor.fontSize * 1.6 + 36) + 'px';
}
function status(id, text) { byId(id).textContent = text || ''; byId(id).hidden = !text; }
function requestPreview() {
  if ((page !== 'editor' && page !== 'template') || completing) return;
  const editing = page === 'template' && templateEditing;
  vscode.postMessage({type:'editorPreview',page,source:page === 'template' ? editor.cppTemplate : undefined,tabSize:editor.tabSize,typeHints:editor.clangdVariableTypeHints && !editing,autoFormat:editor.autoFormat && !editing,requestId:++previewId});
}
function renderPreview(value) {
  const preview = byId(page === 'template' ? 'templatePreview' : 'preview'); preview.replaceChildren();
  value.lines.forEach((tokens, index) => {
    const line = document.createElement('div'); line.className = 'code-line';
    const hints = editor.clangdVariableTypeHints && !templateEditing ? value.hints.filter(hint => hint.line === index) : [];
    for (const segment of splitTokens(tokens, hints)) {
      const span = document.createElement('span'); span.textContent = segment.text;
      if (segment.hint) span.className = 'inlay-hint'; else span.style.cssText = segment.style;
      line.append(span);
    }
    preview.append(line);
  });
  status(page === 'template' ? 'templatePreviewStatus' : 'previewStatus', value.hintError);
  byId(page === 'template' ? 'retryTemplatePreview' : 'retryPreview').hidden = !value.hintError;
}
function renderEditor(value) {
  editor = value;
  renderFonts();
  byId('fontLigatures').checked = editor.fontLigatures;
  byId('fontSize').value = editor.fontSize;
  byId('tabSize').value = editor.tabSize;
  byId('cppTemplate').value = editor.cppTemplate;
  templateResult = {source:editor.cppTemplate,lines:editor.cppTemplate.split('\\n').map(text => [{text,style:''}]),hints:[]};
  const themes = byId('colorTheme'); themes.replaceChildren();
  for (const theme of editor.themes) option(themes, theme.id, theme.label, true);
  themes.value = editor.colorTheme;
  byId('autoFormat').checked = editor.autoFormat;
  byId('clangdVariableTypeHints').checked = editor.clangdVariableTypeHints;
  previewStyle();
}
function save(section, value) {
  vscode.postMessage({type:'save',page:section,value,requestId:++saveId});
}
byId('fontFamily').onchange = () => { editor.fontFamily = serializeFont(byId('fontFamily').value); previewStyle(); save('font',editor); };
byId('fontLigatures').onchange = () => { editor.fontLigatures = byId('fontLigatures').checked; previewStyle(); save('font',editor); };
byId('fontSize').onchange = () => { editor.fontSize = Math.min(40,Math.max(6,Number(byId('fontSize').value)||14)); byId('fontSize').value=editor.fontSize; previewStyle(); save('font',editor); };
byId('tabSize').onchange = () => { editor.tabSize = Number(byId('tabSize').value); save('indent',editor); requestPreview(); };
byId('colorTheme').onchange = () => { editor.colorTheme = byId('colorTheme').value; save('theme',editor); requestPreview(); };
byId('autoFormat').onchange = () => { editor.autoFormat = byId('autoFormat').checked; save('autoformat',editor); requestPreview(); };
byId('clangdVariableTypeHints').onchange = () => { editor.clangdVariableTypeHints = byId('clangdVariableTypeHints').checked; save('clangd',editor); requestPreview(); };
byId('cppTemplate').oninput = () => {
  editor.cppTemplate = byId('cppTemplate').value; previewStyle(); save('template',editor);
  templateResult = {source:editor.cppTemplate,lines:editor.cppTemplate.split('\\n').map(text => [{text,style:''}]),hints:[]};
  renderPreview(templateResult); requestPreview();
};
byId('cppTemplate').onfocus = () => { templateEditing = true; ++previewId; if (templateResult) renderPreview(templateResult); requestPreview(); };
byId('cppTemplate').onpointerdown = () => { templateEditing = true; if (templateResult) renderPreview(templateResult); };
byId('cppTemplate').onblur = () => { templateEditing = false; requestPreview(); };
byId('cppTemplate').onscroll = () => { byId('templatePreview').scrollTop = byId('cppTemplate').scrollTop; byId('templatePreview').scrollLeft = byId('cppTemplate').scrollLeft; };
byId('retryPreview').onclick = requestPreview;
byId('retryTemplatePreview').onclick = requestPreview;
byId('start').onclick = () => vscode.postMessage({type:'startEnvironment'});
byId('next').onclick = () => { if(state.ready&&!state.running) vscode.postMessage({type:'nextEditor'}); };
byId('back').onclick = () => vscode.postMessage({type:'compilePage'});
byId('nextTemplate').onclick = () => { if(!completing) vscode.postMessage({type:'nextTemplate'}); };
byId('backEditor').onclick = () => { if(!completing) vscode.postMessage({type:'nextEditor'}); };
byId('nextWorkspace').onclick = () => { if(!completing) vscode.postMessage({type:'nextWorkspace'}); };
byId('backTemplate').onclick = () => { if(!completing&&!choosingWorkspace) vscode.postMessage({type:'nextTemplate'}); };
byId('chooseWorkspace').onclick = () => { if(!completing&&!choosingWorkspace&&page==='workspace') { choosingWorkspace = true; renderWorkspace(); vscode.postMessage({type:'chooseWorkspace'}); } };
function lockEditor(value) {
  completing = value;
  for (const id of ['fontFamily','fontLigatures','fontSize','tabSize','colorTheme','autoFormat','clangdVariableTypeHints','cppTemplate','nextTemplate','back','backEditor','nextWorkspace','backTemplate','finish']) byId(id).disabled = completing || (id === 'finish' && !state.ready);
  renderWorkspace();
}
byId('finish').onclick = () => { if(!completing&&!choosingWorkspace&&page==='workspace'&&workspaceFolder&&state.ready&&!state.running) { lockEditor(true); vscode.postMessage({type:'complete',value:editor}); } };
window.addEventListener('message',event => {
  const message = event.data;
  if (message.type==='systemFonts') void applySystemFonts(message.value);
  if (message.type==='environmentState') render(message.value);
  if (message.type==='firstRunPage') { renderEditor(message.state); workspaceFolder = message.workspaceFolder; showPage(message.value); }
  if (message.type==='saveResult'&&message.requestId===saveId) status(page === 'template' ? 'templateSaved' : 'saved',message.success?'':message.message);
  if (message.type==='folderOpenRequested') { lockEditor(false); status('workspaceError',''); }
  if (message.type==='completeError') { lockEditor(false); status('workspaceError',message.message); }
  if (message.type==='workspaceResult') { choosingWorkspace = false; workspaceFolder = message.workspaceFolder; status('workspaceError',message.message); renderWorkspace(); }
  if (message.type==='previewRefresh') requestPreview();
  if (message.type==='editorPreview'&&message.requestId===previewId&&(page==='editor'||page==='template')&&!completing) {
    if (message.value) {
      if (page==='template') {
        templateResult=message.value;
        if (!templateEditing && editor.cppTemplate!==message.value.source) { editor.cppTemplate=message.value.source; byId('cppTemplate').value=editor.cppTemplate; previewStyle(); save('template',editor); }
      }
      renderPreview(message.value);
    } else { status(page === 'template' ? 'templatePreviewStatus' : 'previewStatus',message.message); byId(page === 'template' ? 'retryTemplatePreview' : 'retryPreview').hidden=false; }
  }
});
render(state); renderEditor(editor); showPage(page); lockEditor(completing); vscode.postMessage({type:'environmentState'});
</script></body></html>`;
}

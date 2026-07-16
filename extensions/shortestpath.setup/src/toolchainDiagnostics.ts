import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import * as vscode from 'vscode';

type DiagnosticStatus = 'ok' | 'warning' | 'error';
type DiagnosticItem = { label: string; status: DiagnosticStatus; detail: string; path?: string };

export function registerToolchainDiagnostics(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.openToolchainDiagnostics', () => openToolchainDiagnostics(context)));
}

async function openToolchainDiagnostics(context: vscode.ExtensionContext): Promise<void> {
	const panel = vscode.window.createWebviewPanel('shortestpath.toolchainDiagnostics', '工具链诊断', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
	const refresh = async () => {
		const items = await collectDiagnostics();
		await panel.webview.postMessage({ type: 'state', value: { items, needsRepair: items.some(item => item.status !== 'ok') } });
	};
	panel.webview.onDidReceiveMessage(async message => {
		if (message?.type === 'refresh') {
			await refresh();
		} else if (message?.type === 'redetect') {
			await vscode.commands.executeCommand('shortestpath.redetectToolchain');
			await refresh();
		} else if (message?.type === 'repair') {
			await vscode.commands.executeCommand('shortestpath.repairToolchain');
			await refresh();
		} else if (message?.type === 'openPath' && typeof message.path === 'string') {
			const target = fs.existsSync(message.path) && fs.statSync(message.path).isDirectory() ? message.path : path.dirname(message.path);
			await vscode.env.openExternal(vscode.Uri.file(target));
		}
	}, undefined, context.subscriptions);
	const configurationListener = vscode.workspace.onDidChangeConfiguration(event => {
		if (panel.visible && (event.affectsConfiguration('clangd.arguments') || event.affectsConfiguration('clangd.path') || event.affectsConfiguration('cph.language.cpp.Command') || event.affectsConfiguration('c-cpp-compile-run.cpp-compiler'))) {
			void refresh();
		}
	});
	panel.onDidChangeViewState(event => {
		if (event.webviewPanel.visible) {
			void refresh();
		}
	});
	panel.onDidDispose(() => configurationListener.dispose());
	panel.webview.html = getHtml();
	await refresh();
}

async function collectDiagnostics(): Promise<DiagnosticItem[]> {
	const configuration = vscode.workspace.getConfiguration(undefined, null);
	const compiler = configuration.get<string>('cph.language.cpp.Command') ?? '';
	const compileRunCompiler = configuration.get<string>('c-cpp-compile-run.cpp-compiler') ?? '';
	const clangd = configuration.get<string>('clangd.path') ?? '';
	const clangdArguments = configuration.get<unknown>('clangd.arguments');
	const cphFlags = configuration.get<string>('cph.language.cpp.Args') ?? '';
	const compileRunFlags = configuration.get<string>('c-cpp-compile-run.cpp-flags') ?? '';
	const items: DiagnosticItem[] = [];
	items.push(await executableDiagnostic('C++ 编译器（CPH）', compiler, ['--version']));
	items.push(await executableDiagnostic('clangd', clangd, ['--version']));
	items.push({
		label: 'C/C++ Compile Run 编译器',
		status: compileRunCompiler === compiler && !!compiler ? 'ok' : 'warning',
		detail: compileRunCompiler === compiler && !!compiler ? '与 CPH 使用相同编译器。' : `当前：${compileRunCompiler || '未配置'}${compiler ? `；CPH：${compiler}` : ''}`,
		path: compileRunCompiler || undefined
	});
	items.push({
		label: '编译选项',
		status: cphFlags === compileRunFlags && !!cphFlags ? 'ok' : 'warning',
		detail: cphFlags === compileRunFlags && !!cphFlags ? `CPH 与 Compile Run 一致：${cphFlags}` : `CPH：${cphFlags || '未配置'}；Compile Run：${compileRunFlags || '未配置'}`
	});
	const queryDriver = Array.isArray(clangdArguments) && clangdArguments.some(argument =>
		typeof argument === 'string' && (
			argument === `--query-driver=${compiler}` ||
			(process.platform === 'darwin' && argument === '--query-driver=/opt/homebrew/**/g++-*,/usr/local/**/g++-*')
		)
	);
	items.push({
		label: 'clangd Query Driver',
		status: compiler && queryDriver ? 'ok' : 'warning',
		detail: compiler && queryDriver ? (process.platform === 'darwin' ? '已允许 Homebrew GCC 的所有稳定链接路径。' : `已指向 ${compiler}`) : 'clangd 未配置与当前 C++ 编译器匹配的 --query-driver。'
	});
	for (const extension of [
		{ id: 'divyanshuagrawal.competitive-programming-helper', label: 'Competitive Programming Helper（CPH）' },
		{ id: 'danielpinto8zz6.c-cpp-compile-run', label: 'C/C++ Compile Run' },
		{ id: 'llvm-vs-code-extensions.vscode-clangd', label: 'clangd 扩展' }
	]) {
		const installed = vscode.extensions.getExtension(extension.id);
		items.push({ label: extension.label, status: installed ? 'ok' : 'error', detail: installed ? `已安装（${installed.packageJSON.version ?? '未知版本'}）。` : '未安装或未随应用打包。' });
	}
	return items;
}

async function executableDiagnostic(label: string, executable: string, args: string[]): Promise<DiagnosticItem> {
	if (!executable) { return { label, status: 'error', detail: '未配置路径。' }; }
	if (!fs.existsSync(executable)) { return { label, status: 'error', detail: `找不到文件：${executable}`, path: executable }; }
	try {
		const output = await run(executable, args);
		if (process.platform === 'darwin' && label.startsWith('C++ 编译器') && /apple clang/i.test(output)) {
			return { label, status: 'warning', detail: '检测到 Apple Clang 的 g++ 兼容包装器；可以使用，但推荐安装 Homebrew GCC 以保持竞赛环境一致。', path: executable };
		}
		return { label, status: 'ok', detail: output.split(/\r?\n/).find(Boolean)?.trim() || '可执行文件可正常启动。', path: executable };
	} catch (error) {
		return { label, status: 'error', detail: `无法运行：${error instanceof Error ? error.message : String(error)}`, path: executable };
	}
}

function run(executable: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => execFile(executable, args, { timeout: 8000, windowsHide: true }, (error, stdout, stderr) => error ? reject(error) : resolve(`${stdout}\n${stderr}`)));
}

function getHtml(): string {
	return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';"><style>body{margin:0;background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family)}main{max-width:900px;margin:auto;padding:40px 28px}h1{margin:0 0 8px;font-size:28px}p{color:var(--vscode-descriptionForeground);line-height:1.55}.toolbar{display:flex;gap:10px;margin:24px 0}button{border:0;border-radius:3px;padding:8px 14px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);font:inherit;cursor:pointer}.repair{background:var(--vscode-inputValidation-warningBackground);color:var(--vscode-inputValidation-warningForeground)}.list{border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden}.item{display:grid;grid-template-columns:12px 210px 1fr auto;gap:14px;align-items:start;padding:16px;border-bottom:1px solid var(--vscode-editorWidget-border)}.item:last-child{border:0}.dot{width:10px;height:10px;border-radius:50%;margin-top:5px}.ok{background:var(--vscode-testing-iconPassed)}.warning{background:var(--vscode-testing-iconQueued)}.error{background:var(--vscode-testing-iconFailed)}.label{font-weight:600}.detail{color:var(--vscode-descriptionForeground);font-family:var(--vscode-editor-font-family);font-size:12px;overflow-wrap:anywhere}.open{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);padding:5px 9px;font-size:12px}</style></head><body><main><h1>工具链诊断</h1><p>检查 CPH、Compile Run 与 clangd 的实际可执行文件、版本及配置是否一致。黄色表示可继续使用但建议修复，红色表示当前环境无法正常工作。</p><div class="toolbar"><button id="refresh">重新检测</button><button id="redetect">重新探测编译器</button><button id="repair" class="repair" hidden>修复工具链</button></div><div id="list" class="list"></div></main><script>const vscode=acquireVsCodeApi();const list=document.getElementById('list'),repair=document.getElementById('repair');document.getElementById('refresh').onclick=()=>vscode.postMessage({type:'refresh'});document.getElementById('redetect').onclick=()=>vscode.postMessage({type:'redetect'});repair.onclick=()=>vscode.postMessage({type:'repair'});window.addEventListener('message',event=>{if(event.data?.type!=='state')return;repair.hidden=!event.data.value.needsRepair;list.replaceChildren(...event.data.value.items.map(item=>{const row=document.createElement('div');row.className='item';row.innerHTML='<span class="dot '+item.status+'"></span><span class="label"></span><span class="detail"></span>';row.querySelector('.label').textContent=item.label;row.querySelector('.detail').textContent=item.detail;if(item.path){const button=document.createElement('button');button.className='open';button.textContent='打开目录';button.onclick=()=>vscode.postMessage({type:'openPath',path:item.path});row.append(button);}return row;}));});</script></body></html>`;
}

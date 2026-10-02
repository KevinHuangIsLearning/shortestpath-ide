/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Runs in the real desktop extension host; no mock of vscode, OJ or CPH.
const vscode = require('vscode');
const http = require('node:http');
const fs = require('node:fs/promises');
exports.activate = function () { void exports.run().catch(error => console.error('IDE E2E driver failed:', error)); };
exports.run = async function () {
	if (!process.env.SHORTESTPATH_IDE_TEST_TOKEN) throw new Error('Isolated E2E token required');
	const events = [];
	const extension = vscode.extensions.getExtension('shortestpath.shortestpath-oj');
	if (!extension) throw new Error('OJ extension not loaded');
	const { bridge, auxiliaryOperations } = await extension.activate();
	const cphExtension = vscode.extensions.getExtension('DivyanshuAgrawal.competitive-programming-helper');
	await cphExtension.activate();
	const cph = require(require('node:path').join(cphExtension.extensionPath, 'dist/extension.js'));
	bridge.onTrace(message => { events.push(message); });
	const server = http.createServer(async (req, res) => {
		if (req.headers.authorization !== `Bearer ${process.env.SHORTESTPATH_IDE_TEST_TOKEN}`) { res.writeHead(403); res.end(); return; }
		try {
			let raw = ''; for await (const chunk of req) raw += chunk;
			const body = raw ? JSON.parse(raw) : {};
			const session = bridge.getActiveSession();
			let data;
			if (req.url === '/state') data = { session, events };
			else if (req.url === '/request') {
				if (!session) throw new Error('No bound session');
				data = await bridge.requestAuxiliary(session.problemRef, body.type, body.data ?? {}, Boolean(body.sideEffect));
			} else if (req.url === '/submit') {
				data = await bridge.requestSubmission(session.problemRef, body.operationId, body.language ?? 'cpp20', body.code);
			} else if (req.url === '/aux-start') {
				const folder = vscode.workspace.workspaceFolders[0].uri.fsPath;
				const record = JSON.parse(await fs.readFile(require('node:path').join(folder, '.shortestpath', session.problemRef.split('/').map(encodeURIComponent).join('.') + '.json'), 'utf8'));
				data = await auxiliaryOperations.start(bridge, record.problem, body.kind, body.submissionId, body.payload);
			} else if (req.url === '/submit-file') {
				if (!session) throw new Error('No bound session');
				const document = await vscode.workspace.openTextDocument(vscode.Uri.file(body.sourcePath));
				const edit = new vscode.WorkspaceEdit(); edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), body.code);
				if (document.getText() !== body.code) {
					const changed = new Promise((resolve, reject) => {
						const timer = setTimeout(() => { listener.dispose(); reject(new Error('Editor change did not arrive')); }, 5000);
						const listener = vscode.workspace.onDidChangeTextDocument(event => { if (event.document.uri.toString() === document.uri.toString() && event.document.getText() === body.code) { clearTimeout(timer); listener.dispose(); resolve(); } });
					});
					if (!await vscode.workspace.applyEdit(edit)) throw new Error('Workspace edit failed');
					await changed;
				}
				await vscode.commands.executeCommand('shortestpath.oj.submitProblemForUrl', body.url);
				data = { saved: !document.isDirty, source: document.getText() };
			} else if (req.url === '/local-test') {
				const document = await vscode.workspace.openTextDocument(vscode.Uri.file(body.sourcePath));
				const edit = new vscode.WorkspaceEdit(); edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), body.code);
				const editor = await vscode.window.showTextDocument(document); await editor.edit(builder => builder.replace(new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), body.code));
				await document.save();
				const folder = require('node:path').dirname(body.sourcePath);
				const files = await fs.readdir(folder); let problem;
				for (const file of files.filter(name => name.endsWith('.prob'))) { const candidate = JSON.parse(await fs.readFile(require('node:path').join(folder, file), 'utf8')); if (candidate.srcPath === body.sourcePath) { problem = candidate; break; } }
				if (!problem) throw new Error('CPH problem not found');
				const view = cph.getJudgeViewProvider(); const send = view.extensionToJudgeViewMessage.bind(view); const results = [];
				view.extensionToJudgeViewMessage = message => { if (message.command === 'run-single-result') results.push(message.result); return send(message); };
				try { await view.runAllIncludingLargeSamples(problem); } finally { view.extensionToJudgeViewMessage = send; }
				data = { results };
			} else if (req.url === '/stop') { res.end('{}'); server.close(); done();
				await vscode.workspace.saveAll(false);
				void vscode.commands.executeCommand('workbench.action.quit'); return; }
			else throw new Error('Unknown test operation');
			res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, data }));
		} catch (error) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, error: error.message })); }
	});
	let done;
	const finished = new Promise(resolve => { done = resolve; });
	server.listen(21475, '127.0.0.1');
	await fs.writeFile(process.env.SHORTESTPATH_IDE_TEST_READY, 'ready');
	await finished;
};

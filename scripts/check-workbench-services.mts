/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Follow static runtime imports, including named imports and re-exports. Ignore type-only edges.
const root = path.resolve(import.meta.dirname, '..');
const modules = new Map<string, ts.SourceFile>();
function visit(file: string): void {
	if (modules.has(file) || !fs.existsSync(file)) { return; }
	const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
	modules.set(file, source);
	for (const statement of source.statements) {
		if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) { continue; }
		if (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly || ts.isExportDeclaration(statement) && statement.isTypeOnly) { continue; }
		if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) { continue; }
		const ref = statement.moduleSpecifier.text;
		const dependency = ref.startsWith('.') ? path.resolve(path.dirname(file), ref) : ref.startsWith('vs/') ? path.resolve(root, 'src', ref) : undefined;
		if (dependency) { visit(dependency.replace(/\.js$/, '.ts')); }
	}
}
visit(path.join(root, 'src/vs/workbench/workbench.desktop.main.ts'));
// Restoring extension API services must never restore the Chat sidebar.
assert.ok(!modules.has(path.join(root, 'src/vs/workbench/contrib/chat/browser/chat.view.contribution.ts')), 'Chat view registration must stay outside the desktop import closure');
const participantModule = modules.get(path.join(root, 'src/vs/workbench/contrib/chat/browser/chatParticipant.contribution.ts'));
assert.ok(participantModule, 'Chat participant extension support must remain reachable');
assert.doesNotMatch(participantModule.text, /\.register(?:ViewContainer|Views)\(/, 'Participant support must not register Chat UI');

const services = new Map<string, Set<string>>();
const injections = new Map<string, Set<string>>();
for (const [file, source] of modules) {
	const walk = (node: ts.Node): void => {
		if (ts.isCallExpression(node)) {
			const name = node.expression.getText(source);
			const token = node.arguments[0];
			if ((name === 'registerSingleton' || name === 'serviceCollection.set') && token && ts.isIdentifier(token)) {
				const files = services.get(token.text) ?? new Set<string>();
				files.add(file); services.set(token.text, files);
			}
		}
		if (ts.isDecorator(node) && ts.isCallExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
			const token = node.expression.expression.text;
			const files = injections.get(token) ?? new Set<string>();
			files.add(file); injections.set(token, files);
		}
		ts.forEachChild(node, walk);
	};
	walk(source);
}
const family = /^I(?:Chat|Agent|LanguageModel|Mcp|Interactive|InlineChat|RemoteAgentHost|SSHRemoteAgentHost|WSLRemoteAgentHost)/;
const missing: string[] = [];
for (const [token, files] of injections) {
	if (family.test(token) && !services.has(token)) { missing.push(`${token}: ${[...files].map(file => path.relative(root, file)).join(', ')}`); }
}
assert.deepEqual(missing, [], 'Missing Chat/Agent services in desktop import closure');
for (const token of ['IInlineChatSessionService', 'IInlineChatSessionResolver', 'IAgentHostByokLmHandler', 'IRemoteAgentHostLocationPreferenceService']) {
	assert.equal(services.get(token)?.size, 1, `${token} must have exactly one registration`);
}
// Every mainThread customer must remain reachable; every decorator above was inspected.
const customers = fs.readdirSync(path.join(root, 'src/vs/workbench/api/browser')).filter(file => /^mainThread.*\.ts$/.test(file));
for (const customer of customers) {
	assert.ok(modules.has(path.join(root, 'src/vs/workbench/api/browser', customer)), `Customer omitted: ${customer}`);
}
console.log(`Verified ${customers.length} customers and Chat/Agent dependencies across ${modules.size} modules.`);

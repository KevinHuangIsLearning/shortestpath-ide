import * as assert from "assert";

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from "vscode";
import { parseFile } from "../utils/file-utils";
import { FileType } from "../enums/file-type";

suite("Extension Test Suite", () => {
	vscode.window.showInformationMessage("Start all tests.");

	test("parseFile should correctly map TextDocument to File model", () => {
		// Mocking a VS Code TextDocument
		const mockDoc = {
			fileName: process.platform === "win32" ? "C:\\project\\main.cpp" : "/project/main.cpp",
			languageId: "cpp"
		} as vscode.TextDocument;

		const file = parseFile(mockDoc);

		assert.strictEqual(file.name, "main.cpp");
		assert.strictEqual(file.title, "main");
		assert.strictEqual(file.type, FileType.cplusplus);
		
		if (process.platform === "win32") {
			assert.match(file.executable, /^shortestpath-[a-f0-9]{24}\.exe$/);
		} else {
			assert.strictEqual(file.executable, "main");
		}
	});

	test("Windows output names are ASCII, stable and distinct for Chinese sources sharing an output folder", function () {
		if (process.platform !== "win32") { this.skip(); }
		const parse = (fileName: string) => parseFile({ fileName, languageId: "cpp" } as vscode.TextDocument);
		const source = "C:\\中文目录\\中文题目.cpp";
		const output = parse(source).executable;
		assert.match(output, /^shortestpath-[a-f0-9]{24}\.exe$/);
		assert.strictEqual(parse(source).executable, output);
		assert.strictEqual(parse(source.toUpperCase()).executable, output);
		assert.strictEqual(new Set([
			output,
			parse("C:\\其他目录\\中文题目.cpp").executable,
			parse("C:\\中文目录\\中文题目.c").executable,
			parse("C:\\中文目录\\另一道题.cpp").executable
		]).size, 4);
	});
});

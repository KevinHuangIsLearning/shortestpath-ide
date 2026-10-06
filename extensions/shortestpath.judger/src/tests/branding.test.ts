import fs from 'fs';
import path from 'path';
import { translations } from '../webview/translations';

const root = path.resolve(__dirname, '../..');
const oldBrand = /CPH|Competitive Programming Helper/;

test('manifest and every localized contribution use Judger branding', () => {
	const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
	expect(manifest.displayName).toBe('ShortestPath Judger');
	for (const file of fs.readdirSync(root).filter(file => /^package\.nls.*\.json$/.test(file))) {
		const values = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
		expect(values['judger.judgeViewContainer.title']).toBe('ShortestPath Judger');
		expect(values['judger.configuration.title']).toBe('ShortestPath Judger');
		for (const value of Object.values(values)) { expect(value).not.toMatch(oldBrand); }
	}
});

test('all static and dynamic Webview translation values use Judger branding', () => {
	for (const locale of Object.values(translations)) {
		for (const value of Object.values(locale)) { expect(value).not.toMatch(oldBrand); }
	}
});

test('bundled Chinese language pack matches the extension contribution translations', () => {
	const pack = JSON.parse(fs.readFileSync(path.join(root, '../MS-CEINTL.vscode-language-pack-zh-hans/translations/extensions/shortestpath.judger.i18n.json'), 'utf8'));
	const local = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.zh-cn.json'), 'utf8'));
	expect(pack.contents.package).toEqual(local);
});

test('About identifies Judger and import actions name the imported content', () => {
	for (const locale of Object.values(translations)) {
		expect(locale.cphDescription).toContain('ShortestPath Judger');
		expect(locale.cphDescription).toContain('Divyanshu Agrawal');
	}
	for (const key of ['fromZip', 'fromFiles', 'fromFolder']) {
		expect(translations.en[key]).toContain('Import Testcases');
		expect(translations['zh-cn'][key]).toContain('导入测试点');
	}
	const app = fs.readFileSync(path.join(root, 'src/webview/frontend/App.tsx'), 'utf8');
	expect(app).not.toContain("t('largeSampleChooseDirectory')");
	const toolbar = fs.readFileSync(path.join(root, 'src/webview/frontend/components/TestcaseToolbar.tsx'), 'utf8');
	expect(toolbar).toContain("t('importTestcases')");
	expect(app).not.toContain('testcase-import-row');
	expect(toolbar).toContain("aria-label={t('newTestcase')}");
});

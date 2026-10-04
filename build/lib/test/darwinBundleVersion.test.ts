/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { suite, test } from 'node:test';
import { updateDarwinBundleVersion } from '../darwinBundleVersion.ts';

suite('macOS product bundle version', () => {
	const plist = Buffer.from('<plist><dict><key>CFBundleShortVersionString</key><string>1.139.1</string><key>CFBundleVersion</key><string>1.139.1</string></dict></plist>');
	test('updates the main bundle and preserves nested helpers and app metadata', () => {
		const paths = ['ShortestPath IDE.app/Contents/Info.plist', 'ShortestPath IDE.app/Contents/Frameworks/ShortestPath Helper.app/Contents/Info.plist', 'ShortestPath IDE.app/Contents/Resources/app/package.json'];
		assert.deepStrictEqual(paths.map(file => updateDarwinBundleVersion(file, plist, 'ShortestPath IDE', '0.3.16').toString()), [plist.toString().replaceAll('1.139.1', '0.3.16'), plist.toString(), plist.toString()]);
	});
	test('fails packaging for invalid versions or missing plist keys', () => {
		assert.throws(() => updateDarwinBundleVersion('ShortestPath IDE.app/Contents/Info.plist', plist, 'ShortestPath IDE', 'invalid'));
		assert.throws(() => updateDarwinBundleVersion('ShortestPath IDE.app/Contents/Info.plist', Buffer.from('<plist/>'), 'ShortestPath IDE', '0.3.16'));
	});
});

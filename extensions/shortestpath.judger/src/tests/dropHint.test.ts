/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { dismissProblemDropHint, dropHintProblemKey } from '../webview/frontend/dropHint';

test('closing a hint survives reload for only its problem, including reused source files', () => {
	const first = { srcPath: '/workspace/A.cpp', url: 'https://oj.test/1' };
	const second = { srcPath: '/workspace/B.cpp', url: 'https://oj.test/2' };
	const rebound = { ...first, url: 'https://oj.test/3' };
	const persisted = JSON.parse(JSON.stringify(dismissProblemDropHint([], first))) as string[];
	expect([persisted.includes(dropHintProblemKey(first)), persisted.includes(dropHintProblemKey(second)), persisted.includes(dropHintProblemKey(rebound)), dismissProblemDropHint(persisted, first)]).toEqual([true, false, false, persisted]);
});

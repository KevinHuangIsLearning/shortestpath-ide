/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ProblemHeader from '../webview/frontend/components/ProblemHeader';

const renderHeader = (accepted: boolean, partialAccepted: boolean, canMarkAccepted = true) => {
	// allow-any-unicode-next-line
	Object.defineProperty(globalThis, 'window', { value: { translations: { completionStatus: '完成状态', partialAccepted: '部分 AC', markAccepted: '标记 AC' } }, configurable: true });
	try {
		return renderToStaticMarkup(<ProblemHeader name="External problem title" accepted={accepted} partialAccepted={partialAccepted}
			canMarkAccepted={canMarkAccepted} onMarkAccepted={() => {}} onSetCompletion={() => {}} compiling={false}
			summary={{ empty: true, passed: 0, failed: 0, total: 0, pending: 0 }} settingsOpen={false} auxOpen={false}
			onOpenSettings={() => {}} onToggleAux={() => {}} />);
	} finally { Reflect.deleteProperty(globalThis, 'window'); }
};

// allow-any-unicode-next-line
test.each<[boolean, boolean, string]>([[false, false, '标记 AC'], [true, false, 'AC'], [false, true, '部分 AC'], [true, true, 'AC']])(
	'completion states share one collapsed menu entry (AC=%s, partial=%s)', (accepted, partial, label) => {
		const html = renderHeader(accepted, partial);
		expect(html.match(/mark-accepted-btn/g)).toHaveLength(1);
		expect(html).toContain('aria-expanded="false"');
		expect(html).toContain(`${label}<i class="codicon codicon-chevron-down"`);
		expect(html.includes('mark-accepted-btn is-accepted')).toBe(accepted);
		expect(html.includes('codicon-check')).toBe(accepted);
		expect(html).not.toContain('role="group"');
		expect(html).toContain('External problem title');
	});

test('OJ-managed completion stays read-only', () => {
	const html = renderHeader(true, false, false);
	expect(html).toContain('problem-accepted-indicator');
	expect(html).not.toContain('mark-accepted-btn');
});

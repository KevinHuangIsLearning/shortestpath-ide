import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import JudgeActionBar from '../webview/frontend/components/JudgeActionBar';

test.each([false, true])('Run All and Stop share one action slot (running=%s)', running => {
    Object.defineProperty(globalThis, 'window', { value: { translations: {} }, configurable: true });
    try {
        const html = renderToStaticMarkup(<JudgeActionBar running={running} onRunAll={() => {}} onStop={() => {}} onStress={() => {}} />);
        expect(html.includes('stop-all-btn')).toBe(running);
        expect(html.includes('split-btn')).toBe(!running);
        expect(html.match(/actions-main-row/g)).toHaveLength(1);
    } finally { delete (globalThis as { window?: unknown }).window; }
});

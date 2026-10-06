import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CaseView from '../webview/frontend/CaseView';

test('file-backed input and answer render file actions instead of textareas', () => {
    Object.defineProperty(globalThis, 'window', { value: { translations: {} }, configurable: true });
    try {
        const html = renderToStaticMarkup(<CaseView num={1}
            case={{ id: 1, testcase: { id: 1, input: '', output: '', inputPath: '/large.in', outputPath: '/large.out' }, result: null }}
            rerun={() => {}} updateCase={() => {}} notify={() => {}}
            forceRunning={false} forceChecking={false} stop={() => {}} openFile={() => {}} />);
        expect(html).toContain('/large.in');
        expect(html).toContain('/large.out');
        expect(html).not.toContain('<textarea');
    } finally { Reflect.deleteProperty(globalThis, 'window'); }
});

test('testcase cards render their menu anchor when the menu callback is available', () => {
    Object.defineProperty(globalThis, 'window', { value: { translations: {} }, configurable: true });
    try {
        const html = renderToStaticMarkup(<CaseView num={1}
            case={{ id: 1, testcase: { id: 1, input: '41', output: '42' }, result: null }}
            rerun={() => {}} updateCase={() => {}} notify={() => {}} more={() => {}}
            forceRunning={false} forceChecking={false} stop={() => {}} openFile={() => {}} />);
        expect(html).toContain('data-case-menu-anchor="true"');
        expect(html).toContain('codicon-ellipsis');
    } finally { Reflect.deleteProperty(globalThis, 'window'); }
});

import { diffOutputPreview } from '../utils/diffOutput';
test('file-backed results render only file links and a bounded diff, with no output textarea', () => {
    Object.defineProperty(globalThis, 'window', { value: { translations: {} }, configurable: true });
    try {
        const html = renderToStaticMarkup(<CaseView num={1}
            case={{ id: 1, testcase: { id: 1, input: '', output: '', inputPath: '/large.in', outputPath: '/large.out' },
                result: { id: 1, pass: false, verdict: 'WA', stdout: 'must-not-render', stderr: 'must-not-render-stderr', stdoutPath: '/actual.out', stderrPath: '/actual.err', code: 0, signal: null, time: 1, timeOut: false, diff: diffOutputPreview('expected\n', 'received\n') } }}
            rerun={() => {}} updateCase={() => {}} notify={() => {}}
            forceRunning={false} forceChecking={false} stop={() => {}} openFile={() => {}} />);
        expect(html).toContain('/actual.out');
        expect(html).toContain('output-diff-preview');
        expect(html).not.toContain('<textarea');
        expect(html).not.toContain('must-not-render');
    } finally { Reflect.deleteProperty(globalThis, 'window'); }
});

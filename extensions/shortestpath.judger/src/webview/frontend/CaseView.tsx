import {
    Case,
    VSToWebViewMessage,
    DiffResult,
    TokenDiff,
} from '../../types';
import { useState, createRef, useEffect } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import TestCaseCard, { CaseDrag } from './TestCaseCard';
import { MenuAnchor } from './components/CaseActionsMenu';
import { t } from './i18n';
import {
    CaseState,
    truncatePreview,
    verdictOf,
} from './selectors';

import React from 'react';


const fileName = (filePath: string): string =>
    filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;

/** Short trailing summary; never reads the file to show size or line counts. */
const pathSummary = (filePath: string): string => {
    const parts = filePath.split(/[\\/]/).filter(Boolean);
    return parts.length <= 2 ? filePath : `…/${parts.slice(-2).join('/')}`;
};

export default function CaseView(props: {
    num: number;
    case: Case;
    rerun: (id: number, input: string, output: string) => void;
    updateCase: (id: number, input: string, output: string) => void;
    notify: (text: string) => void;
    doFocus?: boolean;
    forceRunning: boolean;
    forceChecking: boolean;
    customCheckerPath?: string;
    expandOnResult?: boolean;
    more?: (anchor: MenuAnchor) => void;
    drag?: CaseDrag;
    stop: () => void;
    openFile?: (path: string) => void;
}) {
    const { id, result } = props.case;

    const input = props.case.testcase.input;
    const output = props.case.testcase.output;
    const [running, setRunning] = useState<boolean>(false);
    const [checking, setChecking] = useState<boolean>(false);
    const [minimized, setMinimized] = useState<boolean>(
        props.case.result?.pass === true,
    );
    const inputBox = createRef<HTMLTextAreaElement>();

    useEffect(() => {
        if (props.doFocus) {
            inputBox.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [props.doFocus]);

    useEffect(() => {
        if (props.forceRunning) {
            setRunning(true);
            setChecking(false);
        }
    }, [props.forceRunning]);

    useEffect(() => {
        if (props.forceChecking) {
            setRunning(false);
            setChecking(true);
        }
    }, [props.forceChecking]);

    const handleInputChange = (
        event: React.ChangeEvent<HTMLTextAreaElement>,
    ) => {
        props.updateCase(id, event.target.value, output);
    };

    const handleOutputChange = (
        event: React.ChangeEvent<HTMLTextAreaElement>,
    ) => {
        props.updateCase(id, input, event.target.value);
    };

    const rerun = () => {
        if (props.case.testcase.disabled) { return; }
        setRunning(true);
        props.rerun(id, input, output);
    };

    useEffect(() => {
        if (props.case.result !== null) {
            setRunning(false);
            setChecking(false);
            if (props.expandOnResult !== undefined) { setMinimized(!props.expandOnResult); }
        }
    }, [props.case.result, props.expandOnResult]);

    useEffect(() => {
        if (running || checking) {
            setMinimized(true);
        }
    }, [running, checking]);

    useEffect(() => {
        window.addEventListener('message', function (event) {
            const data: VSToWebViewMessage = event.data;
            switch (data.command) {
                case 'not-running': {
                    setRunning(false);
                    break;
                }
            }
        });
    }, [props.case]);

    let resultText = '';
    const stderror = result?.stderr;
    // Handle several cases for result text
    if (result?.signal) {
        resultText = result?.signal;
    } else if (result?.stdout) {
        const rawStdout = result.stdout || ' ';
        if (rawStdout.endsWith('\r\n')) {
            resultText = rawStdout.slice(0, -2);
        } else if (rawStdout.endsWith('\n')) {
            resultText = rawStdout.slice(0, -1);
        } else {
            resultText = rawStdout;
        }
        if (resultText === '') {
            resultText = ' ';
        }
    }
    if (!result) {
        resultText = t('runToShowOutput');
    }
    if (running || checking) {
        resultText = '...';
    }

    const state: CaseState = running
          ? 'running'
          : checking
            ? 'checking'
            : props.case.testcase.disabled
              ? 'disabled'
              : result
                ? result.pass
                  ? 'passed'
                  : 'failed'
                : 'pending';
    const cardTime = result
          ? result.timeOut
            ? t('timedOut')
            : `${result.time}ms${result.memoryBytes === undefined ? '' : ` · ${(result.memoryBytes / 1048576).toFixed(1)} MiB`}`
          : undefined;
    const verdict = verdictOf(result);
    const executionFailure = result;
    const failureText = executionFailure?.signal
        ? executionFailure.signal
        : executionFailure?.timeOut
          ? t('timedOut')
          : executionFailure?.outputLimitExceeded
            ? 'Output limit exceeded'
            : executionFailure?.code !== null &&
                executionFailure?.code !== undefined &&
                executionFailure.code !== 0
              ? `Exit code ${executionFailure.code}`
              : undefined;
    const checkerVerdict =
        result?.checkerRun?.verdict && result.checkerRun.verdict !== 'AC'
            ? `Checker ${result.checkerRun.verdict}`
            : undefined;

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        props.notify(t('copiedToClipboard'));
    };

    const fileReference = (
        label: string,
        filePath: string,
        open: () => void,
    ) => (
        <div className="file-reference">
            <span className="file-reference-label">{label}</span>
            <span className="file-reference-name" title={filePath}>
                {fileName(filePath)}
            </span>
            <span className="file-reference-path" title={filePath}>
                {pathSummary(filePath)}
            </span>
            <button
                type="button"
                className="btn btn-black"
                title={t('openFile')}
                onClick={open}
            >
                <i className="codicon codicon-link-external" aria-hidden="true"></i>{' '}
                {t('openFile')}
            </button>
            <button
                type="button"
                className="btn btn-black"
                title={t('copyFilePath')}
                aria-label={t('copyFilePath')}
                onClick={() => copyToClipboard(filePath)}
            >
                <i className="codicon codicon-copy" aria-hidden="true"></i>
            </button>
        </div>
    );

    const preview = truncatePreview(resultText);
    const stderrPreview = truncatePreview(stderror || '');

    const details = (
        <div className="case-details-inner">
                <>
                    <section className="case-section" aria-label={t('dataSection')}>
                        <h4 className="case-section-title">{t('dataSection')}</h4>
                        {props.case.testcase.inputPath
                            ? fileReference(t('inputLabel'), props.case.testcase.inputPath, () => props.openFile?.(props.case.testcase.inputPath!))
                            : <div className="textarea-container">
                                {t('inputLabel')}
                                <div
                                    className="clipboard"
                                    onClick={() => copyToClipboard(input)}
                                    title={t('copiedToClipboard')}
                                >
                                    {t('copy')}
                                </div>
                                <TextareaAutosize
                                    className="selectable input-textarea"
                                    onChange={handleInputChange}
                                    value={input}
                                    ref={inputBox}
                                    autoFocus={props.doFocus && !minimized}
                                />
                            </div>}
                        {props.case.testcase.outputPath
                            ? fileReference(t('expectedOutputLabel'), props.case.testcase.outputPath, () => props.openFile?.(props.case.testcase.outputPath!))
                            : <div
                                className={`textarea-container expected-output-container ${
                                    props.customCheckerPath?.trim().toLowerCase().endsWith('.py') ? 'hidden' : ''
                                }`}
                            >
                                {t('expectedOutputLabel')}
                                <div
                                    className="clipboard"
                                    onClick={() => copyToClipboard(output)}
                                    title={t('copiedToClipboard')}
                                >
                                    {t('copy')}
                                </div>
                                <TextareaAutosize
                                    className="selectable expected-textarea"
                                    onChange={handleOutputChange}
                                    value={output}
                                />
                            </div>}
                    </section>

                    {props.case.result != null && (
                        <section className="case-section" aria-label={t('resultSection')}>
                            <h4 className="case-section-title">{t('resultSection')}</h4>
                            {result?.stdoutPath && fileReference(t('receivedOutputLabel'), result.stdoutPath, () => props.openFile?.(result.stdoutPath!))}
                            {!result?.stdoutPath && <div className="textarea-container">
                                {t('receivedOutputLabel')}
                                <div
                                    className="clipboard"
                                    onClick={() => copyToClipboard(resultText)}
                                    title={t('copiedToClipboard')}
                                >
                                    {t('copy')}
                                </div>
                                {!props.case.testcase.outputPath && !result?.stdoutPath && <div
                                    className="expectedoutput"
                                    onClick={() => {
                                        props.updateCase(id, input, resultText);
                                        props.notify(t('setAsExpectedOutput'));
                                    }}
                                    title={t('setAsExpectedOutput')}
                                >
                                    {t('set')}
                                </div>}
                                <TextareaAutosize
                                    className="selectable received-textarea"
                                    value={preview.text}
                                    readOnly
                                />
                                {preview.truncated && (
                                    <small className="truncation-note">{t('previewTruncated')}</small>
                                )}
                            </div>}
                            {result != null && (result.diff?.preview || !result.pass) && result.diff != null && (window as any).showOutputDifference !== false && (
                                <DiffView diff={result.diff} copyToClipboard={copyToClipboard} />
                            )}
                        </section>
                    )}

                    {(stderror || result?.stderrPath || result?.checkerRun) && !running && !checking && (
                        <section className="case-section case-section-diagnostics" aria-label={t('diagnosticsSection')}>
                            <h4 className="case-section-title">{t('diagnosticsSection')}</h4>
                            {result?.stderrPath && fileReference(t('stderrFile'), result.stderrPath, () => props.openFile?.(result.stderrPath!))}
                            {!result?.stderrPath && stderror && stderror.length > 0 && (
                                <div className="textarea-container">
                                    {t('standardError')}
                                    <TextareaAutosize
                                        className="selectable stderror-textarea"
                                        value={stderrPreview.text}
                                        readOnly
                                    />
                                    {stderrPreview.truncated && (
                                        <small className="truncation-note">{t('previewTruncated')}</small>
                                    )}
                                </div>
                            )}
                            {result?.checkerRun && (
                                <details className="checker-details">
                                    <summary>
                                        {t('checkerLog')}{result.checkerRun.verdict ? ` · ${result.checkerRun.verdict}` : ''}
                                    </summary>
                                    <div className="checker-details-body">
                                        <small>
                                            {t('checkerExitCode')}{' '}
                                            <code>
                                                {result.checkerRun.code !== null
                                                    ? result.checkerRun.code
                                                    : result.checkerRun.signal || 'Terminated'}
                                            </code>
                                        </small>
                                        <small>{t('checkerOutput')}</small>
                                        <textarea
                                            className="selectable"
                                            readOnly
                                            value={truncatePreview(
                                                `STDOUT:\n${result.checkerRun.stdout}\n\nSTDERR:\n${result.checkerRun.stderr}`,
                                            ).text}
                                        />
                                        <small>{t('checkerInvocation')}</small>
                                        <textarea
                                            className="selectable checker-command"
                                            readOnly
                                            value={result.checkerRun.command}
                                        />
                                        <small>
                                            {t('checkerDuration')}{' '}
                                            {result.checkerRun.code === null
                                                ? 'Terminated'
                                                : `${result.checkerRun.time}ms`}
                                        </small>
                                    </div>
                                </details>
                            )}
                        </section>
                    )}
                </>
        </div>
    );

    return (
        <TestCaseCard
            detailsId={`case-details-${id}`}
            more={props.more}
            drag={props.drag}
            title={`TC ${props.num}`}
            state={state}
            verdict={checkerVerdict ? undefined : verdict}
            time={cardTime}
            failureText={checkerVerdict || failureText}
            minimized={minimized}
            toggle={() => setMinimized((value) => !value)}
            run={rerun}
            stop={props.stop}
        >
            {details}
        </TestCaseCard>
    );
}

function DiffView({
    diff,
    copyToClipboard,
}: {
    diff: DiffResult;
    copyToClipboard: (text: string) => void;
}) {
    if (diff.preview) {
        return (
            <div className="output-diff-preview">
                <h4 className="case-section-title">{t('diffPreview')}</h4>
                {diff.lines.map(line => (
                    <div className={`output-diff-preview-line diff-${line.type}`} key={line.lineNumber}>
                        <span>{line.lineNumber}</span>
                        <pre title={t('expectedOutputLabel')}>{line.expected ?? ''}</pre>
                        <pre title={t('receivedOutputLabel')}>{line.received ?? ''}</pre>
                    </div>
                ))}
                <small className="truncation-note">{t('previewTruncated')}</small>
            </div>
        );
    }
    if (diff.isMatch) {
        return null;
    }

    // Plain text version for clipboard (actual received output)
    const plainText = diff.tokenDiff
        .filter((t) => t.status !== 'missing')
        .map((t) => t.token)
        .join('');

    return (
        <div className="textarea-container">
            {t('outputDifference')}
            <div
                className="clipboard"
                onClick={() => copyToClipboard(plainText)}
                title={t('copiedToClipboard')}
            >
                {t('copy')}
            </div>
            <div className="selectable received-textarea diff-view">
                {diff.tokenDiff.map((t, idx) => (
                    <TokenChip key={idx} token={t} />
                ))}
            </div>
        </div>
    );
}

function TokenChip({ token }: { token: TokenDiff }) {
    if (token.token === '\n') {
        return <br />;
    }

    if (token.status === 'match') {
        return <span>{token.token}</span>;
    }

    // 'extra' is output the program produced that was not expected; 'missing' is
    // expected output the program never produced.
    return (
        <span
            className={
                token.status === 'extra'
                    ? 'diff-token-extra'
                    : 'diff-token-missing'
            }
        >
            {token.token}
        </span>
    );
}

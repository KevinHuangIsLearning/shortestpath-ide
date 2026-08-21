import {
    Case,
    ExecutionFailureSummary,
    LargeSampleCase,
    VSToWebViewMessage,
    DiffResult,
    TokenDiff,
} from '../../types';
import { useState, createRef, useEffect, useRef } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import TestCaseCard, { TestCaseCardState } from './TestCaseCard';

import React from 'react';

interface CustomWindow extends Window {
    translations: Record<string, string>;
}
declare const window: CustomWindow;

const t = (key: string): string => {
    return window.translations[key] || key;
};

export type LargeSampleCaseState =
    | 'pending'
    | 'running'
    | 'passed'
    | 'failed'
    | 'skipped';

export default function CaseView(props: {
    num: number;
    case: Case;
    rerun: (id: number, input: string, output: string) => void;
    updateCase: (id: number, input: string, output: string) => void;
    remove: (num: number) => void;
    notify: (text: string) => void;
    doFocus?: boolean;
    forceRunning: boolean;
    forceChecking: boolean;
    customCheckerPath?: string;
    stop: () => void;
    fileCase?: {
        testcase: LargeSampleCase;
        state: LargeSampleCaseState;
        outputPath?: string;
        reason?: string;
        time?: number;
        execution?: ExecutionFailureSummary;
        openFile: (path: string) => void;
        rerun: () => void;
        toggleSkip: () => void;
    };
}) {
    const { id, result } = props.case;
    const fileCase = props.fileCase;

    const [input, setInput] = useState<string>(props.case.testcase.input);
    const [output, setOutput] = useState<string>(props.case.testcase.output);
    const [running, setRunning] = useState<boolean>(false);
    const [checking, setChecking] = useState<boolean>(false);
    const [deleteArmed, setDeleteArmed] = useState<boolean>(false);
    const deleteArmedTimer = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
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
        props.updateCase(props.case.id, input, output);
    }, [input, output]);

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
        setInput(event.target.value);
    };

    const handleOutputChange = (
        event: React.ChangeEvent<HTMLTextAreaElement>,
    ) => {
        setOutput(event.target.value);
    };

    const rerun = () => {
        if (fileCase) {
            fileCase.rerun();
            return;
        }
        setRunning(true);
        props.rerun(id, input, output);
    };

    const remove = () => {
        if (fileCase) {
            fileCase.toggleSkip();
            return;
        }
        if (!deleteArmed) {
            setDeleteArmed(true);
            if (deleteArmedTimer.current) {
                clearTimeout(deleteArmedTimer.current);
            }
            deleteArmedTimer.current = setTimeout(() => {
                setDeleteArmed(false);
                deleteArmedTimer.current = null;
            }, 3000);
            return;
        }
        if (deleteArmedTimer.current) {
            clearTimeout(deleteArmedTimer.current);
            deleteArmedTimer.current = null;
        }
        props.remove(id);
    };

    useEffect(() => {
        return () => {
            if (deleteArmedTimer.current) {
                clearTimeout(deleteArmedTimer.current);
            }
        };
    }, []);

    const expand = () => {
        setMinimized(false);
    };

    const minimize = () => {
        setMinimized(true);
    };

    const toggle = () => (minimized ? expand() : minimize());

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        props.notify(t('copiedToClipboard'));
    };

    useEffect(() => {
        if (props.case.result !== null) {
            setRunning(false);
            setChecking(false);
            props.case.result.pass ? setMinimized(true) : setMinimized(false);
        }
    }, [props.case.result]);

    useEffect(() => {
        if (!fileCase) return;
        if (fileCase.state === 'passed') {
            setMinimized(true);
        } else if (fileCase.state === 'failed') {
            setMinimized(false);
        }
    }, [fileCase?.state]);

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
    const cardState: TestCaseCardState = fileCase
        ? fileCase.state
        : running
          ? 'running'
          : checking
            ? 'checking'
            : result
              ? result.pass
                ? 'passed'
                : 'failed'
              : 'pending';
    const cardTime = fileCase
        ? fileCase.time === undefined
            ? undefined
            : `${fileCase.time}ms`
        : result
          ? result.timeOut
            ? t('timedOut')
            : `${result.time}ms`
          : undefined;
    const executionFailure = fileCase?.execution || result;
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
              : fileCase?.reason;

    return (
        <TestCaseCard
            title={fileCase ? `Large TC ${props.num}` : `TC ${props.num}`}
            state={cardState}
            time={cardTime}
            failureText={failureText}
            minimized={minimized}
            toggle={toggle}
            run={rerun}
            stop={props.stop}
            secondaryAction={remove}
            secondaryKind={fileCase ? 'skip' : 'delete'}
            secondaryArmed={fileCase ? false : deleteArmed}
        >
                <div className={`case-details-inner ${fileCase ? 'large-sample-case-actions' : ''}`}>
                    {fileCase ? (
                        <>
                            <button
                                className="btn btn-black"
                                onClick={() =>
                                    fileCase.openFile(fileCase.testcase.inputPath)
                                }
                            >
                                {t('largeSampleViewInput')}
                            </button>
                            <button
                                className="btn btn-black"
                                onClick={() =>
                                    fileCase.openFile(fileCase.testcase.answerPath)
                                }
                            >
                                {t('largeSampleViewAnswer')}
                            </button>
                            {fileCase.outputPath && (
                                <button
                                    className="btn btn-black"
                                    onClick={() =>
                                        fileCase.openFile(fileCase.outputPath!)
                                    }
                                >
                                    {t('largeSampleViewOutput')}
                                </button>
                            )}
                        </>
                    ) : (
                        <>
                    <div className="textarea-container">
                        {t('inputLabel')}
                        <div
                            className="clipboard"
                            onClick={() => {
                                copyToClipboard(input);
                            }}
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
                    </div>
                    <div
                        className={`textarea-container expected-output-container ${
                            props.customCheckerPath?.trim() ? 'hidden' : ''
                        }`}
                    >
                        {t('expectedOutputLabel')}
                        <div
                            className="clipboard"
                            onClick={() => {
                                copyToClipboard(output);
                            }}
                            title={t('copiedToClipboard')}
                        >
                            {t('copy')}
                        </div>
                        <TextareaAutosize
                            className="selectable expected-textarea"
                            onChange={handleOutputChange}
                            value={output}
                        />
                    </div>
                    {props.case.result != null && (
                        <div className="textarea-container">
                            {t('receivedOutputLabel')}
                            <div
                                className="clipboard"
                                onClick={() => {
                                    copyToClipboard(resultText);
                                }}
                                title={t('copiedToClipboard')}
                            >
                                {t('copy')}
                            </div>
                            <div
                                className="expectedoutput"
                                onClick={() => {
                                    setOutput(resultText);
                                    props.notify(t('setAsExpectedOutput'));
                                }}
                                title={t('setAsExpectedOutput')}
                            >
                                {t('set')}
                            </div>
                            <>
                                <TextareaAutosize
                                    className="selectable received-textarea"
                                    value={trunctateStdout(resultText)}
                                    readOnly
                                />
                            </>
                        </div>
                    )}
                    {props.case.result?.checkerRun && !running && !checking && (
                        <details style={{ marginTop: '10px' }}>
                            <summary
                                style={{
                                    cursor: 'pointer',
                                    fontSize: '0.9em',
                                    opacity: 0.8,
                                }}
                            >
                                {t('checkerLog')}
                            </summary>
                            <div style={{ marginTop: '5px' }}>
                                <small
                                    style={{
                                        display: 'block',
                                        marginTop: '5px',
                                    }}
                                >
                                    {t('checkerExitCode')}{' '}
                                    <code>
                                        {props.case.result.checkerRun.code !==
                                        null
                                            ? props.case.result.checkerRun.code
                                            : props.case.result.checkerRun
                                                  .signal || 'Terminated'}
                                    </code>
                                </small>
                                <small
                                    style={{
                                        display: 'block',
                                        marginTop: '10px',
                                    }}
                                >
                                    {t('checkerOutput')}
                                </small>
                                <textarea
                                    className="selectable"
                                    readOnly
                                    value={trunctateStdout(
                                        `STDOUT:\n${props.case.result.checkerRun.stdout}\n\nSTDERR:\n${props.case.result.checkerRun.stderr}`,
                                    )}
                                    style={{
                                        fontSize: '0.9em',
                                        height: '100px',
                                        width: '100%',
                                        display: 'block',
                                        marginTop: '5px',
                                    }}
                                />
                                <small
                                    style={{
                                        display: 'block',
                                        marginTop: '10px',
                                    }}
                                >
                                    {t('checkerInvocation')}
                                </small>
                                <textarea
                                    className="selectable"
                                    readOnly
                                    value={props.case.result.checkerRun.command}
                                    style={{
                                        fontSize: '0.9em',
                                        height: '40px',
                                        width: '100%',
                                        display: 'block',
                                        marginTop: '5px',
                                    }}
                                />
                                <small
                                    style={{
                                        display: 'block',
                                        marginTop: '10px',
                                    }}
                                >
                                    {t('checkerDuration')}{' '}
                                    {props.case.result.checkerRun.code === null
                                        ? 'Terminated'
                                        : `${props.case.result.checkerRun.time}ms`}
                                </small>
                            </div>
                        </details>
                    )}
                    {result != null &&
                        !result.pass &&
                        result.diff != null &&
                        (window as any).showOutputDifference !== false && (
                            <DiffView
                                diff={result.diff}
                                copyToClipboard={copyToClipboard}
                            />
                        )}
                    {stderror && stderror.length > 0 && (
                        <div className="textarea-container">
                            {t('standardError')}
                            <TextareaAutosize
                                className="selectable stderror-textarea"
                                value={trunctateStdout(stderror)}
                                readOnly
                            />
                        </div>
                    )}
                        </>
                    )}
                </div>
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
            <div style={{ display: 'inline-flex', gap: '6px', float: 'right' }}>
                <div
                    className="clipboard"
                    onClick={() => copyToClipboard(plainText)}
                    title={t('copiedToClipboard')}
                >
                    {t('copy')}
                </div>
            </div>
            <div style={{ clear: 'both' }} />
            <div
                className="selectable received-textarea"
                style={{
                    padding: '6px',
                    lineHeight: '1.5',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                }}
            >
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

    if (token.status === 'extra') {
        return (
            <span
                style={{
                    backgroundColor:
                        'var(--vscode-diffEditor-insertedTextBackground)',
                    borderRadius: '3px',
                    padding: '1px 3px',
                }}
            >
                {token.token}
            </span>
        );
    }

    // missing — in expected but not received
    return (
        <span
            style={{
                backgroundColor:
                    'var(--vscode-diffEditor-removedTextBackground)',
                textDecoration: 'line-through',
                borderRadius: '3px',
                padding: '1px 3px',
            }}
        >
            {token.token}
        </span>
    );
}

const trunctateStdout = (stdout: string): string => {
    if (stdout.length > 100000) {
        stdout = '[Truncated]\n' + stdout.substr(0, 100000);
    }
    return stdout;
};

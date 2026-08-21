import React from 'react';

interface CustomWindow extends Window {
    translations: Record<string, string>;
}
declare const window: CustomWindow;

const t = (key: string): string => window.translations[key] || key;

export type TestCaseCardState =
    | 'pending'
    | 'running'
    | 'checking'
    | 'passed'
    | 'failed'
    | 'skipped';

export default function TestCaseCard(props: {
    title: string;
    state: TestCaseCardState;
    time?: string;
    failureText?: string;
    minimized: boolean;
    toggle: () => void;
    run: () => void;
    stop: () => void;
    secondaryAction: () => void;
    secondaryKind: 'delete' | 'skip';
    secondaryArmed?: boolean;
    children: React.ReactNode;
}) {
    const running = props.state === 'running' || props.state === 'checking';
    const className = `case case-enter ${
        props.state === 'pending' ? '' : props.state
    }`;

    return (
        <div className={className}>
            <div className="case-metadata">
                <div className="toggle-minimize" onClick={props.toggle}>
                    <span className="case-number case-title">
                        <span title={props.minimized ? t('expand') : t('minimize')}>
                            <span className="icon">
                                <i
                                    className={`codicon codicon-chevron-${
                                        props.minimized ? 'down' : 'up'
                                    }`}
                                />
                            </span>
                        </span>{' '}
                        {props.title}
                    </span>
                    {props.state === 'passed' && (
                        <span className="case-result-summary result-pass">
                            <i
                                className="codicon codicon-check"
                                aria-label={t('Passed')}
                                title={t('Passed')}
                            />
                            {props.time && <span className="exec-time">{props.time}</span>}
                        </span>
                    )}
                    {props.state === 'failed' && (
                        <span className="case-result-summary result-fail">
                            {props.failureText || t('Failed')}
                            {props.time && <span className="exec-time">{props.time}</span>}
                        </span>
                    )}
                    {props.state === 'skipped' && (
                        <span className="skipped-text">
                            {t('largeSampleState_skipped')}
                        </span>
                    )}
                    {running && (
                        <span className="running-text">
                            {props.state === 'checking' ? t('checking') : t('running')}
                        </span>
                    )}
                </div>
                <div className="time">
                    {running ? (
                        <button className="btn btn-orange" title={t('stop')} onClick={props.stop}>
                            <span className="icon">
                                <i className="codicon codicon-circle-slash" />
                            </span>
                        </button>
                    ) : (
                        <button className="btn btn-green" title={t('runAgain')} onClick={props.run}>
                            <span className="icon">
                                <i className="codicon codicon-play" />
                            </span>
                        </button>
                    )}
                    <button
                        className={`btn ${
                            props.secondaryKind === 'delete'
                                ? 'btn-red delete-case-btn'
                                : 'btn-black'
                        } ${props.secondaryArmed ? 'is-confirming' : ''}`}
                        title={
                            props.secondaryKind === 'skip'
                                ? props.state === 'skipped'
                                    ? t('largeSampleRestore')
                                    : t('largeSampleSkip')
                                : props.secondaryArmed
                                  ? t('confirm')
                                  : t('deleteTestcase')
                        }
                        onClick={props.secondaryAction}
                    >
                        {props.secondaryKind === 'delete' && props.secondaryArmed ? (
                            t('confirm')
                        ) : (
                            <span className="icon">
                                <i
                                    className={`codicon ${
                                        props.secondaryKind === 'delete'
                                            ? 'codicon-trash'
                                            : 'codicon-circle-slash'
                                    }`}
                                />
                            </span>
                        )}
                    </button>
                </div>
            </div>
            <div
                className={`case-details ${
                    props.minimized ? 'is-collapsed' : 'is-expanded'
                }`}
                aria-hidden={props.minimized}
            >
                {props.children}
            </div>
        </div>
    );
}

import React, { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { formatDuration, Summary } from '../selectors';

/**
 * Problem title bar. Stays outside the scrolling region: the title may wrap, the
 * action cluster never gets pushed off screen.
 */
export default function ProblemHeader(props: {
    name: string;
    href?: string;
    timeSpentMs?: number;
    canMarkAccepted?: boolean;
    accepted: boolean;
    partialAccepted?: boolean;
    onSetCompletion?: (completion: 'none' | 'partial' | 'accepted') => void;
    onMarkAccepted: () => void;
    compiling: boolean;
    summary: Summary;
    settingsOpen: boolean;
    auxOpen: boolean;
    onOpenSettings: () => void;
    onToggleAux: () => void;
    children?: React.ReactNode;
}) {
    const { summary } = props;
    const [completionOpen, setCompletionOpen] = useState(false);
    const completionRef = useRef<HTMLSpanElement>(null);
    const completionButtonRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        setCompletionOpen(false);
    }, [props.name, props.href, props.accepted, props.partialAccepted, props.canMarkAccepted]);
    useEffect(() => {
        if (!completionOpen) { return; }
        completionRef.current?.querySelector<HTMLButtonElement>('.menu button')?.focus();
        const onPointerDown = (event: MouseEvent) => {
            if (event.target instanceof Node && !completionRef.current?.contains(event.target)) {
                setCompletionOpen(false);
            }
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setCompletionOpen(false);
                completionButtonRef.current?.focus();
            }
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [completionOpen]);
    const setCompletion = (completion: 'none' | 'partial' | 'accepted') => {
        setCompletionOpen(false);
        completionButtonRef.current?.focus();
        if (completion === 'accepted') { props.onMarkAccepted(); }
        else { props.onSetCompletion?.(completion); }
    };
    const rateClass = summary.empty
        ? 'pass-rate pass-rate-empty'
        : summary.passed === summary.total
          ? 'pass-rate pass-all'
          : summary.passed === 0
            ? 'pass-rate fail-all'
            : 'pass-rate';

    return (
        <header className="judge-header">
            <div className="problem-title-row">
                <span className="problem-name">
                    <span className="problem-name-text" title={props.name}>
                        {props.href ? (
                            <a href={props.href}>{props.name}</a>
                        ) : (
                            props.name
                        )}
                    </span>
                    <small className="problem-timer" title={t('timeSpent')}>
                        {props.timeSpentMs === undefined ? '--:--' : formatDuration(props.timeSpentMs)}
                    </small>
                </span>
                <span className="problem-header-controls">
                    <button
                        type="button"
                        className={`btn btn-black icon-btn${props.settingsOpen ? ' is-active' : ''}`}
                        title={t('problemSettings')}
                        aria-label={t('problemSettings')}
                        aria-expanded={props.settingsOpen}
                        onClick={props.onOpenSettings}
                    >
                        <i className="codicon codicon-settings-gear" aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        className={`btn btn-black icon-btn${props.auxOpen ? ' is-active' : ''}`}
                        title={t('auxMenu')}
                        aria-label={t('auxMenu')}
                        aria-expanded={props.auxOpen}
                        data-aux-menu-anchor="true"
                        onClick={props.onToggleAux}
                    >
                        <i className="codicon codicon-ellipsis" aria-hidden="true" />
                    </button>
                </span>
            </div>
            <div className="problem-status-row">
                <span className="problem-actions">
                    {props.canMarkAccepted === false && props.accepted && <span className="problem-accepted-indicator">AC</span>}
                    {props.canMarkAccepted !== false && (
                        <span className="problem-completion" ref={completionRef}
                            onBlur={event => {
                                if (!event.currentTarget.contains(event.relatedTarget)) { setCompletionOpen(false); }
                            }}>
                            <button
                                ref={completionButtonRef}
                                type="button"
                                className={`btn btn-black mark-accepted-btn${props.accepted ? ' is-accepted' : ''}`}
                                onClick={() => setCompletionOpen(open => !open)}
                                title={t('completionStatus')}
                                aria-label={t('completionStatus')}
                                aria-expanded={completionOpen}
                                aria-controls="problem-completion-menu"
                            >
                                {props.accepted && <i className="codicon codicon-check" aria-hidden="true" />}
                                {props.accepted ? 'AC' : props.partialAccepted ? t('partialAccepted') : t('markAccepted')}
                                <i className="codicon codicon-chevron-down" aria-hidden="true" />
                            </button>
                            {completionOpen && (
                                <span id="problem-completion-menu" className="menu problem-completion-menu" role="group" aria-label={t('completionStatus')}>
                                    <button type="button" className="btn btn-block" aria-pressed={props.accepted}
                                        title={t('markAccepted')} onClick={() => setCompletion('accepted')}>AC</button>
                                    {props.onSetCompletion && (
                                        <button type="button" className="btn btn-block" aria-pressed={props.partialAccepted === true && !props.accepted}
                                            title={t('markPartialAccepted')} onClick={() => setCompletion('partial')}>{t('partialAccepted')}</button>
                                    )}
                                    {props.onSetCompletion && (props.accepted || props.partialAccepted) && (
                                        <button type="button" className="btn btn-block" onClick={() => setCompletion('none')}>
                                            {props.accepted ? t('cancelAccepted') : t('cancelPartialAccepted')}
                                        </button>
                                    )}
                                </span>
                            )}
                        </span>
                    )}
                    {props.compiling && (
                        <span className="compiling-indicator" title={t('compiling')}>
                            <span className="loader"></span>
                        </span>
                    )}
                    {summary.empty ? (
                        <span className={rateClass}>{t('emptyTestcases')}</span>
                    ) : (
                        <span className={rateClass}>
                            <span>
                                {summary.passed} / {summary.total}
                            </span>
                            <span className="pass-rate-label"> {t('passedRate')}</span>
                            {summary.pending > 0 && (
                                <span className="pass-rate-pending">
                                    {' · '}
                                    {t('pendingLabel')} {summary.pending}
                                </span>
                            )}
                        </span>
                    )}
                </span>
            </div>
            {props.children}
        </header>
    );
}

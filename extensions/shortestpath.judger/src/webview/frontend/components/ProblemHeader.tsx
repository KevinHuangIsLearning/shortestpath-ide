import React, { useEffect, useState } from 'react';
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
    const [acceptedArmed, setAcceptedArmed] = useState(false);
    const [partialArmed, setPartialArmed] = useState(false);
    useEffect(() => {
        setAcceptedArmed(false);
        setPartialArmed(false);
    }, [props.name, props.href, props.accepted, props.partialAccepted]);
    useEffect(() => {
        if (!acceptedArmed) { return; }
        const timeout = setTimeout(() => setAcceptedArmed(false), 3000);
        return () => clearTimeout(timeout);
    }, [acceptedArmed]);
    useEffect(() => {
        if (!partialArmed) { return; }
        const timeout = setTimeout(() => setPartialArmed(false), 3000);
        return () => clearTimeout(timeout);
    }, [partialArmed]);
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
                        <button
                            type="button"
                            className={`btn mark-accepted-btn ${acceptedArmed ? 'btn-yellow' : 'btn-green'}`}
                            onBlur={() => setAcceptedArmed(false)}
                            onClick={() => {
                                if (props.accepted) { props.onSetCompletion?.('none'); return; }
                                if (!acceptedArmed) { setAcceptedArmed(true); return; }
                                setAcceptedArmed(false);
                                props.onMarkAccepted();
                            }}
                            title={props.accepted ? t('cancelAccepted') : acceptedArmed ? t('confirmMarkAccepted') : t('markAccepted')}
                            aria-label={props.accepted ? t('cancelAccepted') : acceptedArmed ? t('confirmMarkAccepted') : t('markAccepted')}
                        >
                            {props.accepted ? t('cancelAccepted') : acceptedArmed ? t('confirm') : 'AC'}
                        </button>
                    )}
                    {props.canMarkAccepted !== false && props.onSetCompletion && (
                        <button type="button" className={`btn ${partialArmed ? 'btn-yellow' : 'btn-black'}`} aria-pressed={props.partialAccepted === true}
                            title={props.partialAccepted ? t('cancelPartialAccepted') : partialArmed ? t('confirmMarkPartialAccepted') : t('markPartialAccepted')}
                            aria-label={props.partialAccepted ? t('cancelPartialAccepted') : partialArmed ? t('confirmMarkPartialAccepted') : t('markPartialAccepted')}
                            onBlur={() => setPartialArmed(false)}
                            onClick={() => {
                                if (props.partialAccepted) { props.onSetCompletion?.('none'); return; }
                                if (!partialArmed) { setPartialArmed(true); return; }
                                setPartialArmed(false);
                                props.onSetCompletion?.('partial');
                            }}>
                            {props.partialAccepted ? t('cancelPartialAccepted') : partialArmed ? t('confirm') : t('markPartialAccepted')}
                        </button>
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

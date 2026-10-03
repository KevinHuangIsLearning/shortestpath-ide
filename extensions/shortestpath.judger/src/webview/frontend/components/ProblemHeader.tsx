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
    useEffect(() => {
        setAcceptedArmed(false);
    }, [props.name, props.href, props.accepted]);
    useEffect(() => {
        if (!acceptedArmed) { return; }
        const timeout = setTimeout(() => setAcceptedArmed(false), 3000);
        return () => clearTimeout(timeout);
    }, [acceptedArmed]);
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
                            disabled={props.accepted}
                            onBlur={() => setAcceptedArmed(false)}
                            onClick={() => {
                                if (!acceptedArmed) { setAcceptedArmed(true); return; }
                                setAcceptedArmed(false);
                                props.onMarkAccepted();
                            }}
                            title={acceptedArmed ? t('confirmMarkAccepted') : t('markAccepted')}
                            aria-label={acceptedArmed ? t('confirmMarkAccepted') : t('markAccepted')}
                        >
                            {acceptedArmed ? t('confirm') : 'AC'}
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

import React from 'react';
import { t } from './i18n';
import { CaseState } from './selectors';
import { MenuAnchor } from './components/CaseActionsMenu';

export type TestCaseCardState = CaseState;

/**
 * Reordering state the testcase list hands down while a row is being dragged.
 *
 * The drop side is not here: it is positional, so the list container owns it.
 */
export type CaseDrag = {
    id: number;
    /** This row is the one under the pointer. */
    dragging: boolean;
    /** Flex order for the live preview; the list, not the row, decides it. */
    order?: number;
    onStart: (event: React.DragEvent<HTMLDivElement>) => void;
    onEnd: () => void;
};

/**
 * Accessible frame for one testcase row. The header order is fixed:
 * expand button, number, status, timing, run/stop, secondary actions, menu.
 * Destructive actions live in the row's own menu, not on the card.
 *
 * The header is also the drag handle and the expand target: pressing it
 * anywhere that is not one of its own controls toggles the row, so the whole
 * bar is a hit area instead of just the chevron.
 */
export default function TestCaseCard(props: {
    detailsId: string;
    title: string;
    state: TestCaseCardState;
    verdict?: string;
    time?: string;
    failureText?: string;
    minimized: boolean;
    toggle: () => void;
    run: () => void;
    stop: () => void;
    more?: (anchor: MenuAnchor) => void;
    drag?: CaseDrag;
    children: React.ReactNode;
}) {
    const running = props.state === 'running' || props.state === 'checking';
    const drag = props.drag;
    // Rows carry their verdict as a class so the leading status stripe can be
    // styled without re-deriving the state in CSS.
    const className = [
        'case',
        props.state === 'pending' ? '' : props.state,
        drag?.dragging ? 'is-dragging' : '',
    ]
        .filter(Boolean)
        .join(' ');

    // The header is a drag handle, a toggle and a button row at once. Controls
    // keep their own behaviour; everything else on the bar expands the row.
    const onHeaderClick = (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target as Element | null;
        if (target?.closest('button, a, input, textarea, select')) {
            return;
        }
        props.toggle();
    };

    return (
        <div
            className={className}
            data-case-id={drag?.id}
            style={drag ? { order: drag.order } : undefined}
        >
            <div
                className="case-metadata"
                draggable={drag !== undefined}
                onDragStart={drag?.onStart}
                onDragEnd={drag?.onEnd}
                onClick={onHeaderClick}
            >
                <button
                    type="button"
                    className="case-toggle"
                    aria-expanded={!props.minimized}
                    aria-controls={props.detailsId}
                    title={props.minimized ? t('expand') : t('minimize')}
                    aria-label={props.minimized ? t('expand') : t('minimize')}
                    onClick={props.toggle}
                >
                    <i
                        className={`codicon codicon-chevron-${
                            props.minimized ? 'right' : 'down'
                        }`}
                        aria-hidden="true"
                    />
                </button>
                <span className="case-number case-title" title={props.title}>
                    {props.title}
                </span>
                <span className={`case-status case-status-${props.state}`}>
                    {props.state === 'passed' && (
                        <>
                            <i
                                className="codicon codicon-check"
                                aria-label={t('passed')}
                                title={t('passed')}
                                aria-hidden="true"
                            />
                    {props.verdict && (
                        <span
                            className={`case-verdict case-verdict-${props.verdict}`}
                        >
                            {props.verdict}
                        </span>
                    )}
                            {props.time && <span className="exec-time">{props.time}</span>}
                        </>
                    )}
                    {props.state === 'failed' && (
                        <>
                    {props.verdict && (
                        <span
                            className={`case-verdict case-verdict-${props.verdict}`}
                        >
                            {props.verdict}
                        </span>
                    )}
                            <span>{props.failureText || t('failed')}</span>
                            {props.time && <span className="exec-time">{props.time}</span>}
                        </>
                    )}
                    {props.state === 'pending' && <span>{t('notRun')}</span>}
                    {props.state === 'disabled' && <span>{t('disabled')}</span>}
                    {props.state === 'skipped' && (
                        <span>{t('disabled')}</span>
                    )}
                    {running && (
                        <span className="running-text">
                            {props.state === 'checking' ? t('checking') : t('running')}
                        </span>
                    )}
                </span>
                <span className="toolbar-spacer" />
                <span className="time">
                    {running ? (
                        <button
                            type="button"
                            className="btn btn-orange"
                            title={t('stop')}
                            aria-label={t('stop')}
                            onClick={props.stop}
                        >
                            <span className="icon">
                                <i className="codicon codicon-circle-slash" aria-hidden="true" />
                            </span>
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="btn btn-green"
                            title={t('runAgain')}
                            aria-label={t('runAgain')}
                            disabled={props.state === 'disabled'}
                            onClick={props.run}
                        >
                            <span className="icon">
                                <i className="codicon codicon-play" aria-hidden="true" />
                            </span>
                        </button>
                    )}
                </span>
                {props.more && (
                    <button
                        type="button"
                        className="btn btn-black icon-btn case-menu-button"
                        title={t('moreActions')}
                        aria-label={t('moreActions')}
                        data-case-menu-anchor="true"
                        onClick={(event) => {
                            const rect = event.currentTarget.getBoundingClientRect();
                            props.more?.({ right: rect.right, top: rect.top, bottom: rect.bottom });
                        }}
                    >
                        <i className="codicon codicon-ellipsis" aria-hidden="true" />
                    </button>
                )}
            </div>
            <div
                id={props.detailsId}
                className={`case-details ${
                    props.minimized ? 'is-collapsed' : 'is-expanded'
                }`}
                aria-hidden={props.minimized}
            >
                {props.minimized ? null : props.children}
            </div>
        </div>
    );
}

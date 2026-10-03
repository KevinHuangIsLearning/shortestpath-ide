import React from 'react';
import { t } from '../i18n';

/**
 * Bottom action bar. Two rows: the occasional, deliberate actions (submit, the
 * stress-test dialog) on top, and run-all or its stop button on the bottom
 * edge — the last thing under the cursor, and the only accent fill on screen.
 * The bar is a normal flex column at the end of the shell, so it never covers
 * the last testcase.
 */
export default function JudgeActionBar(props: {
    running: boolean;
    submitButton?: React.ReactNode;
    onRunAll: () => void;
    onStop: () => void;
    onStress: () => void;
}) {
    return (
        <div className="actions">
            <div className="actions-secondary-row">
                {props.submitButton}
                <button
                    type="button"
                    className="btn btn-black stress-open-button"
                    onClick={props.onStress}
                    title={t('stressTesting')}
                >
                    <i className="codicon codicon-git-compare" aria-hidden="true"></i>{' '}
                    <span className="action-text">{t('stressTesting')}</span>
                </button>
            </div>
            <div className="actions-main-row">
                {props.running ? (
                    <button
                        type="button"
                        className="btn btn-orange stop-all-btn"
                        onClick={props.onStop}
                        title={t('stop')}
                    >
                        <span className="icon">
                            <i className="codicon codicon-circle-slash" aria-hidden="true"></i>
                        </span>{' '}
                        <span className="action-text">{t('stop')}</span>
                    </button>
                ) : (
                    <div className="split-btn">
                        <button
                            type="button"
                            className="btn main-btn"
                            onClick={props.onRunAll}
                            title={t('runAll')}
                        >
                            <span className="icon">
                                <i className="codicon codicon-run-above" aria-hidden="true"></i>
                            </span>{' '}
                            <span className="action-text">{t('runAll')}</span>
                        </button>
                        <button
                            type="button"
                            className="btn chevron-btn"
                            title={t('moreActions')}
                            aria-label={t('moreActions')}
                            onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                event.currentTarget.dispatchEvent(
                                    new MouseEvent('contextmenu', {
                                        bubbles: true,
                                        clientX: event.clientX,
                                        clientY: event.clientY,
                                    }),
                                );
                            }}
                            data-vscode-context='{"preventDefaultContextMenuItems": true, "webviewSection": "compile-button"}'
                        >
                            <span className="icon">
                                <i className="codicon codicon-chevron-down" aria-hidden="true"></i>
                            </span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

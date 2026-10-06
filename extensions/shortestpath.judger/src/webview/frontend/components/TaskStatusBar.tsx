import React from 'react';
import { t } from '../i18n';
import { progressPercent, TaskKind } from '../selectors';

/**
 * Single place that reports what the judger is currently doing: compiling,
 * running, checking, stress testing. Progress is only
 * shown as a percentage when a real total exists.
 */
export default function TaskStatusBar(props: {
    task: TaskKind;
    label: string;
    progress?: { value: number; total: number } | null;
    onlineJudgeEnv: boolean;
    onToggleOnlineJudge: () => void;
    warning?: React.ReactNode;
}) {
    const busy = props.task !== 'idle';

    return (
        <div className="judge-status">
            <div className="task-line" role="status" aria-live="polite">
                {busy && (
                    <span className="task-spinner" aria-hidden="true">
                        <i className="codicon codicon-loading" />
                    </span>
                )}
                <span className="task-label">{props.label}</span>
            </div>
            {props.progress && (
                <div
                    className="stress-progress-track"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={props.progress.total}
                    aria-valuenow={props.progress.value}
                >
                    <div
                        className="stress-progress-bar"
                        style={{
                            width: `${progressPercent(props.progress.value, props.progress.total)}%`,
                        }}
                    />
                </div>
            )}
            <button
                type="button"
                className={`oj-box${props.onlineJudgeEnv ? ' oj-enabled' : ''}`}
                aria-pressed={props.onlineJudgeEnv}
                title={t('setOnlineJudge')}
                onClick={props.onToggleOnlineJudge}
            >
                <span aria-hidden="true">{props.onlineJudgeEnv ? '☑' : '☐'}</span>{' '}
                <span className="oj-code">{t('setOnlineJudge')}</span>
            </button>
            {props.warning}
        </div>
    );
}

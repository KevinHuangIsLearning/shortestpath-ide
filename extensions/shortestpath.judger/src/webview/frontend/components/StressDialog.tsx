import React from 'react';
import Page from '../Page';
import { t } from '../i18n';
import { progressPercent } from '../selectors';
import { StressFailureCommand } from '../../../types';

const truncate = (text: string): string =>
    text.length <= 100000 ? text : `[Truncated]\n${text.slice(0, 100000)}`;

/**
 * Stress-test configuration and progress. Owns no state: the parent keeps the
 * run id so late messages from a previous run can still be filtered out.
 */
export default function StressDialog(props: {
    generatorPath: string;
    stdPath: string;
    iterations: number;
    running: boolean;
    message: string | null;
    progress: { iteration: number; total: number };
    failure: StressFailureCommand | null;
    onPickGenerator: () => void;
    onPickStd: () => void;
    onIterationsChange: (value: number) => void;
    onStart: () => void;
    onStop: () => void;
    onClose: () => void;
    onCopyInstructions: () => void;
    onViewGeneratorExample: () => void;
}) {
    const content = (
        <div className="stress-body">
            <p className="stress-hint">{t('stressDescription')}</p>
            <details className="stress-instructions selectable">
                <summary>{t('stressInstructions')}</summary>
                <div className="stress-example-actions">
                    <button
                        type="button"
                        className="btn btn-black"
                        onClick={props.onCopyInstructions}
                    >
                        {t('copy')}
                    </button>
                    <button
                        type="button"
                        className="btn btn-black"
                        onClick={props.onViewGeneratorExample}
                    >
                        {t('viewGeneratorExample')}
                    </button>
                </div>
                <ul>
                    <li>{t('generatorInputFormat')}</li>
                    <li>{t('generatorOutputFormat')}</li>
                    <li>{t('stdInputFormat')}</li>
                    <li>{t('stdOutputFormat')}</li>
                    <li>{t('targetInputFormat')}</li>
                </ul>
                <p className="stress-example-title">{t('generatorExampleTitle')}</p>
                <pre className="stress-example selectable">{t('generatorExample')}</pre>
            </details>
            <div className="stress-file-picker">
                <input
                    readOnly
                    value={props.generatorPath}
                    placeholder={t('generatorPath')}
                    disabled={props.running}
                    aria-label={t('generatorPath')}
                />
                <button
                    type="button"
                    className="btn btn-black"
                    disabled={props.running}
                    onClick={props.onPickGenerator}
                >
                    {t('choose')}
                </button>
            </div>
            <div className="stress-file-picker">
                <input
                    readOnly
                    value={props.stdPath}
                    placeholder={t('stdPath')}
                    disabled={props.running}
                    aria-label={t('stdPath')}
                />
                <button
                    type="button"
                    className="btn btn-black"
                    disabled={props.running}
                    onClick={props.onPickStd}
                >
                    {t('choose')}
                </button>
            </div>
            <div className="stress-actions">
                <label>
                    {t('iterations')}{' '}
                    <input
                        type="number"
                        min={0}
                        max={100000}
                        value={props.iterations}
                        disabled={props.running}
                        onChange={(event) =>
                            props.onIterationsChange(Number(event.target.value))
                        }
                    />
                </label>
                <button
                    type="button"
                    className="btn btn-green"
                    disabled={props.running}
                    onClick={props.onStart}
                >
                    {t('startStress')}
                </button>
                <button
                    type="button"
                    className="btn btn-red"
                    disabled={!props.running}
                    onClick={props.onStop}
                >
                    {t('stopStress')}
                </button>
            </div>
            {props.message && (
                <div className="stress-status" role="status" aria-live="polite">
                    {props.running && (
                        <span className="stress-spinner" aria-label={t('stressRunning')}>
                            <i className="codicon codicon-loading" />
                        </span>
                    )}
                    <span>{props.message}</span>
                </div>
            )}
            {props.running && props.progress.total > 0 && (
                <div
                    className="stress-progress-track"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={props.progress.total}
                    aria-valuenow={props.progress.iteration}
                >
                    <div
                        className="stress-progress-bar"
                        style={{
                            width: `${progressPercent(props.progress.iteration, props.progress.total)}%`,
                        }}
                    />
                </div>
            )}
            {props.failure && (
                <div className="stress-counterexample">
                    <p className="stress-status">
                        {t('stressFound')} ({t('iterations')} {props.failure.iteration})
                    </p>
                    <div className="stress-counterexample-field">
                        <label>{t('inputLabel')}</label>
                        <textarea
                            className="selectable"
                            readOnly
                            value={props.failure.testcase.inputPath || truncate(props.failure.testcase.input)}
                        />
                    </div>
                    <div className="stress-counterexample-field">
                        <label>{t('expectedOutputLabel')}</label>
                        <textarea
                            className="selectable"
                            readOnly
                            value={props.failure.testcase.outputPath || truncate(props.failure.testcase.output)}
                        />
                    </div>
                    <div className="stress-counterexample-field">
                        <label>{t('receivedOutputLabel')}</label>
                        <textarea
                            className="selectable"
                            readOnly
                            value={truncate(props.failure.result.stdout)}
                        />
                    </div>
                    {props.failure.result.stderr && (
                        <div className="stress-counterexample-field">
                            <label>{t('standardError')}</label>
                            <textarea
                                className="selectable"
                                readOnly
                                value={truncate(props.failure.result.stderr)}
                            />
                        </div>
                    )}
                    {props.failure.result.diff && (
                        <p className="stress-hint">
                            {t('outputDifference')} {props.failure.result.diff.summary}
                        </p>
                    )}

                </div>
            )}
        </div>
    );

    return (
        <Page content={content} title={t('stressTesting')} closePage={props.onClose} />
    );
}

import React from 'react';
import Page from '../Page';
import { t } from '../i18n';

/**
 * Help / About / diagnostics page. Replaces the old long "more actions" list:
 * live user count, commit, build time, UI and extension logs and the license.
 */
export default function JudgeInfoPage(props: {
    generatedJson: any | null;
    logs: string;
    extLogs: string;
    liveUserCount: number;
    projectUrl: string;
    userGuideHref: string;
    editableStateText: string;
    onEditableStateTextChange: (value: string) => void;
    onSaveState: () => void;
    onClearState: () => void;
    onClose: () => void;
    children?: React.ReactNode;
}) {
    if (props.generatedJson === null) {
        return (
            <Page content={t('loading')} title={t('aboutCPH')} closePage={props.onClose} />
        );
    }

    const contents = (
        <div className="info-body">
            {props.children}
            <h2>ShortestPath Judger</h2>
            <p>{t('cphDescription')}</p>
            <hr />
            <h3>{t('getHelp')}</h3>
            <a className="btn btn-black" href={props.userGuideHref}>
                {t('userGuide')}
            </a>
            <hr />
            <h3>{t('commit')}</h3>
            <pre className="selectable">{props.generatedJson.gitCommitHash}</pre>
            <hr />
            <h3>{t('buildTime')}</h3>
            {props.generatedJson.dateTime}
            <hr />
            <h3>{t('liveUserCount')}</h3>
            {props.liveUserCount} {props.liveUserCount === 1 ? t('user') : t('users')}{' '}
            {t('online')}.
            <hr />
            <h3>{t('uiLogs')}</h3>
            <pre className="selectable">{props.logs}</pre>
            <hr />
            <h3>{t('extensionLogs')}</h3>
            <pre className="selectable">{props.extLogs}</pre>
            <hr />
            <h3>Debug</h3>
            <textarea
                className="selectable debug-textarea"
                value={props.editableStateText}
                onChange={(event) => props.onEditableStateTextChange(event.target.value)}
                rows={10}
            />
            <div className="settings-actions">
                <button className="btn btn-green" onClick={props.onSaveState}>
                    Save Changes
                </button>
                <button className="btn btn-red" onClick={props.onClearState}>
                    Clear State
                </button>
            </div>
            <hr />
            <details>
                <summary>
                    <b>{t('license')}</b>
                </summary>
                <pre className="selectable">{props.generatedJson.licenseString}</pre>
            </details>
        </div>
    );

    return (
        <Page content={contents} title={t('aboutCPH')} closePage={props.onClose} />
    );
}

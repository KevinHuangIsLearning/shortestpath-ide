import React, { useEffect, useMemo, useState } from 'react';
import Page from '../Page';
import { t } from '../i18n';
import { Problem } from '../../../types';
import { invalidProblemPatchFields } from '../../../problemValidation';

type Draft = {
    name: string;
    url: string;
    timeLimit: string;
    memoryLimit: string;
    customCheckerPath: string;
    interactorPath: string;
    compilerCommand: string;
    compilerArgs: string;
    interpreterCommand: string;
    interpreterArgs: string;
};

const draftFrom = (problem: Problem): Draft => ({
    name: problem.name,
    url: problem.url,
    timeLimit: String(problem.timeLimit ?? ''),
    memoryLimit: String(problem.memoryLimit ?? ''),
    customCheckerPath: problem.customCheckerPath ?? '',
    interactorPath: problem.interactorPath ?? '',
    compilerCommand: problem.compilerCommand ?? '',
    compilerArgs: problem.compilerArgs ? JSON.stringify(problem.compilerArgs) : '',
    interpreterCommand: problem.interpreterCommand ?? '',
    interpreterArgs: problem.interpreterArgs ? JSON.stringify(problem.interpreterArgs) : '',
});

/**
 * Builds the patch that `apply` will merge into the *latest* problem. Only the
 * fields this form owns are returned, so tests and timeSpentMs edited elsewhere
 * are never overwritten.
 */
export function buildProblemPatch(draft: Draft): { patch?: Partial<Problem>; errors: Record<string, string> } {
    const errors: Record<string, string> = {};
    const timeLimit = Number(draft.timeLimit);
    const memoryLimit = Number(draft.memoryLimit);
    if (!draft.name.trim()) { errors.name = t('nameRequired'); }
    if (!Number.isFinite(timeLimit) || timeLimit <= 0) { errors.timeLimit = t('invalidLimit'); }
    if (!Number.isFinite(memoryLimit) || memoryLimit <= 0) { errors.memoryLimit = t('invalidLimit'); }
    const parseArgs = (value: string): string[] | undefined => {
        if (!value.trim()) { return undefined; }
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) { return parsed; }
        } catch { /* reported below */ }
        return undefined;
    };
    const compilerArgs = parseArgs(draft.compilerArgs);
    const interpreterArgs = parseArgs(draft.interpreterArgs);
    if (draft.compilerArgs.trim() && !compilerArgs) { errors.compilerArgs = t('invalidArgs'); }
    if (draft.interpreterArgs.trim() && !interpreterArgs) { errors.interpreterArgs = t('invalidArgs'); }
    if (Object.keys(errors).length) { return { errors }; }
    const patch: Partial<Problem> = {
        name: draft.name,
        url: draft.url,
        timeLimit,
        memoryLimit,
        customCheckerPath: draft.customCheckerPath.trim() || undefined,
        interactorPath: draft.interactorPath.trim() || undefined,
        compilerCommand: draft.compilerCommand.trim() || undefined,
        compilerArgs,
        interpreterCommand: draft.interpreterCommand.trim() || undefined,
        interpreterArgs,
    };
    // The host re-checks the same shared rules before persisting.
    for (const key of invalidProblemPatchFields(patch)) {
        errors[key] = key === 'name' ? t('nameRequired') : t('invalidLimit');
    }
    return Object.keys(errors).length ? { errors } : { patch, errors };
}

/**
 * Problem settings page. Edits a local draft and only merges the allowed fields
 * on apply, so background edits (per-second timer, testcase changes) survive.
 */
export default function ProblemSettings(props: {
    problem: Problem;
    running: boolean;
    onApply: (patch: Partial<Problem>) => void;
    onClose: () => void;
    onOpenAdvancedActions: () => void;
    onOpenGlobalSettings: () => void;
    advanced?: React.ReactNode;
}) {
    const [draft, setDraft] = useState<Draft>(() => draftFrom(props.problem));
    const [errors, setErrors] = useState<Record<string, string>>({});

    // A different problem must never reuse the previous draft.
    useEffect(() => {
        setDraft(draftFrom(props.problem));
        setErrors({});
    }, [props.problem.srcPath]);

    const locked = props.running;
    const field = (key: keyof Draft) => (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value;
        setDraft((previous) => ({ ...previous, [key]: value }));
    };
    const error = (key: keyof Draft) =>
        errors[key] ? <small className="field-error">{errors[key]}</small> : null;

    const apply = () => {
        const result = buildProblemPatch(draft);
        if (!result.patch) { setErrors(result.errors); return; }
        setErrors({});
        props.onApply(result.patch);
    };

    const body = useMemo(
        () => (
            <div className="settings-body">
                <section className="settings-group">
                    <h3>{t('settingsBasic')}</h3>
                    <label className="settings-field">
                        <span>{t('nameLabel')}</span>
                        <input type="text" value={draft.name} onChange={field('name')} />
                        {error('name')}
                    </label>
                    <label className="settings-field">
                        <span>{t('urlLabel')}</span>
                        <input type="text" value={draft.url} onChange={field('url')} />
                    </label>
                    <label className="settings-field">
                        <span>{t('timeLimitLabel')}</span>
                        <input
                            type="number"
                            min={1}
                            value={draft.timeLimit}
                            disabled={locked}
                            onChange={field('timeLimit')}
                        />
                        {error('timeLimit')}
                    </label>
                    <label className="settings-field">
                        <span>{t('memoryLimitLabel')}</span>
                        <input
                            type="number"
                            min={1}
                            value={draft.memoryLimit}
                            disabled={locked}
                            onChange={field('memoryLimit')}
                        />
                        {error('memoryLimit')}
                    </label>
                </section>

                <section className="settings-group">
                    <h3>{t('settingsJudge')}</h3>
                    <label className="settings-field">
                        <span>{t('customChecker')}</span>
                        <input
                            type="text"
                            value={draft.customCheckerPath}
                            disabled={locked}
                            placeholder={t('customCheckerPathPlaceholder')}
                            onChange={field('customCheckerPath')}
                        />
                    </label>
                    <label className="settings-field">
                        <span>{t('interactorPath')}</span>
                        <input
                            type="text"
                            value={draft.interactorPath}
                            disabled={locked}
                            onChange={field('interactorPath')}
                        />
                    </label>
                </section>

                <section className="settings-group">
                    <h3>{t('settingsLanguages')}</h3>
                    <label className="settings-field">
                        <span>{t('compilerCommandLabel')}</span>
                        <input
                            type="text"
                            value={draft.compilerCommand}
                            disabled={locked}
                            onChange={field('compilerCommand')}
                        />
                    </label>
                    <label className="settings-field">
                        <span>{t('compilerArgsLabel')}</span>
                        <input
                            type="text"
                            value={draft.compilerArgs}
                            disabled={locked}
                            placeholder='["-O2", "-std=c++17"]'
                            onChange={field('compilerArgs')}
                        />
                        {error('compilerArgs')}
                    </label>
                    <label className="settings-field">
                        <span>{t('interpreterCommandLabel')}</span>
                        <input
                            type="text"
                            value={draft.interpreterCommand}
                            disabled={locked}
                            onChange={field('interpreterCommand')}
                        />
                    </label>
                    <label className="settings-field">
                        <span>{t('interpreterArgsLabel')}</span>
                        <input
                            type="text"
                            value={draft.interpreterArgs}
                            disabled={locked}
                            onChange={field('interpreterArgs')}
                        />
                        {error('interpreterArgs')}
                    </label>
                </section>

                <section className="settings-group">
                    <h3>{t('settingsAdvanced')}</h3>
                    <div className="settings-actions">
                        <button
                            type="button"
                            className="btn btn-black"
                            onClick={props.onOpenAdvancedActions}
                        >
                            <i className="codicon codicon-json" aria-hidden="true"></i>{' '}
                            {t('problemOptions')}
                        </button>
                        <button
                            type="button"
                            className="btn btn-black"
                            onClick={props.onOpenGlobalSettings}
                        >
                            <i className="codicon codicon-settings" aria-hidden="true"></i>{' '}
                            {t('settings')}
                        </button>
                    </div>
                    {props.advanced}
                </section>
            </div>
        ),
        [draft, errors, locked, props.advanced, props.onOpenAdvancedActions, props.onOpenGlobalSettings],
    );

    return (
        <Page
            content={body}
            title={t('problemSettings')}
            closePage={props.onClose}
            footer={
                <div className="settings-footer">
                    <button type="button" className="btn btn-green" onClick={apply}>
                        <i className="codicon codicon-check" aria-hidden="true"></i>{' '}
                        {t('applyChanges')}
                    </button>
                    <button type="button" className="btn btn-black" onClick={props.onClose}>
                        {t('discardChanges')}
                    </button>
                </div>
            }
        />
    );
}

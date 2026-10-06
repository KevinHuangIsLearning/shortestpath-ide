import React, { useState } from 'react';
import { useMenuDismiss } from '../useMenuDismiss';
import { t } from '../i18n';
import { FILTER_LABEL_KEYS, STATUS_FILTERS, StatusFilter } from '../selectors';

/**
 * Testcase toolbar: filter, import entry and the add button. Kept above the list
 * so the import/add entry never scrolls out of reach with many testcases.
 */
export default function TestcaseToolbar(props: {
    filter: StatusFilter;
    counts: Record<StatusFilter, number>;
    total: number;
    onFilterChange: (filter: StatusFilter) => void;
    onImport: (source: 'zip' | 'files' | 'folder' | 'json') => void;
    onAdd: () => void;
    dropHintDismissed?: boolean;
    onDismissDropHint?: () => void;
}) {
    const [importMenuOpen, setImportMenuOpen] = useState(false);
    const [addMenuOpen, setAddMenuOpen] = useState(false);
    useMenuDismiss(() => { setAddMenuOpen(false); setImportMenuOpen(false); }, '[data-testcase-add-anchor]');
    const hidden = props.total - props.counts[props.filter];

    return (
        <div className="testcase-toolbar">
            <div className="testcase-toolbar-row">
                <label className="filter-control">
                    <span className="filter-caption">{t('filterLabel')}</span>
                    <select
                        className="filter-select"
                        value={props.filter}
                        aria-label={t('filterLabel')}
                        onChange={(event) =>
                            props.onFilterChange(event.target.value as StatusFilter)
                        }
                    >
                        {STATUS_FILTERS.map((filter) => (
                            <option key={filter} value={filter}>
                                {t(FILTER_LABEL_KEYS[filter])} ({props.counts[filter]})
                            </option>
                        ))}
                    </select>
                </label>
                {hidden > 0 && (
                    <span className="filter-hidden">
                        {t('hiddenCount').replace('{count}', String(hidden))}
                    </span>
                )}
                <span className="toolbar-spacer" />
                <button
                    type="button"
                    className="btn btn-black icon-btn"
                    title={t('newTestcase')}
                    aria-label={t('newTestcase')}
                    aria-haspopup="menu"
                    aria-expanded={addMenuOpen}
                    data-testcase-add-anchor="true"
                    onClick={() => { setAddMenuOpen(open => !open); setImportMenuOpen(false); }}
                >
                    <i className="codicon codicon-add" aria-hidden="true"></i>
                </button>
                {addMenuOpen && (
                    <div className="menu testcase-add-menu" role="menu">
                        {importMenuOpen ? <>
                            <button type="button" className="btn btn-block" role="menuitem" onClick={() => setImportMenuOpen(false)}>
                                <i className="codicon codicon-chevron-left" aria-hidden="true" />{t('importTestcases')}
                            </button>
                            {(['zip', 'files', 'folder', 'json'] as const).map(source => (
                                <button key={source} type="button" className="btn btn-block" role="menuitem" onClick={() => { setAddMenuOpen(false); setImportMenuOpen(false); props.onImport(source); }}>
                                    {t(({ zip: 'fromZip', files: 'fromFiles', folder: 'fromFolder', json: 'importJsonTestcases' })[source])}
                                </button>
                            ))}
                        </> : <>
                        <button type="button" className="btn btn-block" role="menuitem" onClick={() => { setAddMenuOpen(false); props.onAdd(); }}>
                            <i className="codicon codicon-add" aria-hidden="true" />
                            {t('newTestcase')}
                        </button>
                        <button type="button" className="btn btn-block" role="menuitem" onClick={() => setImportMenuOpen(true)}>
                            <i className="codicon codicon-folder-opened" aria-hidden="true" />
                            {t('importTestcases')}
                        </button>
                        </>}
                    </div>
                )}
            </div>
            {!props.dropHintDismissed && (
                <div className="testcase-drop-hint-row">
                    <small className="testcase-drop-hint">{t('testcaseDropHint')}</small>
                    <button type="button" className="btn btn-black icon-btn" title={t('close')} aria-label={t('close')} onClick={props.onDismissDropHint}>
                        <i className="codicon codicon-close" aria-hidden="true" />
                    </button>
                </div>
            )}
        </div>
    );
}

/*
 * Part of ShortestPath Judger. Licensed under GPL-3.0-or-later.
 */
import React, { useState } from 'react';
import { t } from '../i18n';
import { useMenuDismiss } from '../useMenuDismiss';
import { CaseAction, CaseMode } from '../../../types';

/**
 * Where a card's "⋯" button sits, in viewport coordinates. The menu is drawn at
 * the panel root rather than inside the card, because the card scrolls.
 */
export type MenuAnchor = { right: number; top: number; bottom: number };

/** What the menu needs to know about the testcase it belongs to. */
export type CaseMenuState = {
    disabled: boolean;
    hasResult: boolean;
    inputIsFile: boolean;
    outputIsFile: boolean;
};

const MODES: { mode: CaseMode; key: string; icon: string }[] = [
    { mode: 'choose', key: 'caseModeChoose', icon: 'folder-opened' },
    { mode: 'toggle', key: 'caseModeToggle', icon: 'file-media' },
    { mode: 'open', key: 'caseModeOpen', icon: 'go-to-file' },
    { mode: 'empty', key: 'caseModeEmpty', icon: 'clear-all' },
];

/**
 * A testcase card's "⋯" menu. The problem header's "⋯" is drawn by AuxMenu, and
 * this is the same surface for a single row: the host used to answer this button
 * with a native quick pick, which made the two menus behave differently.
 *
 * The second level — how to edit a file-backed input or expected output — swaps
 * the panel's contents rather than opening a hover submenu, so it stays usable in
 * a narrow side bar.
 */
export default function CaseActionsMenu(props: {
    anchor: MenuAnchor;
    state: CaseMenuState;
    onAction: (action: CaseAction, mode?: CaseMode) => void;
    onClose: () => void;
}) {
    const [armed, setArmed] = useState(false);
    const [field, setField] = useState<'input' | 'output' | null>(null);
    useMenuDismiss(props.onClose, '[data-case-menu-anchor]');

    const run = (action: CaseAction, mode?: CaseMode) => {
        props.onAction(action, mode);
        props.onClose();
    };

    const row = (key: string, icon: string, onClick: () => void, className = '') => (
        <button
            type="button"
            className={`btn btn-block ${className}`}
            onClick={onClick}
        >
            <i className={`codicon codicon-${icon}`} aria-hidden="true"></i>{' '}
            {t(key)}
        </button>
    );

    // Anchored to the button, opening upwards when the row sits in the lower half
    // of the panel. The height is capped at the room actually left on that side,
    // so a menu opened from the last visible row scrolls instead of running off
    // the edge.
    const opensUp = props.anchor.top > window.innerHeight / 2;
    const style: React.CSSProperties = {
        right: Math.max(8, window.innerWidth - props.anchor.right),
        maxHeight: opensUp
            ? props.anchor.top - 12
            : window.innerHeight - props.anchor.bottom - 12,
    };
    if (opensUp) {
        style.bottom = window.innerHeight - props.anchor.top + 4;
    } else {
        style.top = props.anchor.bottom + 4;
    }

    const fileField = field === 'input' ? props.state.inputIsFile : props.state.outputIsFile;

    return (
        <div
            className="menu case-menu"
            role="menu"
            aria-label={t('testcaseActions')}
            style={style}
        >
            {field === null ? (
                <>
                    {row(
                        props.state.disabled ? 'caseActionEnable' : 'caseActionDisable',
                        props.state.disabled ? 'check' : 'circle-slash',
                        () => run('disable'),
                        'btn-black',
                    )}
                    {row('caseActionUp', 'arrow-up', () => run('up'), 'btn-black')}
                    {row('caseActionDown', 'arrow-down', () => run('down'), 'btn-black')}
                    {row('caseActionClear', 'clear-all', () => run('clear'), 'btn-black')}
                    {row(
                        'caseActionInput',
                        'chevron-right',
                        () => setField('input'),
                        'btn-black',
                    )}
                    {row(
                        'caseActionOutput',
                        'chevron-right',
                        () => setField('output'),
                        'btn-black',
                    )}
                    {props.state.hasResult && (
                        <>
                            {row('caseActionCompare', 'diff', () => run('compare'), 'btn-black')}
                            {row('caseActionAnswer', 'check', () => run('answer'), 'btn-black')}
                        </>
                    )}
                    <button
                        type="button"
                        className={`btn btn-block ${armed ? 'btn-red' : 'btn-black'}`}
                        onClick={() => (armed ? run('delete') : setArmed(true))}
                    >
                        {armed ? (
                            t('confirm')
                        ) : (
                            <>
                                <i
                                    className="codicon codicon-trash"
                                    aria-hidden="true"
                                ></i>{' '}
                                {t('caseActionDelete')}
                            </>
                        )}
                    </button>
                </>
            ) : (
                <>
                    {row(
                        field === 'input' ? 'caseActionInput' : 'caseActionOutput',
                        'chevron-left',
                        () => setField(null),
                        'btn-black',
                    )}
                    {MODES.map(({ mode, key, icon }) => (
                        <button
                            key={mode}
                            type="button"
                            className="btn btn-black btn-block"
                            onClick={() => run(field, mode)}
                        >
                            <i className={`codicon codicon-${icon}`} aria-hidden="true"></i>{' '}
                            {t(mode === 'toggle' && fileField ? 'caseModeInline' : key)}
                        </button>
                    ))}
                </>
            )}
        </div>
    );
}

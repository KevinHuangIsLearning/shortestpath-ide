import React, { useEffect, useRef } from 'react';
import { t } from './i18n';

const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Shared container for every auxiliary surface (settings, JSON import, stress
 * test, help/about). Only one page may be open at a time; the host keeps the
 * background inert by locking scrolling while a page is mounted.
 */
export default function Page(props: {
    content: React.ReactNode;
    title: string;
    closePage: () => void;
    footer?: React.ReactNode;
}) {
    const container = useRef<HTMLDivElement>(null);
    const closeButton = useRef<HTMLButtonElement>(null);
    const closePage = useRef(props.closePage);
    closePage.current = props.closePage;

    useEffect(() => {
        closeButton.current?.focus();
    }, []);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closePage.current();
                return;
            }
            if (event.key !== 'Tab' || !container.current) { return; }
            const focusable = Array.from(
                container.current.querySelectorAll<HTMLElement>(FOCUSABLE),
            );
            if (!focusable.length) { return; }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;
            const outside = !active || !container.current.contains(active);
            if (event.shiftKey && (active === first || outside)) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (active === last || outside)) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, []);

    return (
        <div
            className="page selectable"
            role="dialog"
            aria-modal="true"
            aria-labelledby="judger-page-title"
            ref={container}
        >
            <div className="page-header">
                <h2 id="judger-page-title">{props.title}</h2>
                <button
                    type="button"
                    className="page-close"
                    title={t('close')}
                    aria-label={t('close')}
                    onClick={() => props.closePage()}
                    ref={closeButton}
                >
                    <i className="codicon codicon-close" aria-hidden="true"></i>
                </button>
            </div>
            <hr />
            <div className="page-body">{props.content}</div>
            {props.footer && <div className="page-footer">{props.footer}</div>}
        </div>
    );
}

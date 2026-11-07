import React, { useEffect, useRef } from 'react';
import { t } from './i18n';

const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Shared container for every auxiliary surface (settings, JSON import, stress
 * test, help/about). Only one page may be open at a time. The page covers the
 * judger content, while the status and action bars stay outside its containing
 * block and remain reachable; focus cycles through the page and those bars.
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
            const isVisible = (element: HTMLElement) =>
                element.getClientRects().length > 0;
            const focusable = [
                ...Array.from(
                    container.current.querySelectorAll<HTMLElement>(FOCUSABLE),
                ),
                ...Array.from(
                    document.querySelectorAll<HTMLElement>('[data-page-focus]'),
                ).flatMap((scope) =>
                    Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)),
                ),
            ].filter(isVisible);
            if (!focusable.length) { return; }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const index = focusable.indexOf(
                document.activeElement as HTMLElement,
            );
            if (event.shiftKey) {
                if (index <= 0) {
                    event.preventDefault();
                    last.focus();
                }
            } else if (index === -1 || index === focusable.length - 1) {
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

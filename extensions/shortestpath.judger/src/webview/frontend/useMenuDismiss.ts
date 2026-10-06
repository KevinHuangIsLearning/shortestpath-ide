/*
 * Part of ShortestPath Judger. Licensed under GPL-3.0-or-later.
 */
import { useEffect } from 'react';

/**
 * Dismisses an open menu on an outside press or Escape. Shared by every menu in
 * the panel so they all close the same way.
 *
 * `anchorSelector` matches the control that toggles the menu. A press on it must
 * not count as an outside press: it would close the menu, and the button's own
 * click would immediately reopen it.
 */
export function useMenuDismiss(close: () => void, anchorSelector: string): void {
    useEffect(() => {
        const onPointerDown = (event: MouseEvent) => {
            const target = event.target as Element | null;
            if (target?.closest('.menu') || target?.closest(anchorSelector)) { return; }
            close();
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { close(); }
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [close, anchorSelector]);
}

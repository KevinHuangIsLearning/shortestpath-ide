/*
 * Part of ShortestPath Judger. Licensed under GPL-3.0-or-later.
 *
 * Single translation lookup shared by every webview component. The dictionary is
 * injected into the page by the host (`window.translations`), so the lookup must
 * stay lazy: tests render components with a bare `window`.
 */
interface TranslationWindow extends Window {
    translations?: Record<string, string>;
}
declare const window: TranslationWindow;

export const t = (key: string): string => (window.translations || {})[key] || key;

declare module 'vscode' {
    interface BrowserCDPSession {
        onDidClose: Event<void>;
        sendMessage(message: unknown): Thenable<void>;
        onDidReceiveMessage: Event<unknown>;
        close(): Thenable<void>;
    }
    interface BrowserTab {
        startCDPSession(): Thenable<BrowserCDPSession>;
    }
    namespace window {
        function openBrowserTab(url: string, options?: { viewColumn?: ViewColumn; preserveFocus?: boolean; background?: boolean; modal?: boolean }): Thenable<BrowserTab>;
    }
}

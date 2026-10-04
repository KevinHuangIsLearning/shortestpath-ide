declare module 'vscode' {
    interface BrowserCDPSession {
        onDidClose: Event<void>;
        sendMessage(message: unknown): Thenable<void>;
        onDidReceiveMessage: Event<unknown>;
        close(): Thenable<void>;
    }
    interface BrowserTab {
        readonly id: string;
        startCDPSession(): Thenable<BrowserCDPSession>;
    }
	namespace window {
		const onDidOpenBrowserTab: Event<BrowserTab>;
		const onDidCloseBrowserTab: Event<BrowserTab>;
		const onDidChangeBrowserTabState: Event<BrowserTab>;
        const browserTabs: readonly BrowserTab[];
        const activeBrowserTab: BrowserTab | undefined;
        function openBrowserTab(url: string, options?: { viewColumn?: ViewColumn; preserveFocus?: boolean; background?: boolean; modal?: boolean }): Thenable<BrowserTab>;
    }
}

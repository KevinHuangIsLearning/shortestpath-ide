const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shortestPathSetup', {
	complete: request => ipcRenderer.send('vscode:shortestpath:onboarding-complete', request),
	getScript: () => ipcRenderer.invoke('vscode:shortestpath:onboarding-script'),
	getLocale: () => ipcRenderer.invoke('vscode:shortestpath:onboarding-locale'),
	pickWorkspaceFolder: () => ipcRenderer.invoke('vscode:shortestpath:onboarding-pick-workspace'),
	installToolchain: (sourceId, stage) => ipcRenderer.invoke('vscode:shortestpath:onboarding-install-toolchain', sourceId, stage),
	onProgress: listener => ipcRenderer.on('vscode:shortestpath:onboarding-progress', (_event, message) => listener(message))
});

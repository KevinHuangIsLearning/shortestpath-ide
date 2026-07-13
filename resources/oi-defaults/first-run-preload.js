const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shortestPathSetup', {
	complete: request => ipcRenderer.send('shortestpath:onboarding-complete', request),
	getScript: () => ipcRenderer.invoke('shortestpath:onboarding-script'),
	getLocale: () => ipcRenderer.invoke('shortestpath:onboarding-locale'),
	pickWorkspaceFolder: () => ipcRenderer.invoke('shortestpath:onboarding-pick-workspace'),
	installToolchain: (sourceId, stage) => ipcRenderer.invoke('shortestpath:onboarding-install-toolchain', sourceId, stage),
	onProgress: listener => ipcRenderer.on('shortestpath:onboarding-progress', (_event, message) => listener(message))
});

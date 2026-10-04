/* Copyright (c) 2026 ShortestPath IDE contributors. Licensed under GPL-3.0-or-later. */
// Only parser configuration and background GET are used; Task.send is replaced by returning tasks to the host.
const listeners = new Set<(message: object, sender: object) => void>();
export const browser = {
	storage: { local: { async get() { return {}; } } },
	runtime: {
		onMessage: { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener) },
		async sendMessage(message) {
			if (message.action !== 4) { throw new Error('Unsupported Companion runtime action'); }
			try {
				const response = await fetch(message.payload.url, { credentials: 'include', ...message.payload.options });
				if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
				const content = await response.text();
				for (const listener of listeners) { listener({ action: 5, payload: { messageId: message.payload.messageId, content } }, {}); }
			} catch (error) {
				for (const listener of listeners) { listener({ action: 6, payload: { messageId: message.payload.messageId, message: String(error) } }, {}); }
			}
		},
	},
};

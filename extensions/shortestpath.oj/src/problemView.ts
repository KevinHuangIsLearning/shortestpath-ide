/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare function acquireVsCodeApi(): { postMessage(message: object): void };
declare const katex: { render(source: string, element: Element, options: { displayMode?: boolean; throwOnError: boolean }): void };

(() => {
	const vscode = acquireVsCodeApi();
	const body = document.body;
	const timer = document.getElementById('problem-timer');
	const baseElapsed = Number(body.dataset.elapsedMs || 0);
	const capturedAt = Number(body.dataset.capturedAt || Date.now());
	const running = body.dataset.timerRunning === 'true';

	const formatDuration = (milliseconds: number): string => {
		const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor(totalSeconds % 3600 / 60);
		const seconds = totalSeconds % 60;
		return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
	};
	const updateTimer = (): void => {
		if (timer) {
			timer.textContent = formatDuration(baseElapsed + (running ? Math.max(0, Date.now() - capturedAt) : 0));
		}
	};
	updateTimer();
	if (running) {
		setInterval(updateTimer, 1000);
	}

	document.addEventListener('click', event => {
		const target = event.target;
		const button = target instanceof Element ? target.closest<HTMLButtonElement>('button[data-command]') : null;
		if (!button || button.disabled) {
			return;
		}
		const command = button.dataset.command;
		if (command === 'answer') {
			vscode.postMessage({ command, hintId: button.dataset.hintId });
		} else if (command === 'like') {
			vscode.postMessage({
				command,
				hintId: button.dataset.hintId,
				target: button.dataset.target,
				liked: button.dataset.liked !== 'true',
			});
		} else if (command) {
			vscode.postMessage({ command });
		}
	});

	document.getElementById('watch-submission')?.addEventListener('submit', event => {
		event.preventDefault();
		const data = new FormData(event.currentTarget as HTMLFormElement);
		vscode.postMessage({ command: 'watchSubmission', submissionId: String(data.get('submissionId') || '').trim() });
	});
	document.getElementById('start-stress')?.addEventListener('submit', event => {
		event.preventDefault();
		const data = new FormData(event.currentTarget as HTMLFormElement);
		vscode.postMessage({
			command: 'startStress',
			submissionId: String(data.get('submissionId') || ''),
			rounds: Number(data.get('rounds')),
		});
	});

	for (const block of document.querySelectorAll<HTMLElement>('.math-block[data-tex]')) {
		try {
			katex.render(block.dataset.tex || '', block, { displayMode: true, throwOnError: false });
		} catch {
			block.textContent = `$$${block.dataset.tex || ''}$$`;
		}
	}
	for (const block of document.querySelectorAll('[data-render-math]')) {
		const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
		const nodes: Node[] = [];
		while (walker.nextNode()) {
			nodes.push(walker.currentNode);
		}
		for (const node of nodes) {
			const parent = node.parentElement;
			if (!parent || parent.closest('script, style, code, .katex')) {
				continue;
			}
			const source = node.textContent || '';
			const matches = [...source.matchAll(/\$([^$\n]+)\$/g)];
			if (matches.length === 0) {
				continue;
			}
			const fragment = document.createDocumentFragment();
			let position = 0;
			for (const match of matches) {
				const matchIndex = match.index ?? 0;
				fragment.append(document.createTextNode(source.slice(position, matchIndex)));
				const math = document.createElement('span');
				try {
					katex.render(match[1], math, { throwOnError: false });
				} catch {
					math.textContent = match[0];
				}
				fragment.append(math);
				position = matchIndex + match[0].length;
			}
			fragment.append(document.createTextNode(source.slice(position)));
			node.parentNode?.replaceChild(fragment, node);
		}
	}
})();

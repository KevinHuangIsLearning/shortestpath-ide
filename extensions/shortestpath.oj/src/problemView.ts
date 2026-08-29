/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare function acquireVsCodeApi(): { postMessage(message: object): void };

type TimerState = {
	elapsedMs: number;
	running: boolean;
	accepted: boolean;
	capturedAt: number;
};

type UpdateMessage = {
	type: 'update';
	sections: Record<string, string>;
	timer?: TimerState;
};

type FocusTabMessage = {
	type: 'focusTab';
	tabId: 'statement' | 'hints' | 'submissions';
};

type ConfirmRequest = {
	type: 'confirm';
	id: string;
	message: string;
	confirmLabel: string;
	cancelLabel: string;
};

type ShowHintModalMessage = {
	type: 'showHintModal';
	html: string;
};

type WebViewMessage = UpdateMessage | FocusTabMessage | ConfirmRequest | ShowHintModalMessage | undefined;

(() => {
	const vscode = acquireVsCodeApi();
	const body = document.body;
	const timer = document.getElementById('problem-timer-value');
	const accepted = document.getElementById('problem-accepted');

	/* ---- Split ratio memory ---- */
	// When the user drags the sash next to the problem panel, the webview
	// viewport resizes. Report that (throttled) so the extension can remember
	// the ratio while the panel is still open. The `window` resize event tracks
	// the panel size directly, unlike observing layout-dependent elements.
	let lastReportedWidth: number | undefined;
	let resizeReportTimer: ReturnType<typeof setTimeout> | undefined;
	const reportPanelResized = (): void => {
		const width = Math.round(window.innerWidth);
		if (width === lastReportedWidth) {
			return;
		}
		lastReportedWidth = width;
		if (resizeReportTimer !== undefined) {
			clearTimeout(resizeReportTimer);
		}
		resizeReportTimer = setTimeout(() => {
			resizeReportTimer = undefined;
			vscode.postMessage({ command: 'reportProblemPanelResized' });
		}, 250);
	};
	window.addEventListener('resize', reportPanelResized);
	// Record the initial ratio once the layout is ready as well.
	reportPanelResized();

	const timerState: TimerState = {
		elapsedMs: Number(body.dataset.elapsedMs || 0),
		capturedAt: Number(body.dataset.capturedAt || Date.now()),
		running: body.dataset.timerRunning === 'true',
		accepted: body.dataset.timerAccepted === 'true',
	};
	let timerTimeout: ReturnType<typeof setTimeout> | undefined;
	let submitConfirmationTimer: ReturnType<typeof setTimeout> | undefined;
	let operationNoticeRemovalTimer: number | undefined;
	let compatibilityWarningDismissTimer: ReturnType<typeof setTimeout> | undefined;
	const dismissCompatibilityWarning = (): void => {
		const warning = document.querySelector<HTMLElement>('#oj-compatibility-warning .compatibility-warning');
		if (!warning || warning.classList.contains('leaving')) {
			return;
		}
		if (compatibilityWarningDismissTimer !== undefined) {
			clearTimeout(compatibilityWarningDismissTimer);
			compatibilityWarningDismissTimer = undefined;
		}
		warning.classList.add('leaving');
		const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180;
		setTimeout(() => vscode.postMessage({ command: 'dismissCompatibilityWarning' }), delay);
	};
	const scheduleCompatibilityWarningDismissal = (): void => {
		if (compatibilityWarningDismissTimer !== undefined) {
			clearTimeout(compatibilityWarningDismissTimer);
		}
		if (document.querySelector('#oj-compatibility-warning .compatibility-warning')) {
			compatibilityWarningDismissTimer = setTimeout(dismissCompatibilityWarning, 60_000);
		}
	};
	const resetSubmitConfirmation = (button: HTMLButtonElement): void => {
		if (submitConfirmationTimer) {
			clearTimeout(submitConfirmationTimer);
			submitConfirmationTimer = undefined;
		}
		button.classList.remove('armed');
		button.dataset.armed = 'false';
		button.textContent = '提交代码';
	};

	const formatDuration = (milliseconds: number): string => {
		const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor(totalSeconds % 3600 / 60);
		const seconds = totalSeconds % 60;
		return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
	};
	const formatElapsedTimer = (milliseconds: number): string => milliseconds > 5 * 60 * 60 * 1000 ? '05:00:00+' : formatDuration(milliseconds);
	const getElapsedTimerMs = (): number => timerState.elapsedMs + (timerState.running ? Math.max(0, Date.now() - timerState.capturedAt) : 0);
	const updateTimer = (): void => {
		if (timer) {
			timer.textContent = formatElapsedTimer(getElapsedTimerMs());
		}
		if (accepted) {
			accepted.hidden = !timerState.accepted;
		}
	};
	const startTimerInterval = (): void => {
		if (timerTimeout === undefined && timerState.running) {
			const delay = 1000 - getElapsedTimerMs() % 1000;
			timerTimeout = setTimeout(() => {
				timerTimeout = undefined;
				updateTimer();
				startTimerInterval();
			}, delay);
		}
	};
	const stopTimerInterval = (): void => {
		if (timerTimeout !== undefined) {
			clearTimeout(timerTimeout);
			timerTimeout = undefined;
		}
	};
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) {
			stopTimerInterval();
		} else {
			updateTimer();
			startTimerInterval();
		}
	});
	updateTimer();
	startTimerInterval();

	const updateTagPopoverDirection = (anchor: HTMLElement): void => {
		const popover = anchor.querySelector<HTMLElement>('.tag-popover');
		if (!popover) {
			return;
		}
		anchor.classList.remove('popover-opens-right');
		const anchorBounds = anchor.getBoundingClientRect();
		if (anchorBounds.right - popover.offsetWidth < 12) {
			anchor.classList.add('popover-opens-right');
		}
	};

	document.addEventListener('pointerover', event => {
		const target = event.target;
		const anchor = target instanceof Element ? target.closest<HTMLElement>('.tag-popover-anchor') : null;
		if (anchor) {
			updateTagPopoverDirection(anchor);
		}
	});
	document.addEventListener('focusin', event => {
		const target = event.target;
		const anchor = target instanceof Element ? target.closest<HTMLElement>('.tag-popover-anchor') : null;
		if (anchor) {
			updateTagPopoverDirection(anchor);
		}
	});

	/* ---- Hint countdown ---- */
	let hintCountdownInterval: ReturnType<typeof setInterval> | undefined;
	const formatCountdown = (ms: number): string => {
		const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
		const h = Math.floor(totalSeconds / 3600);
		const m = Math.floor(totalSeconds % 3600 / 60);
		const s = totalSeconds % 60;
		return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
	};
	let countdownRenderedAt = Date.now();
	const updateHintCountdowns = (): void => {
		const elapsed = Date.now() - countdownRenderedAt;
		document.querySelectorAll<HTMLElement>('[data-remaining-ms]').forEach(el => {
			const base = Number(el.dataset.remainingMs || '0');
			const remaining = Math.max(0, base - elapsed);
			const text = `剩余 ${formatCountdown(remaining)}`;
			const countdown = el.querySelector<HTMLElement>('.hint-countdown');
			if (countdown) {
				countdown.textContent = text;
			}
			const editorialCountdown = el.querySelector<HTMLElement>('.editorial-countdown');
			if (editorialCountdown) {
				editorialCountdown.textContent = text;
			}
			if (remaining === 0) {
				el.removeAttribute('data-remaining-ms');
				countdown?.remove();
				editorialCountdown?.remove();
				const feedback = el.closest('.modal')?.querySelector<HTMLElement>('.hint-feedback');
				if (feedback) {
					feedback.textContent = '等待网页同步。';
				}
				const lockLabel = el.querySelector<HTMLElement>('.hint-lock-label');
				if (lockLabel) {
					lockLabel.textContent = '等待网页同步';
				}
				if (el instanceof HTMLButtonElement) {
					el.disabled = true;
					el.textContent = '等待网页同步';
				}
			}
		});
	};
	const startHintCountdown = (): void => {
		if (hintCountdownInterval === undefined) {
			updateHintCountdowns();
			hintCountdownInterval = setInterval(updateHintCountdowns, 1000);
		}
	};
	const stopHintCountdown = (): void => {
		if (hintCountdownInterval !== undefined) {
			clearInterval(hintCountdownInterval);
			hintCountdownInterval = undefined;
		}
	};
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) {
			stopHintCountdown();
		} else {
			startHintCountdown();
		}
	});
	startHintCountdown();

	/* ---- Modal infrastructure ---- */
	const modalOverlay = document.getElementById('oj-modal-overlay');
	const pendingConfirms = new Map<string, (result: boolean) => void>();
	const dismissPendingConfirms = (): void => {
		for (const [id, resolve] of pendingConfirms) {
			pendingConfirms.delete(id);
			resolve(false);
		}
	};

	const closeModal = (): void => {
		dismissPendingConfirms();
		if (!modalOverlay || modalOverlay.hidden) {
			return;
		}
		modalOverlay.classList.remove('visible');
		const overlay = modalOverlay;
		setTimeout(() => {
			if (!overlay.classList.contains('visible')) {
				overlay.hidden = true;
				overlay.innerHTML = '';
			}
		}, 200);
	};

	const showModal = (content: HTMLElement): void => {
		if (!modalOverlay) {
			return;
		}
		modalOverlay.innerHTML = '';
		modalOverlay.appendChild(content);
		modalOverlay.hidden = false;
		void modalOverlay.offsetHeight;
		modalOverlay.classList.add('visible');
	};

	const showConfirmDialog = (message: string, confirmLabel: string, cancelLabel: string): Promise<boolean> => {
		return new Promise(resolve => {
			const id = Math.random().toString(36).slice(2);
			pendingConfirms.set(id, resolve);

			const dialog = document.createElement('div');
			dialog.className = 'modal confirm-dialog';
			dialog.innerHTML = `
				<div class="modal-body">
					<p class="confirm-message"></p>
					<div class="confirm-actions">
						<button type="button" class="secondary cancel-btn"></button>
						<button type="button" class="confirm-btn"></button>
					</div>
				</div>`;
			dialog.querySelector('.confirm-message')!.textContent = message;
			dialog.querySelector('.cancel-btn')!.textContent = cancelLabel;
			dialog.querySelector('.confirm-btn')!.textContent = confirmLabel;

			dialog.querySelector('.cancel-btn')!.addEventListener('click', () => {
				pendingConfirms.delete(id);
				closeModal();
				resolve(false);
			});
			dialog.querySelector('.confirm-btn')!.addEventListener('click', () => {
				pendingConfirms.delete(id);
				closeModal();
				resolve(true);
			});

			showModal(dialog);
			(dialog.querySelector('.confirm-btn') as HTMLElement)?.focus();
		});
	};

	window.addEventListener('message', (event: MessageEvent) => {
		const message = event.data as ConfirmRequest | ShowHintModalMessage | undefined;
		if (message && message.type === 'confirm') {
			void showConfirmDialog(message.message, message.confirmLabel, message.cancelLabel).then(result => {
				vscode.postMessage({ command: 'confirmResult', confirmId: message.id, result });
			});
			return;
		}
		if (message && message.type === 'showHintModal') {
			countdownRenderedAt = Date.now();
			const modal = document.createElement('div');
			modal.className = 'modal hint-modal';
			modal.innerHTML = message.html;
			showModal(modal);
			return;
		}
	});

	if (modalOverlay) {
		modalOverlay.addEventListener('click', event => {
			if (event.target === modalOverlay) {
				closeModal();
			}
		});
	}

	document.addEventListener('keydown', event => {
		if (event.key === 'Escape' && modalOverlay && !modalOverlay.hidden) {
			closeModal();
		}
		if (event.key !== 'Enter' && event.key !== ' ') {
			return;
		}
		const target = event.target;
		const hintItem = target instanceof Element ? target.closest<HTMLElement>('[data-command="openHintModal"]') : null;
		if (!hintItem) {
			return;
		}
		event.preventDefault();
		openHintModal(hintItem.dataset.hintId!);
	});

	/* ---- Hint modal ---- */
	const openHintModal = (hintId: string): void => {
		vscode.postMessage({ command: 'openHintModal', hintId });
	};

	/* ---- Submission collapse/expand animation ---- */
	document.addEventListener('click', event => {
		const target = event.target;
		const summary = target instanceof Element ? target.closest<HTMLElement>('.submission > summary') : null;
		if (!summary) {
			return;
		}
		const details = summary.parentElement;
		if (!(details instanceof HTMLDetailsElement) || details.classList.contains('animating')) {
			return;
		}
		event.preventDefault();
		details.classList.add('animating');
		const body = details.querySelector<HTMLElement>('.submission-body');
		if (!body) {
			details.classList.remove('animating');
			return;
		}
		if (details.open) {
			// Collapse: animate from current height to 0
			body.style.maxHeight = `${body.scrollHeight}px`;
			void body.offsetHeight;
			body.style.maxHeight = '0';
			body.style.opacity = '0';
			setTimeout(() => {
				details.open = false;
				details.classList.remove('animating');
				body.style.maxHeight = '';
				body.style.opacity = '';
			}, 200);
		} else {
			// Expand: open first, then animate from 0 to scrollHeight
			details.open = true;
			body.style.maxHeight = '0';
			body.style.opacity = '0';
			void body.offsetHeight;
			body.style.maxHeight = `${body.scrollHeight}px`;
			body.style.opacity = '1';
			setTimeout(() => {
				details.classList.remove('animating');
				body.style.maxHeight = '';
				body.style.opacity = '';
			}, 200);
		}
	});

	/* ---- Sample copy ---- */
	const copySample = async (button: HTMLButtonElement): Promise<void> => {
		const block = button.closest('.io-block');
		const code = block?.querySelector('pre code');
		if (!code) {
			return;
		}
		const text = code.textContent ?? '';
		if (!text) {
			return;
		}
		const writeText = async (): Promise<boolean> => {
			if (navigator.clipboard?.writeText) {
				try {
					await navigator.clipboard.writeText(text);
					return true;
				} catch {
					// Fall through to the textarea fallback below.
				}
			}
			try {
				const textarea = document.createElement('textarea');
				textarea.value = text;
				textarea.style.position = 'fixed';
				textarea.style.opacity = '0';
				document.body.appendChild(textarea);
				textarea.focus();
				textarea.select();
				const ok = document.execCommand('copy');
				document.body.removeChild(textarea);
				return ok;
			} catch {
				return false;
			}
		};
		if (await writeText()) {
			const original = button.textContent;
			button.textContent = '已复制';
			button.classList.add('copied');
			setTimeout(() => {
				button.textContent = original;
				button.classList.remove('copied');
			}, 1500);
		}
	};

	/* ---- Click handler ---- */
	document.addEventListener('click', event => {
		const target = event.target;

		// Sample input/output copy button (local webview operation).
		const copyButton = target instanceof Element ? target.closest<HTMLButtonElement>('.copy-btn') : null;
		if (copyButton) {
			void copySample(copyButton);
			return;
		}

		// Hint list item click → open modal (handled by extension via postMessage)
		const hintItem = target instanceof Element ? target.closest<HTMLElement>('[data-command="openHintModal"]') : null;
		if (hintItem) {
			openHintModal(hintItem.dataset.hintId!);
			return;
		}

		const button = target instanceof Element ? target.closest<HTMLButtonElement>('button[data-command]') : null;
		if (!button || button.disabled) {
			return;
		}
		const command = button.dataset.command;
		if (command === 'dismissCompatibilityWarning') {
			dismissCompatibilityWarning();
			return;
		}
		if (command === 'submit') {
			if (button.dataset.armed !== 'true') {
				button.classList.add('armed');
				button.dataset.armed = 'true';
				button.textContent = '确认提交';
				if (submitConfirmationTimer) {
					clearTimeout(submitConfirmationTimer);
				}
				submitConfirmationTimer = setTimeout(() => resetSubmitConfirmation(button), 3000);
				return;
			}
			resetSubmitConfirmation(button);
			vscode.postMessage({ command });
		} else if (command === 'answer') {
			vscode.postMessage({ command, hintId: button.dataset.hintId });
		} else if (command === 'like') {
			vscode.postMessage({
				command,
				hintId: button.dataset.hintId,
				target: button.dataset.target,
				liked: button.dataset.liked !== 'true',
			});
		} else if (command === 'addStressCounterExample') {
			vscode.postMessage({ command, taskId: button.dataset.taskId });
		} else if (command === 'startStress') {
			vscode.postMessage({ command, submissionId: button.dataset.submissionId, rounds: Number(button.dataset.rounds) });
		} else if (command === 'editorial') {
			vscode.postMessage({ command });
		} else if (command === 'closeModal') {
			closeModal();
		} else if (command) {
			vscode.postMessage({ command });
		}
	});

	document.addEventListener('submit', event => {
		const form = event.target;
		if (!(form instanceof HTMLFormElement)) {
			return;
		}
		event.preventDefault();
		const data = new FormData(form);
		if (form.id === 'watch-submission') {
			vscode.postMessage({ command: 'watchSubmission', submissionId: String(data.get('submissionId') || '').trim() });
		} else if (form.id === 'start-stress') {
			vscode.postMessage({
				command: 'startStress',
				submissionId: String(data.get('submissionId') || ''),
				rounds: Number(data.get('rounds')),
			});
		}
	});

	type SectionSnapshot = {
		values: Array<[string, string]>;
		openDetails: string[];
		allDetailKeys: string[];
		focusedName: string | undefined;
		selectionStart: number | undefined;
	};
	const snapshotSection = (section: Element): SectionSnapshot => {
		const values: Array<[string, string]> = [];
		let focusedName: string | undefined;
		let selectionStart: number | undefined;
		for (const control of section.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input[name], select[name], textarea[name]')) {
			values.push([control.name, control.value]);
			if (control === document.activeElement) {
				focusedName = control.name;
				if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
					selectionStart = control.selectionStart ?? undefined;
				}
			}
		}
		const openDetails: string[] = [];
		const allDetailKeys: string[] = [];
		section.querySelectorAll('details').forEach((details, index) => {
			const key = details.getAttribute('data-persist-key') ?? String(index);
			allDetailKeys.push(key);
			if (details.open) {
				openDetails.push(key);
			}
		});
		return { values, openDetails, allDetailKeys, focusedName, selectionStart };
	};
	const restoreSection = (section: Element, snapshot: SectionSnapshot): void => {
		const remaining = new Map(snapshot.values);
		for (const control of section.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input[name], select[name], textarea[name]')) {
			const stored = remaining.get(control.name);
			if (stored !== undefined) {
				control.value = stored;
				remaining.delete(control.name);
			}
			if (snapshot.focusedName !== undefined && control.name === snapshot.focusedName) {
				control.focus();
				if (snapshot.selectionStart !== undefined && (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) {
					try {
						control.setSelectionRange(snapshot.selectionStart, snapshot.selectionStart);
					} catch {
						// Some control types (e.g. number) do not support selection ranges.
					}
				}
			}
		}
		section.querySelectorAll('details').forEach((details, index) => {
			const key = details.getAttribute('data-persist-key') ?? String(index);
			if (snapshot.allDetailKeys.includes(key)) {
				details.open = snapshot.openDetails.includes(key);
			}
		});
	};

	const getActiveTabId = (): string | undefined => {
		const active = document.querySelector('.tab-button.active');
		return active instanceof HTMLElement ? active.dataset.tab : undefined;
	};
	const tabAnimationTimers = new WeakMap<HTMLElement, number>();
	const parseAnimationTime = (value: string): number => {
		const trimmed = value.trim();
		if (!trimmed) {
			return 0;
		}
		if (trimmed.endsWith('ms')) {
			return Number(trimmed.slice(0, -2)) || 0;
		}
		if (trimmed.endsWith('s')) {
			return (Number(trimmed.slice(0, -1)) || 0) * 1000;
		}
		return 0;
	};
	const getElementAnimationDuration = (element: HTMLElement): number => {
		const style = window.getComputedStyle(element);
		const durations = style.animationDuration.split(',');
		const delays = style.animationDelay.split(',');
		let maxDuration = 0;
		for (let index = 0; index < durations.length; index++) {
			const duration = parseAnimationTime(durations[index] || '');
			const delay = parseAnimationTime(delays[index] || delays[delays.length - 1] || '');
			maxDuration = Math.max(maxDuration, duration + delay);
		}
		return maxDuration;
	};
	const getTabAnimationDuration = (panel: HTMLElement): number => {
		let maxDuration = 0;
		for (const element of panel.querySelectorAll<HTMLElement>('*')) {
			maxDuration = Math.max(maxDuration, getElementAnimationDuration(element));
		}
		return maxDuration;
	};
	const clearTabAnimation = (panel: HTMLElement): void => {
		const timer = tabAnimationTimers.get(panel);
		if (timer !== undefined) {
			window.clearTimeout(timer);
			tabAnimationTimers.delete(panel);
		}
		panel.classList.remove('play-tab-animation');
	};
	const playTabAnimation = (panel: HTMLElement): void => {
		clearTabAnimation(panel);
		void panel.offsetHeight;
		panel.classList.add('play-tab-animation');
		const duration = getTabAnimationDuration(panel);
		const timer = window.setTimeout(() => {
			panel.classList.remove('play-tab-animation');
			tabAnimationTimers.delete(panel);
		}, duration + 50);
		tabAnimationTimers.set(panel, timer);
	};
	const setActiveTab = (tabId: string, options?: { animate?: boolean }): void => {
		const previousTabId = getActiveTabId();
		document.querySelectorAll('.tab-button').forEach(button => {
			const isActive = button instanceof HTMLElement && button.dataset.tab === tabId;
			button.classList.toggle('active', isActive);
			button.setAttribute('aria-selected', String(isActive));
		});
		document.querySelectorAll('.tab-panel').forEach(panel => {
			const isPanel = panel instanceof HTMLElement;
			const isActive = isPanel && panel.id === `oj-${tabId}`;
			panel.classList.toggle('active', Boolean(isActive));
			if (!isPanel) {
				return;
			}
			panel.hidden = !isActive;
			panel.setAttribute('aria-hidden', String(!isActive));
			if (isActive && options?.animate !== false && previousTabId !== tabId) {
				playTabAnimation(panel);
			} else {
				clearTabAnimation(panel);
			}
		});
	};
	document.addEventListener('click', event => {
		const tabButton = event.target instanceof Element ? event.target.closest<HTMLElement>('.tab-button') : null;
		if (tabButton) {
			const tabId = tabButton.dataset.tab;
			if (tabId) {
				setActiveTab(tabId);
			}
			return;
		}
	});
	const initialTabId = getActiveTabId();
	if (initialTabId) {
		setActiveTab(initialTabId, { animate: false });
	}

	const animateHeightChange = (section: HTMLElement, update: () => void): void => {
		const oldHeight = section.scrollHeight;
		const previousTransition = section.style.transition;
		const previousHeight = section.style.height;
		const previousOverflow = section.style.overflow;
		section.style.overflow = 'hidden';
		section.style.transition = 'none';
		section.style.height = `${oldHeight}px`;
		update();
		const newHeight = section.scrollHeight;
		if (oldHeight === newHeight) {
			section.style.height = previousHeight;
			section.style.transition = previousTransition;
			section.style.overflow = previousOverflow;
			return;
		}
		void section.offsetHeight;
		section.style.transition = 'height 200ms ease';
		section.style.height = `${newHeight}px`;
		window.setTimeout(() => {
			section.style.height = previousHeight;
			section.style.transition = previousTransition;
			section.style.overflow = previousOverflow;
		}, 200);
	};
	const updateOperationNotice = (section: HTMLElement, html: string): void => {
		if (operationNoticeRemovalTimer !== undefined) {
			window.clearTimeout(operationNoticeRemovalTimer);
			operationNoticeRemovalTimer = undefined;
		}
		const currentNotice = section.querySelector<HTMLElement>('.operation-notice');
		if (html === '' && currentNotice) {
			currentNotice.classList.add('leaving');
			const removalDelay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160;
			operationNoticeRemovalTimer = window.setTimeout(() => {
				operationNoticeRemovalTimer = undefined;
				animateHeightChange(section, () => {
					section.innerHTML = '';
				});
			}, removalDelay);
			return;
		}
		animateHeightChange(section, () => {
			section.innerHTML = html;
		});
	};
	const snapshotSubmissionHeights = (section: HTMLElement): Map<string, number> => {
		const heights = new Map<string, number>();
		section.querySelectorAll<HTMLElement>('.submission[data-persist-key]').forEach(submission => {
			const key = submission.dataset.persistKey;
			if (key) {
				heights.set(key, submission.getBoundingClientRect().height);
			}
		});
		return heights;
	};
	const animateSubmissionResize = (section: HTMLElement, previousHeights: Map<string, number>): void => {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			return;
		}
		section.querySelectorAll<HTMLElement>('.submission[data-persist-key]').forEach(submission => {
			const key = submission.dataset.persistKey;
			const previousHeight = key ? previousHeights.get(key) : undefined;
			if (previousHeight === undefined) {
				return;
			}
			const nextHeight = submission.getBoundingClientRect().height;
			if (Math.abs(previousHeight - nextHeight) < 1) {
				return;
			}
			submission.style.overflow = 'hidden';
			submission.style.transition = 'none';
			submission.style.height = `${previousHeight}px`;
			void submission.offsetHeight;
			submission.style.transition = 'height 200ms ease';
			submission.style.height = `${nextHeight}px`;
			window.setTimeout(() => {
				submission.style.height = '';
				submission.style.transition = '';
				submission.style.overflow = '';
			}, 200);
		});
	};

	window.addEventListener('message', event => {
		const message = event.data as WebViewMessage;
		if (!message) {
			return;
		}
		if (message.type === 'confirm' || message.type === 'showHintModal') {
			return; // handled by the dedicated handler above
		}
		if (message.type === 'focusTab') {
			setActiveTab(message.tabId);
			return;
		}
		if (message.type !== 'update') {
			return;
		}
		const hasCountdownUpdate = Object.keys(message.sections).some(id => id === 'oj-hints' || id === 'oj-editorial-action');
		for (const [id, html] of Object.entries(message.sections)) {
			const section = document.getElementById(id);
			if (!section) {
				continue;
			}
			if (id === 'oj-operation-notice') {
				updateOperationNotice(section, html);
				continue;
			}
			const snapshot = snapshotSection(section);
			const submissionHeights = id === 'oj-submissions' ? snapshotSubmissionHeights(section) : undefined;
			const updateSection = () => {
				section.innerHTML = html;
				restoreSection(section, snapshot);
			};
			if (id === 'oj-hints') {
				// Hint state is synchronized frequently for countdown and access updates.
				// Replacing it directly avoids replaying a height animation on every sync.
				updateSection();
			} else if (id === 'oj-compatibility-warning') {
				// The warning has its own entrance animation. Avoid the generic height
				// transition so reduced-motion users do not receive a second animation.
				updateSection();
				scheduleCompatibilityWarningDismissal();
			} else if (submissionHeights) {
				updateSection();
				animateSubmissionResize(section, submissionHeights);
			} else {
				animateHeightChange(section, updateSection);
			}
		}
		if (hasCountdownUpdate) {
			countdownRenderedAt = Date.now();
		}
		if (message.timer) {
			timerState.elapsedMs = message.timer.elapsedMs;
			timerState.capturedAt = message.timer.capturedAt;
			timerState.running = message.timer.running;
			timerState.accepted = message.timer.accepted;
			updateTimer();
			if (timerState.running) {
				stopTimerInterval();
				startTimerInterval();
			} else {
				stopTimerInterval();
			}
		}
	});

	scheduleCompatibilityWarningDismissal();

	vscode.postMessage({ command: 'ready' });
})();

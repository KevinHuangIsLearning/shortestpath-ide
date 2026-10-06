/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare function acquireVsCodeApi(): { postMessage(message: object): void; setState(state: object): void };

type TimerState = {
	elapsedMs: number;
	running: boolean;
	accepted: boolean;
	capturedAt: number;
};

type UpdateMessage = {
	type: 'update';
	sections: Record<string, string>;
	connected?: boolean;
	timer?: TimerState;
};

type FocusTabMessage = {
	type: 'focusTab';
	tabId: 'statement' | 'hints' | 'submissions' | 'editorial';
};

type ConfirmRequest = {
	type: 'confirm';
	id: string;
	message: string;
	confirmLabel: string;
	cancelLabel: string;
};

type SourceChangedMessage = { type: 'sourceChanged'; problemRef: string; sourcePath: string };
type LocalTestSavedMessage = { type: 'localTestSaved'; action: 'add' | 'update'; id?: number };
type WebViewMessage = LocalTestSavedMessage | SourceChangedMessage | UpdateMessage | FocusTabMessage | ConfirmRequest | { type: 'expandHint'; hintId: string } | undefined;

(() => {
	const vscode = acquireVsCodeApi();
	const body = document.body;
	vscode.setState({ problemRef: body.dataset.problemRef, sourcePath: body.dataset.sourcePath });
	document.querySelector('.title-line h1 a')?.addEventListener('click', event => {
		event.preventDefault();
		vscode.postMessage({ command: 'openWebsite' });
	});
	const timer = document.getElementById('problem-timer-value');
	const accepted = document.getElementById('problem-accepted');
	const updateTitleLayout = (): void => {
		const title = document.querySelector<HTMLAnchorElement>('.title-line h1 a');
		const heading = title?.parentElement;
		if (!title || !heading) {
			return;
		}
		heading.classList.remove('title-wrap');
		if (title.clientWidth > 0) {
			heading.classList.toggle('title-wrap', title.scrollWidth > title.clientWidth);
		}
	};
	window.requestAnimationFrame(updateTitleLayout);
	window.addEventListener('resize', updateTitleLayout);

	const timerState: TimerState = {
		elapsedMs: Number(body.dataset.elapsedMs || 0),
		capturedAt: Number(body.dataset.capturedAt || Date.now()),
		running: body.dataset.timerRunning === 'true',
		accepted: body.dataset.timerAccepted === 'true',
	};
	let timerTimeout: ReturnType<typeof setTimeout> | undefined;
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
				const feedback = el.closest('.hint-item')?.querySelector<HTMLElement>('.hint-feedback');
				if (feedback) {
					feedback.textContent = '';
				}
				const lockLabel = el.querySelector<HTMLElement>('.hint-lock-label');
				if (lockLabel) {
					lockLabel.textContent = '查看提示';
				}
				if (el instanceof HTMLButtonElement) {
					el.disabled = body.dataset.connected === 'false';
					el.classList.toggle('locked', el.disabled);
					el.setAttribute('aria-label', '查看提示');
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

	const ratingOverlay = document.getElementById('oj-rating-overlay');
	let ratingFocus: HTMLElement | null = null;
	let ratingFocusedCommand: string | undefined;
	let ratingFocusedChoice: string | undefined;
	const rememberRatingFocus = (): void => {
		if (ratingOverlay?.contains(document.activeElement) && document.activeElement instanceof HTMLButtonElement) {
			ratingFocusedCommand = document.activeElement.dataset.command;
			ratingFocusedChoice = document.activeElement.dataset.rating;
		}
	};
	const syncRatingDialog = (): void => {
		if (!ratingOverlay) { return; }
		const open = Boolean(ratingOverlay.querySelector('.rating-modal')) && (!modalOverlay || Boolean(modalOverlay.hidden));
		const wasHidden = Boolean(ratingOverlay.hidden);
		ratingOverlay.hidden = !open;
		ratingOverlay.classList.toggle('visible', open);
		if (open) {
			if (wasHidden && !ratingFocus && document.activeElement instanceof HTMLElement && !modalOverlay?.contains(document.activeElement)) {
				ratingFocus = document.activeElement;
			}
			if (!ratingOverlay.contains(document.activeElement)) {
				const buttons = Array.from(ratingOverlay.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
				const restored = buttons.find(button => button.dataset.command === ratingFocusedCommand && button.dataset.rating === ratingFocusedChoice);
				(restored ?? buttons[0])?.focus();
			}
		} else if (!open && !wasHidden && (modalOverlay?.hidden ?? true)) {
			if (ratingFocus?.isConnected) { ratingFocus.focus(); }
			ratingFocus = null;
			ratingFocusedCommand = undefined;
			ratingFocusedChoice = undefined;
		}
	};
	const dismissRatingDialog = (): void => {
		if (ratingOverlay) { ratingOverlay.hidden = true; ratingOverlay.classList.remove('visible'); }
		vscode.postMessage({ command: 'dismissRating' });
		if (ratingFocus?.isConnected) { ratingFocus.focus(); }
		ratingFocus = null;
	};
	ratingOverlay?.addEventListener('click', event => {
		if (event.target === ratingOverlay) { dismissRatingDialog(); }
	});

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
				syncRatingDialog();
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
		syncRatingDialog();
	};

	const showConfirmDialog = (message: string, confirmLabel: string, cancelLabel: string): Promise<boolean> => {
		return new Promise(resolve => {
			const id = Math.random().toString(36).slice(2);
			pendingConfirms.set(id, resolve);

			const dialog = document.createElement('div');
			dialog.className = 'modal confirm-dialog';
			dialog.innerHTML = `
				<div class="modal-body">
					<p class="confirm-message" data-i18n-ignore></p>
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
		const message = event.data as ConfirmRequest | undefined;
		if (message && message.type === 'confirm') {
			void showConfirmDialog(message.message, message.confirmLabel, message.cancelLabel).then(result => {
				vscode.postMessage({ command: 'confirmResult', confirmId: message.id, result });
			});
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
		if (ratingOverlay && !ratingOverlay.hidden) {
			if (event.key === 'Escape') { event.preventDefault(); dismissRatingDialog(); return; }
			if (event.key === 'Tab') {
				const buttons = Array.from(ratingOverlay.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
				const first = buttons[0];
				const last = buttons[buttons.length - 1];
				if (event.shiftKey && (document.activeElement === first || !ratingOverlay.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
				if (!event.shiftKey && (document.activeElement === last || !ratingOverlay.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
			}
		}
		if (event.key === 'Escape' && modalOverlay && !modalOverlay.hidden) {
			closeModal();
		}
	});

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

	document.addEventListener('change', event => {
		const select = event.target;
		if (!(select instanceof HTMLSelectElement) || select.dataset.command !== 'selectStatementVersion') {
			return;
		}
		vscode.postMessage({ command: 'selectStatementVersion', versionIndex: Number(select.value) });
	});

	/* ---- Sample copy ---- */
	const copySample = async (button: HTMLButtonElement): Promise<void> => {
		const block = button.closest('.io-block');
		const code = block?.querySelector('pre code');
		if (!code) {
			return;
		}
		const edit = block?.querySelector<HTMLTextAreaElement>('.local-test-value[open] textarea');
		const text = edit?.value ?? code.textContent ?? '';
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
			const original = button.innerHTML;
			if (!button.classList.contains('local-test-icon')) { button.textContent = '已复制'; }
			button.classList.add('copied');
			setTimeout(() => {
				button.innerHTML = original;
				button.classList.remove('copied');
			}, 1500);
		}
	};

	/* ---- Click handler ---- */
	let pendingNewTest: { input: string; output: string } | undefined;
	const readTestFields = (container: Element): { input: string; output: string } => ({
		input: container.querySelector<HTMLTextAreaElement>('[data-local-input]')?.value ?? '',
		output: container.querySelector<HTMLTextAreaElement>('[data-local-output]')?.value ?? '',
	});
	const readTestEdits = (id?: number): Array<{ id: number; input: string; output: string }> => Array.from(document.querySelectorAll<HTMLElement>('.local-test'))
		.filter(card => card.classList.contains('custom') && (id === undefined || Number(card.dataset.testId) === id))
		.map(card => ({ id: Number(card.dataset.testId), ...readTestFields(card) }));

	document.addEventListener('click', event => {
		const target = event.target;
		const valueSummary = target instanceof Element ? target.closest('.local-test-value > summary') : null;
		if (valueSummary) {
			const field = valueSummary.parentElement?.querySelector<HTMLTextAreaElement>('textarea');
			if (field?.disabled) { event.preventDefault(); }
			else { window.setTimeout(() => field?.focus(), 0); }
			return;
		}

		// Sample input/output copy button (local webview operation).
		const copyButton = target instanceof Element ? target.closest<HTMLButtonElement>('.copy-btn') : null;
		if (copyButton) {
			event.preventDefault();
			void copySample(copyButton);
			return;
		}

		// The summary's native action expands or collapses the inline hint.
		const hintSummary = target instanceof Element ? target.closest<HTMLElement>('.hint-item > summary') : null;
		const hint = hintSummary?.parentElement as HTMLDetailsElement | undefined;
		if (hint) {
			if (!hint.open) {
				vscode.postMessage({ command: 'openHint', hintId: hint.dataset.hintId });
			}
			return;
		}

		const button = target instanceof Element ? target.closest<HTMLButtonElement>('button[data-command]') : null;
		if (!button || button.disabled) {
			return;
		}
		if (button.closest('summary')) { event.preventDefault(); }
		const command = button.dataset.command;
		if (command === 'localTestNew') {
			const form = document.querySelector<HTMLDetailsElement>('.local-test-add');
			if (form) {
				const samples = form.closest<HTMLDetailsElement>('.samples');
				if (samples) { samples.open = true; }
				form.open = true;
				form.querySelector<HTMLTextAreaElement>('textarea')?.focus();
			}
			return;
		}
		if (command === 'localTestRun' || command === 'localTestRunAll') {
			const id = command === 'localTestRun' ? Number(button.dataset.testId) : undefined;
			vscode.postMessage({ command, id, edits: readTestEdits(id) });
			return;
		}
		if (command === 'localTestSave' || command === 'localTestAdd') {
			const container = button.closest(command === 'localTestSave' ? '.local-test' : '.local-test-add');
			if (container) {
				const fields = readTestFields(container);
				if (command === 'localTestAdd') { pendingNewTest = fields; }
				vscode.postMessage({ command, id: Number(button.dataset.testId), ...fields });
			}
			return;
		}
		if (command === 'localTestDelete') {
			vscode.postMessage({ command, id: Number(button.dataset.testId) });
			return;
		}
		if (command === 'dismissCompatibilityWarning') {
			dismissCompatibilityWarning();
			return;
		}
		if (command === 'rateProblem') {
			vscode.postMessage({ command, rating: button.dataset.rating });
		} else if (command === 'dismissRating') {
			dismissRatingDialog();
		} else if (command === 'submit') {
			vscode.postMessage({ command });
		} else if (command === 'correct') {
			vscode.postMessage({ command, submissionId: button.dataset.submissionId });
		} else if (command === 'retryConnection' || command === 'loginConnection') {
			vscode.postMessage({ command });
		} else if (command === 'answer' || command === 'openHint') {
			vscode.postMessage({ command, hintId: button.dataset.hintId });
		} else if (command === 'like') {
			vscode.postMessage({
				command: button.closest('#oj-editorial') ? 'editorialLike' : command,
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
		} else if (command === 'deletePreviousStatement') {
			vscode.postMessage({ command, versionIndex: Number(button.dataset.versionIndex) });
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
		autoExpandKeys: Map<string, string>;
		autoCollapseKeys: Map<string, string>;
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
		const autoExpandKeys = new Map<string, string>();
		const autoCollapseKeys = new Map<string, string>();
		section.querySelectorAll('details').forEach((details, index) => {
			const key = details.getAttribute('data-persist-key') ?? String(index);
			allDetailKeys.push(key);
			autoExpandKeys.set(key, details.dataset.autoExpandKey ?? '');
			autoCollapseKeys.set(key, details.dataset.autoCollapseKey ?? '');
			if (details.open) {
				openDetails.push(key);
			}
		});
		return { values, openDetails, allDetailKeys, autoExpandKeys, autoCollapseKeys, focusedName, selectionStart };
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
			const expansion = details.dataset.autoExpandKey;
			const collapse = details.dataset.autoCollapseKey;
			if (collapse && collapse !== snapshot.autoCollapseKeys.get(key)) {
				details.open = false;
			} else if (expansion && expansion !== snapshot.autoExpandKeys.get(key)) {
				details.open = true;
			} else if (snapshot.allDetailKeys.includes(key)) {
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
		if (message.type === 'localTestSaved') {
			if (message.action === 'add') {
				const form = document.querySelector<HTMLDetailsElement>('.local-test-add');
				if (form && pendingNewTest) {
					const fields = readTestFields(form);
					if (fields.input === pendingNewTest.input && fields.output === pendingNewTest.output) {
						for (const field of form.querySelectorAll<HTMLTextAreaElement>('textarea')) { field.value = ''; }
						form.open = false;
					}
				}
				pendingNewTest = undefined;
			} else {
				for (const field of document.querySelectorAll<HTMLDetailsElement>(`.local-test[data-test-id="${message.id}"] .local-test-value`)) { field.open = false; }
			}
			return;
		}
		if (message.type === 'sourceChanged') {
			body.dataset.sourcePath = message.sourcePath;
			vscode.setState({ problemRef: message.problemRef, sourcePath: message.sourcePath });
			return;
		}
		if (message.type === 'confirm') {
			return; // handled by the dedicated handler above
		}
		if (message.type === 'focusTab') {
			setActiveTab(message.tabId);
			return;
		}
		if (message.type === 'expandHint') {
			for (const hint of document.querySelectorAll<HTMLDetailsElement>('details[data-hint-id]')) {
				if (hint.dataset.hintId === message.hintId) { hint.open = true; }
			}
			return;
		}
		if (message.type !== 'update') {
			return;
		}
		if (message.connected !== undefined) {
			body.dataset.connected = String(message.connected);
		}
		const hasCountdownUpdate = Object.keys(message.sections).some(id => id === 'oj-hints' || id === 'oj-editorial');
		// Replacing the statement also replaces its nested tests. Preserve drafts
		// before either section changes, then restore them into the final test DOM.
		const oldLocalTests = message.sections['oj-statement-content'] !== undefined ? document.getElementById('oj-local-tests') : null;
		const localDraft = oldLocalTests ? snapshotSection(oldLocalTests) : undefined;
		for (const [id, html] of Object.entries(message.sections)) {
			const section = document.getElementById(id);
			if (!section) {
				continue;
			}
			if (id === 'oj-connection-gate') {
				section.innerHTML = html;
				continue;
			}
			if (id === 'oj-operation-notice') {
				updateOperationNotice(section, html);
				continue;
			}
			if (id === 'oj-rating-prompt') { rememberRatingFocus(); }
			const snapshot = snapshotSection(section);
			const submissionHeights = id === 'oj-submissions' ? snapshotSubmissionHeights(section) : undefined;
			const updateSection = () => {
				section.innerHTML = html;
				restoreSection(section, snapshot);
			};
			if (id === 'oj-local-tests' || id === 'oj-local-tests-toolbar' || id === 'oj-hints' || id === 'oj-editorial' || id === 'oj-rating' || id === 'oj-rating-prompt') {
				// These sections update in response to actions without replaying a height animation.
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
		const updatedLocalTests = localDraft ? document.getElementById('oj-local-tests') : null;
		if (localDraft && updatedLocalTests) { restoreSection(updatedLocalTests, localDraft); }
		syncRatingDialog();
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
	syncRatingDialog();

	vscode.postMessage({ command: 'ready' });
})();

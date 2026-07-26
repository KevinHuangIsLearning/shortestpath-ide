import debounce from 'lodash/debounce';
import throttle from 'lodash/throttle';
import { updateDecorationsForUri } from 'src/decorations';
import { $state } from 'src/extension';
import { extUtils } from 'src/utils/extUtils';
import { languages, window, type Diagnostic, type DiagnosticChangeEvent, type Uri } from 'vscode';

type CachedDiagnostic = Record<string, Record<string, Diagnostic>>;

export class CustomDelay {
	/**
	 * Saved diagnostics for each Uri.
	 */
	private cachedDiagnostics: CachedDiagnostic = {};
	/**
	 * Do not update more often than once in 300ms to avoid flickering.
	 */
	private readonly updateDecorationsThrottled: (uri: Uri)=> void;
	/**
	 * Function that uses user delay setting `errorLens.delay` to debounce rendering of NEW problems.
	 */
	private readonly updateDecorationsDebounced: (uri: Uri)=> void;

	/**
	 * Try to add delay to new decorations.
	 * But old fixed errors should be removed immediately.
	 */
	constructor(delayMs: number) {
		this.updateDecorationsThrottled = throttle(this.updateDecorations, 300, {
			leading: true,
			trailing: true,
		});
		this.updateDecorationsDebounced = debounce(this.updateDecorationsThrottled, delayMs, {
			leading: false,
			trailing: true,
		});
	}

	public onDiagnosticChange = (event: DiagnosticChangeEvent): void => {
		if (!event.uris.length) {
			this.cachedDiagnostics = {};
			return;
		}
		for (const uri of event.uris) {
			this.updateCachedDiagnosticForUri(uri);
		}
	};

	private readonly updateCachedDiagnosticForUri = (uri: Uri): void => {
		const stringUri = uri.toString();
		const diagnosticForUri = languages.getDiagnostics(uri);
		const cachedDiagnosticsForUri = this.cachedDiagnostics[stringUri];
		const transformed: CachedDiagnostic = {
			[stringUri]: {},
		};
		for (const diagnostic of diagnosticForUri) {
			if (transformed[stringUri]) {
				transformed[stringUri][this.convertDiagnosticToId(diagnostic)] = diagnostic;
			}
		}
		if (cachedDiagnosticsForUri) {
			const transformedDiagnosticForUri = transformed[stringUri];
			const cachedKeys = Object.keys(cachedDiagnosticsForUri);
			const transformedKeys = Object.keys(transformedDiagnosticForUri);

			for (const key of cachedKeys) {
				if (!transformedKeys.includes(key)) {
					// Fixed old problem => remove it fast => do throttle
					this.updateDecorationsThrottled(uri);
					return;
				}
			}

			for (const key of transformedKeys) {
				if (!cachedKeys.includes(key)) {
					// Created new problem => Use delay => do debounce
					this.updateDecorationsDebounced(uri);
					return;
				}
			}
		} else {
			// If there's no uri saved - save it and render all diagnostics
			this.cachedDiagnostics[stringUri] = transformed[stringUri];
			this.updateDecorationsThrottled(uri);
		}
	};

	private readonly updateDecorations = (uri: Uri): void => {
		const stringUri = uri.toString();
		const diagnostics = languages.getDiagnostics(uri);
		const groupedDiagnostics = extUtils.groupDiagnosticsByLine(diagnostics);

		this.cachedDiagnostics[stringUri] = {};
		for (const diag of diagnostics) {
			this.cachedDiagnostics[stringUri][this.convertDiagnosticToId(diag)] = diag;
		}

		for (const editor of window.visibleTextEditors) {
			if (editor.document.uri.toString(true) === uri.toString(true)) {
				$state.log('CustomDelay => updateDecorations()');
				updateDecorationsForUri({
					uri,
					editor,
					groupedDiagnostics,
				});
			}
		}

		$state.statusBarIcons.updateText();
	};

	/**
	 * Make id from diagnostic:
	 *
	 * ```js
	 * "1_Missing semicolon"
	 * ```
	 */
	private convertDiagnosticToId(diagnostic: Diagnostic): string {
		return `${diagnostic.range.start.line}_${diagnostic.message}`;
	}
}

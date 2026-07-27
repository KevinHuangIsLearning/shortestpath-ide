import { CommandId } from 'src/commands';
import { $config } from 'src/extension';
import { createHoverForDiagnostic } from 'src/hover/hover';
import { type ExtensionConfig } from 'src/types';
import { extUtils, type GroupedByLineDiagnostics } from 'src/utils/extUtils';
import { utils } from 'src/utils/utils';
import { Location, StatusBarAlignment, window, type Diagnostic, type MarkdownString, type StatusBarItem, type TextEditor, type ThemeColor } from 'vscode';

interface StatusBarMessageInit {
	isEnabled: boolean;
	colorsEnabled: boolean;
	messageType: ExtensionConfig['statusBarMessageType'];
	priority: ExtensionConfig['statusBarMessagePriority'];
	alignment: ExtensionConfig['statusBarMessageAlignment'];
}

/**
 * Handle status bar updates.
 */
export class StatusBarMessage {
	/**
	 * Array of vscode `ThemeColor` for each of 4 diagnostic severity states.
	 */
	public statusBarColors: ThemeColor[] = [];
	/**
	 * Position in editor of active message. Needed to jump to error on click.
	 */
	public activeMessageLocation?: Location;
	/**
	 * Active message text. Needed to copy to clipboard on click.
	 */
	public activeMessageText = '';
	/**
	 * Active message source. Needed to copy to clipboard on click.
	 */
	public activeMessageSource?: string = '';
	/**
	 * Status bar item reference.
	 */
	private readonly statusBarItem: StatusBarItem;
	private readonly isEnabled: boolean;
	private readonly colorsEnabled: boolean;
	private readonly messageType: ExtensionConfig['statusBarMessageType'];

	constructor(
		{
			isEnabled,
			colorsEnabled,
			messageType,
			priority,
			alignment,
		}: StatusBarMessageInit,
	) {
		const statusBarAlignment = alignment === 'right' ? StatusBarAlignment.Right : StatusBarAlignment.Left;
		this.isEnabled = isEnabled;
		this.colorsEnabled = colorsEnabled;
		this.messageType = messageType;

		this.statusBarItem = window.createStatusBarItem('errorLensMessage', statusBarAlignment, priority);
		this.statusBarItem.name = 'Error Lens: Message';
		this.statusBarItem.command = CommandId.StatusBarCommand;
		if (this.isEnabled) {
			this.statusBarItem.show();
		} else {
			this.dispose();
		}
	}

	public updateText(editor: TextEditor, groupedDiagnostics: GroupedByLineDiagnostics): void {
		if (!this.isEnabled) {
			return;
		}
		const keys = Object.keys(groupedDiagnostics);
		if (keys.length === 0) {
			this.clear();
			return;
		}

		const ln = editor.selection.active.line;
		let diagnostic: Diagnostic | undefined;
		let numberOfDiagnosticsOnThatLine = 0;

		if (this.messageType === 'activeLine') {
			if (groupedDiagnostics[ln]) {
				diagnostic = groupedDiagnostics[ln][0];
				numberOfDiagnosticsOnThatLine = groupedDiagnostics[ln].length;
			} else {
				this.clear();
				return;
			}
		} else if (this.messageType === 'activeCursor') {
			if (groupedDiagnostics[ln]) {
				const sortedInlinDiagnostics = groupedDiagnostics[ln].sort((diag1, diag2) => {
					const distanceCharToCursor1 = this.distanceInCharachtersToCursor(diag1);
					const distanceCharToCursor2 = this.distanceInCharachtersToCursor(diag2);

					if (distanceCharToCursor1 === distanceCharToCursor2) {
						return diag1.severity - diag2.severity;
					} else {
						return distanceCharToCursor1 - distanceCharToCursor2;
					}
				});
				diagnostic = sortedInlinDiagnostics[0];
			}
		} else if (this.messageType === 'closestProblem') {
			// Sort by how close it is to the cursor
			const sortedLineNumbers = keys.map(Number).sort((a, b) => Math.abs(ln - a) - Math.abs(ln - b));// TODO: duplicate code?
			outerLoop:
			for (const lineNumber of sortedLineNumbers) {
				const diagnosticsAtLine = groupedDiagnostics[lineNumber];
				for (const diag of diagnosticsAtLine) {
					if (extUtils.isSeverityEnabled(diag.severity)) {
						diagnostic = diag;
						numberOfDiagnosticsOnThatLine = diagnosticsAtLine.length;
						break outerLoop;
					}
				}
			}
		} else if (this.messageType === 'closestSeverity') {
			const allDiagnosticsSorted = keys.map(key => groupedDiagnostics[key]).flat().sort((d1, d2) => {
				const severityScore = (d1.severity * 1e4) - (d2.severity * 1e4);
				return severityScore + (Math.abs(ln - d1.range.start.line) - Math.abs(ln - d2.range.start.line));
			});
			for (const diag of allDiagnosticsSorted) {
				if (extUtils.isSeverityEnabled(diag.severity)) {
					diagnostic = diag;
					numberOfDiagnosticsOnThatLine = groupedDiagnostics[diag.range.start.line].length;
					break;
				}
			}
		}

		if (!diagnostic) {
			this.clear();
			return;
		}

		this.activeMessageLocation = new Location(editor.document.uri, diagnostic.range.start);

		let message = extUtils.diagnosticToInlineMessage(
			$config.statusBarMessageTemplate || $config.messageTemplate,
			diagnostic,
			numberOfDiagnosticsOnThatLine,
		);

		if ($config.removeLinebreaks) {
			message = utils.replaceLinebreaks(message, $config.replaceLinebreaksSymbol);
		}

		this.activeMessageText = message;
		this.activeMessageSource = diagnostic.source;

		if (this.colorsEnabled) {
			this.statusBarItem.color = this.statusBarColors[diagnostic.severity];
		}

		this.statusBarItem.text = message;
		this.statusBarItem.tooltip = this.makeTooltip(diagnostic, $config.lintFilePaths);
	}

	/**
	 * Clear status bar message.
	 */
	public clear(): void {
		if (!this.isEnabled) {
			return;
		}
		this.statusBarItem.text = '';
		this.statusBarItem.tooltip = '';
	}

	distanceInCharachtersToCursor(diagnostic: Diagnostic): number {
		const activeSelection = window.activeTextEditor?.selection.active;
		if (!activeSelection) {
			return 0;
		}
		if (diagnostic.range.contains(activeSelection)) {
			return 0;
		}
		return Math.min(
			Math.abs(diagnostic.range.start.character - activeSelection.character),
			Math.abs(diagnostic.range.end.character - activeSelection.character),
		);
	}

	/**
	 * Dispose status bar item.
	 */
	public dispose(): void {
		this.statusBarItem.dispose();
	}

	private makeTooltip(diagnostic: Diagnostic, lintFilePaths: ExtensionConfig['lintFilePaths']): MarkdownString | undefined {
		const markdownHover = createHoverForDiagnostic({
			diagnostic,
			buttonsEnabled: true,
			messageEnabled: true,
			sourceCodeEnabled: true,
			lintFilePaths,
		});

		return markdownHover;
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function shouldRestoreProblemPanel(
	disposedSourcePath: string | undefined,
	currentSourcePath: string | undefined,
	panelExists: boolean,
	openFilePaths: readonly string[],
): boolean {
	return disposedSourcePath !== undefined
		&& currentSourcePath === disposedSourcePath
		&& !panelExists
		&& openFilePaths.includes(disposedSourcePath);
}

export function shouldRestoreProblemPanelAfterEditorial(
	hiddenSourcePath: string | undefined,
	currentSourcePath: string | undefined,
	panelExists: boolean,
	openFilePaths: readonly string[],
): boolean {
	return hiddenSourcePath === undefined || shouldRestoreProblemPanel(
		hiddenSourcePath,
		currentSourcePath,
		panelExists,
		openFilePaths,
	);
}

export function shouldHideProblemPanelWhenSourceInactive(
	sourcePath: string | undefined,
	activeSourcePath: string | undefined,
): boolean {
	return sourcePath !== undefined && activeSourcePath !== undefined && sourcePath !== activeSourcePath;
}

export function shouldHideProblemPanelWhenSourceCloses(
	sourcePath: string | undefined,
	openFilePaths: readonly string[],
): boolean {
	return sourcePath !== undefined && !openFilePaths.includes(sourcePath);
}

export interface OpenFileTabGroup {
	viewColumn: number;
	filePaths: readonly string[];
}

export function findOpenFileViewColumn(
	filePath: string,
	groups: readonly OpenFileTabGroup[],
): number | undefined {
	return groups.find(group => group.filePaths.includes(filePath))?.viewColumn;
}

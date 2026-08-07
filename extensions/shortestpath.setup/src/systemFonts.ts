/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';

export type SystemFontsResult = {
	fonts: string[];
	error?: string;
};

let cachedSystemFonts: SystemFontsResult | undefined;

export async function getSystemFonts(): Promise<SystemFontsResult> {
	if (cachedSystemFonts) {
		return cachedSystemFonts;
	}
	try {
		if (process.platform === 'darwin') {
			// system_profiler SPFontsDataType -json is very slow (several seconds),
			// so use CoreText via osascript JXA first and fall back to system_profiler.
			try {
				const output = await runFontCommand('osascript', ['-l', 'JavaScript', '-e', 'ObjC.import(\'AppKit\'); const f = $.NSFontManager.sharedFontManager.availableFontFamilies; const out = []; for (let i = 0; i < f.count; i++) out.push(ObjC.unwrap(f.objectAtIndex(i))); out.join(\'\\n\');']);
				if (output.trim()) {
					return cachedSystemFonts = { fonts: uniqueFonts(output.split(/\r?\n/)) };
				}
			} catch {
				// fall through to system_profiler
			}
			const output = await runFontCommand('system_profiler', ['SPFontsDataType', '-json']);
			return cachedSystemFonts = { fonts: uniqueFonts(getMacFontFamilies(output)) };
		}
		if (process.platform === 'win32') {
			const output = await runFontCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object Name']);
			return cachedSystemFonts = { fonts: uniqueFonts(output.split(/\r?\n/)) };
		}
		const output = await runFontCommand('fc-list', ['--format=%{family}\\n']);
		return cachedSystemFonts = { fonts: uniqueFonts(output.split(/[,\r\n]+/)) };
	} catch {
		return { fonts: [], error: '未能读取系统字体。请检查系统字体服务后重新打开此页面。' };
	}
}

function runFontCommand(executable: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => execFile(executable, args, { timeout: 15_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(stdout)));
}

function getMacFontFamilies(output: string): string[] {
	try {
		const data = JSON.parse(output) as { SPFontsDataType?: { typefaces?: { family?: unknown }[] }[] };
		return data.SPFontsDataType?.flatMap(font => font.typefaces?.map(typeface => typeof typeface.family === 'string' ? typeface.family : '') ?? []) ?? [];
	} catch {
		return [];
	}
}

function uniqueFonts(fonts: readonly string[]): string[] {
	return [...new Set(fonts.map(font => font.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

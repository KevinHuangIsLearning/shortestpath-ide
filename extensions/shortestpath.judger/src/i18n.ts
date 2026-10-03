import * as nls from 'vscode-nls';
import * as vscode from 'vscode';
import { nativeChinese } from './nativeTranslations';

const fallback = nls.config({ messageFormat: nls.MessageFormat.file })();

export default function localize(key: string, message: string, ...args: (string | number | boolean | undefined | null)[]): string {
	const translated = vscode.env?.language?.toLowerCase().startsWith('zh') ? nativeChinese[key] : undefined;
	return translated ? translated.replace(/\{(\d+)\}/g, (token, index: string) => Number(index) < args.length ? String(args[Number(index)]) : token) : fallback(key, message, ...args);
}

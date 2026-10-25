// Pure javascript utilities, that don't use VS Code API.
// They can still use VS Code type definitions.

/** Decode Unicode paths without allowing control characters from either protocol. */
export function decodeShortestPathSourcePath(encoded: string | string[] | undefined, legacy: string | string[] | undefined): string | undefined {
    try {
        const value = typeof encoded === 'string' ? decodeURIComponent(encoded) : typeof legacy === 'string' ? legacy : undefined;
        return value && !/[\u0000-\u001F\u007F-\u009F]/.test(value) ? value : undefined;
    } catch {
        return undefined;
    }
}

export const words_in_text = function (text: string, wordRegex: string) {
    const regex = new RegExp(wordRegex, 'gu');
    return text.match(regex);
};

/**
 * Converts a string with underscores to PascalCase.
 * Example: "two_sum" -> "TwoSum", "hello_world_123" -> "HelloWorld123"
 * If the result starts with a digit, prefixes with "Problem" (Java class names can't start with numbers).
 * @param input The input string with underscores.
 * @returns PascalCase string without underscores, valid as a Java class name.
 */
export const toPascalCase = (input: string): string => {
    const result = input
        .split('_')
        .map((word) => {
            if (word.length === 0) return '';
            // Check if the word is all digits - keep as is
            if (/^\d+$/.test(word)) return word;
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join('');

    // Java class names cannot start with a number
    if (/^\d/.test(result)) {
        return 'Problem' + result;
    }

    return result;
};

/**
 * Converts a string to an ASCII-safe filename.
 * Non-ASCII characters are replaced with their Unicode code point in hexadecimal format.
 * @param input The input string to convert.
 * @returns An ASCII-safe filename.
 */
export const toAsciiFilename = (input: string): string => {
    return Array.from(input)
        .map((char) => {
            const code = char.charCodeAt(0);
            return code < 128
                ? char
                : `_u${code.toString(16).padStart(4, '0')}`;
        })
        .join('');
};

export type TemplateCursorPlaceholder = {
    /** Offset of the cursor position in the original template. */
    index: number;
    /** Token ranges that must be removed from the created source file. */
    ranges: readonly { index: number; length: number }[];
};

const legacyCursorPlaceholder = '$CURSOR_PLACEHOLDER';

/**
 * Finds the cursor placeholder in a code template. The legacy
 * `$CURSOR_PLACEHOLDER` token wins when both forms are present; otherwise the
 * standard snippet final tabstop (`$0` or `${0}`) is used. Every `$0`/`${0}`
 * occurrence is returned so none is left in the created source file.
 * `$0` parsing can be disabled for existing source files, where a literal `$0`
 * may be part of the user's code.
 */
export function findTemplateCursorPlaceholder(text: string, includeSnippetFinalTabstop = true): TemplateCursorPlaceholder | undefined {
    const legacyIndex = text.indexOf(legacyCursorPlaceholder);
    if (legacyIndex !== -1) {
        return { index: legacyIndex, ranges: [{ index: legacyIndex, length: legacyCursorPlaceholder.length }] };
    }
    if (!includeSnippetFinalTabstop) {
        return undefined;
    }

    const pattern = /\$(?:0(?!\d)|\{0\})/g;
    const ranges: { index: number; length: number }[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
        ranges.push({ index: match.index, length: match[0].length });
    }
    return ranges.length ? { index: ranges[0].index, ranges } : undefined;
}

/**
 * Replaces placeholders in a filename template string with actual values.
 * Placeholders are in the format {key} and are replaced from the provided map.
 * Unknown placeholders are left as-is.
 * @param template The filename template string.
 * @param replacements A map of placeholder keys to their replacement values.
 * @returns The template string with all known placeholders replaced.
 */
export const replaceFileNamePlaceholders = (
    template: string,
    replacements: Record<string, string>,
): string => {
    let result = template;
    for (const [key, value] of Object.entries(replacements)) {
        const placeholder = `{${key}}`;
        if (result.includes(placeholder)) {
            result = result.split(placeholder).join(value);
        }
    }
    return result;
};

/**
 * Sanitizes a filename generated from a template with empty placeholders.
 * Cleans up empty directory segments, leading/trailing slashes, and
 * consecutive underscores.
 */
export const sanitizeFileName = (filename: string): string => {
    return filename
        .replace(/\{[^}]*$/g, '')
        .replace(/\{[^}]*\}/g, '')
        .replace(/\/+/g, '/')
        .replace(/_+/g, '_')
        .replace(/(^|\/)_/g, '$1')
        .replace(/(^|\/)_/g, '$1')
        .replace(/^\.\//, '')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
};

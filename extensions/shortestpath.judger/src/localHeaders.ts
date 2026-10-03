/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger. Licensed under GPL-3.0-or-later.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import path from 'path';

/** Expand only quoted project includes; retain system and unresolved includes. */
export function expandLocalHeaders(sourcePath: string, source = fs.readFileSync(sourcePath, 'utf8')): string {
    const stack = new Set<string>();
    const expand = (file: string, text: string): string => {
        const canonical = fs.realpathSync(file);
        if (stack.has(canonical)) { return ''; }
        stack.add(canonical);
        try {
            return text.replace(/^([ \t]*)#[ \t]*include[ \t]+"([^"\r\n]+)"[^\r\n]*$/gm, (line, _indent, name: string) => {
                let directory = path.dirname(file);
                let resolved: string | undefined;
                for (;;) {
                    const candidate = path.resolve(directory, name);
                    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) { resolved = candidate; break; }
                    const parent = path.dirname(directory);
                    if (parent === directory || name.startsWith('.')) { break; }
                    directory = parent;
                }
                if (!resolved) { return line; }
                const raw = fs.readFileSync(resolved, 'utf8');
                const content = expand(resolved, raw).replace(/^\s*#\s*pragma\s+once\s*$/gm, '');
                // A generated include guard preserves pragma-once semantics after flattening.
                const guard = 'SHORTESTPATH_HEADER_' + Buffer.from(fs.realpathSync(resolved)).toString('hex').toUpperCase();
                return /^\s*#\s*pragma\s+once\s*$/m.test(raw) ? `#ifndef ${guard}\n#define ${guard}\n${content}\n#endif` : content;
            });
        } finally { stack.delete(canonical); }
    };
    return expand(sourcePath, source);
}

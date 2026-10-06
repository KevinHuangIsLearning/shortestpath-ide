/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readdirSync, rmSync } from 'fs';
import path from 'path';

/** Remove the output owned by a compilation, including macOS debug symbols. */
export function deleteCompiledOutput(binPath: string): void {
    const outputs = path.basename(binPath) === '*.class'
        ? [binPath]
        : [binPath, `${binPath}.dSYM`];
    for (const output of outputs) {
        try {
            if (path.basename(output) === '*.class') {
                for (const name of readdirSync(path.dirname(output))) {
                    if (name.endsWith('.class')) { rmSync(path.join(path.dirname(output), name), { force: true }); }
                }
            } else {
                rmSync(output, { recursive: true, force: true });
            }
        } catch (err) {
            globalThis.logger.error('Error while deleting compiled output', output, err);
        }
    }
}

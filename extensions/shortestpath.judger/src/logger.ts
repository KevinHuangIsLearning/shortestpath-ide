/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/

/************************************************************************************/
globalThis.storedLogs = '';
function customLogger(
    originalMethod: (...args: any[]) => void,
    ...args: any[]
) {
    originalMethod(...args);

    globalThis.storedLogs += new Date().toISOString() + ' ';
    globalThis.storedLogs +=
        args
            .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : arg))
            .join(' ') + '\n';
}

globalThis.logger = {};
globalThis.logger.log = (...args: any[]) => customLogger(console.log, ...args);
globalThis.logger.error = (...args: any[]) =>
    customLogger(console.error, ...args);
globalThis.logger.warn = (...args: any[]) =>
    customLogger(console.warn, ...args);
globalThis.logger.info = (...args: any[]) =>
    customLogger(console.info, ...args);
globalThis.logger.debug = (...args: any[]) =>
    customLogger(console.debug, ...args);
/************************************************************************************/

export {};

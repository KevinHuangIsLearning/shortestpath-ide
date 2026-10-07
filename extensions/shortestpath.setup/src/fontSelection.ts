/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Shared browser-side font detection for setup webviews. */
export const codeFontDetectionScript = `
const serializeFont = font => font === 'monospace' ? font : JSON.stringify(font);
function codeFontPriority(font) {
  const family = font.toLowerCase();
  if (family === 'fira code') return 0;
  if (family.startsWith('fira code ')) return 1;
  if (family === 'dejavu sans mono') return 2;
  if (family.startsWith('dejavu')) return 3;
  return 4;
}
function isMonospaceFont(font, context) { context.font = '16px ' + serializeFont(font); return Math.abs(context.measureText('iiiiiiiiii').width - context.measureText('WWWWWWWWWW').width) < 0.01; }
async function getMonospaceFonts(fonts) {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return [];
  const result = [];
  const batchSize = 40;
  for (let index = 0; index < fonts.length; index += batchSize) {
    fonts.slice(index, index + batchSize).forEach(font => { if (isMonospaceFont(font, context)) result.push(font); });
    if (index + batchSize < fonts.length) {
      await new Promise(resolve => {
        const schedule = globalThis.requestAnimationFrame ?? (callback => setTimeout(callback, 0));
        schedule(resolve);
      });
    }
  }
  return result;
}
`;

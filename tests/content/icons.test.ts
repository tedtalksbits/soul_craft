import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { iconNames, ICON_SHEETS, packSheet, sheetPath } from '../../scripts/lib/icon-sheets';
import { content } from '../helpers';

describe('icon sheets', () => {
  it.each(ICON_SHEETS)('%s is packed from its loose PNGs (run pnpm icons after changing one)', (sheet) => {
    const packed = packSheet(sheet);
    expect(packed.problems).toEqual([]);
    const json = JSON.parse(readFileSync(sheetPath(sheet, 'json'), 'utf8')) as unknown;
    expect(json).toEqual(packed.json);
    const png = PNG.sync.read(readFileSync(sheetPath(sheet, 'png')));
    expect([png.width, png.height]).toEqual([packed.png.width, packed.png.height]);
    expect(png.data.equals(packed.png.data)).toBe(true);
  });

  it.each(ICON_SHEETS)('%s has an icon for every name the game requires', (sheet) => {
    const frames = Object.keys(packSheet(sheet).json.frames);
    const missing = (iconNames(content, sheet)?.required ?? []).filter((n) => !frames.includes(n));
    expect(missing).toEqual([]);
  });
});

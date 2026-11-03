/**
 * The icon sheets, packed from loose PNGs (docs/icons.md): `assets/sprites/source/icons/<sheet>/<name>.png` holds
 * one icon each, and `pnpm icons` packs every folder into `assets/sprites/<sheet>.png` + `.json`. The loose files
 * are the source of truth, so swapping an icon is replacing one file.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { PNG } from 'pngjs';
import type { Content } from '../../src/content/content';
import { ROOT } from './load-content';

export const ICON_SHEETS = ['ui_icons', 'items', 'sigils', 'abilities'] as const;
export type IconSheet = (typeof ICON_SHEETS)[number];

export const ICON_SIZE = 16;
const COLUMNS = 8;
const NAME = /^[a-z0-9_]+$/;
/** Where each sheet's sprites stand on their point: menus center glyphs; items, sigils and abilities sit on it. */
const ANCHOR: Readonly<Record<IconSheet, readonly [number, number]>> = {
  ui_icons: [0.5, 0.5],
  items: [0.5, 1],
  sigils: [0.5, 1],
  abilities: [0.5, 1],
};

export const sourceDir = (sheet: IconSheet) => join(ROOT, 'assets', 'sprites', 'source', 'icons', sheet);
export const sheetPath = (sheet: IconSheet, ext: 'png' | 'json') =>
  join(ROOT, 'assets', 'sprites', `${sheet}.${ext}`);

export interface PackedSheet {
  png: PNG;
  json: {
    image: string;
    frameWidth: number;
    frameHeight: number;
    anchor: readonly [number, number];
    frames: Record<string, number>;
    animations: Record<string, never>;
  };
  /** Files that could not be packed, and why. */
  problems: string[];
}

/**
 * What the game looks up on a sheet: `required` names must have an icon; `known` are all the names it can use (an
 * ability variant without an icon of its own shows its base's). Null for `ui_icons`, which the client names in code.
 */
export function iconNames(
  content: Content,
  sheet: IconSheet,
): { required: string[]; known: string[] } | null {
  switch (sheet) {
    case 'items': {
      const icons = [...new Set(Object.values(content.items).map((d) => d.icon))].sort();
      return { required: icons, known: icons };
    }
    case 'sigils': {
      const classes = Object.keys(content.classes).sort();
      return { required: classes, known: classes };
    }
    case 'abilities': {
      const all = Object.keys(content.abilities).sort();
      return { required: all.filter((id) => content.baseAbility(id) === id), known: all };
    }
    case 'ui_icons':
      return null;
  }
}

/**
 * Packs a sheet's folder: icons in the order the current sheet lists them (so a swapped icon keeps its cell), new
 * names after them alphabetically, eight to a row.
 */
export function packSheet(sheet: IconSheet): PackedSheet {
  const dir = sourceDir(sheet);
  const problems: string[] = [];
  const icons = new Map<string, PNG>();
  for (const file of existsSync(dir) ? readdirSync(dir).sort() : []) {
    if (!file.endsWith('.png')) continue;
    const name = basename(file, '.png');
    if (!NAME.test(name)) {
      problems.push(`${file}: names are lowercase letters, digits and _ only`);
      continue;
    }
    const png = PNG.sync.read(readFileSync(join(dir, file)));
    if (png.width !== ICON_SIZE || png.height !== ICON_SIZE) {
      problems.push(`${file}: is ${png.width}×${png.height}, icons are ${ICON_SIZE}×${ICON_SIZE}`);
      continue;
    }
    icons.set(name, png);
  }
  const before = currentOrder(sheet);
  const names = [
    ...before.filter((n) => icons.has(n)),
    ...[...icons.keys()].filter((n) => !before.includes(n)).sort(),
  ];
  const rows = Math.max(1, Math.ceil(names.length / COLUMNS));
  const out = new PNG({ width: COLUMNS * ICON_SIZE, height: rows * ICON_SIZE });
  out.data.fill(0);
  const frames: Record<string, number> = {};
  names.forEach((name, i) => {
    frames[name] = i;
    PNG.bitblt(
      icons.get(name)!,
      out,
      0,
      0,
      ICON_SIZE,
      ICON_SIZE,
      (i % COLUMNS) * ICON_SIZE,
      Math.floor(i / COLUMNS) * ICON_SIZE,
    );
  });
  return {
    png: out,
    json: {
      image: `${sheet}.png`,
      frameWidth: ICON_SIZE,
      frameHeight: ICON_SIZE,
      anchor: ANCHOR[sheet],
      frames,
      animations: {},
    },
    problems,
  };
}

/** The icon names in the committed sheet's order. */
function currentOrder(sheet: IconSheet): string[] {
  const file = sheetPath(sheet, 'json');
  if (!existsSync(file)) return [];
  const json = JSON.parse(readFileSync(file, 'utf8')) as { frames?: Record<string, number> };
  return Object.entries(json.frames ?? {})
    .sort(([, a], [, b]) => a - b)
    .map(([name]) => name);
}

/**
 * `pnpm assets:placeholders [--force] [name...]`
 *
 * Writes programmatic placeholder sprite sheets (PNG + JSON) to
 * assets/sprites. Existing files are left alone unless --force is given, so
 * hand-edited art is never overwritten by accident. Pass sheet names to limit
 * which ones are (re)generated.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import type { SpriteSheetFile } from '../../src/content/sprite-sheet';
import { ROOT } from '../lib/load-content';
import { buildCharacter } from './characters';
import { buildFont, buildProps, buildSlime } from './misc';
import { buildTiles } from './tiles';

const OUT = join(ROOT, 'assets', 'sprites');

/** Sheets that still use placeholder art. Real art moves out of here (`pnpm art ashen_one`, `hollow`, `archer`). */
const SHEETS: Record<string, () => { png: Buffer; json: SpriteSheetFile }> = {
  tiles: buildTiles,
  knight: () => buildCharacter('knight'),
  slime: buildSlime,
  props: buildProps,
  font: buildFont,
};

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));
for (const name of only)
  if (!(name in SHEETS)) throw new Error(`Unknown sheet "${name}". Known: ${Object.keys(SHEETS).join(', ')}`);

mkdirSync(OUT, { recursive: true });
for (const [name, build] of Object.entries(SHEETS)) {
  if (only.length > 0 && !only.includes(name)) continue;
  const pngPath = join(OUT, `${name}.png`);
  const jsonPath = join(OUT, `${name}.json`);
  if (!force && (existsSync(pngPath) || existsSync(jsonPath))) {
    console.log(`skip   ${name} (exists; use --force to overwrite)`);
    continue;
  }
  const { png, json } = build();
  writeFileSync(pngPath, png);
  const options = await resolveConfig(jsonPath);
  writeFileSync(
    jsonPath,
    await format(JSON.stringify(json), { ...options, parser: 'json', filepath: jsonPath }),
  );
  console.log(`wrote  ${name}.png + ${name}.json`);
}

/**
 * `pnpm icons`: packs the loose icon PNGs in `assets/sprites/source/icons/<sheet>/` into the icon sheets, then
 * reports what the game looks up but no file provides, and files nothing looks up. `pnpm dev` picks the sheets
 * up as soon as they are written.
 */
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { format, resolveConfig } from 'prettier';
import { iconNames, ICON_SHEETS, packSheet, sheetPath } from './lib/icon-sheets';
import { loadContent } from './lib/load-content';

const content = loadContent();
let failed = false;
for (const sheet of ICON_SHEETS) {
  const packed = packSheet(sheet);
  writeFileSync(sheetPath(sheet, 'png'), PNG.sync.write(packed.png));
  const file = sheetPath(sheet, 'json');
  writeFileSync(
    file,
    await format(JSON.stringify(packed.json), { ...(await resolveConfig(file)), filepath: file }),
  );
  const names = Object.keys(packed.json.frames);
  const wanted = iconNames(content, sheet);
  const missing = wanted ? wanted.required.filter((n) => !names.includes(n)) : [];
  const unused = wanted ? names.filter((n) => !wanted.known.includes(n)) : [];
  console.log(`${sheet}: ${names.length} icons`);
  for (const p of packed.problems) console.log(`  skipped ${p}`);
  if (missing.length) console.log(`  missing (they show as empty cells): ${missing.join(', ')}`);
  if (unused.length) console.log(`  not used by the game (kept): ${unused.join(', ')}`);
  failed ||= packed.problems.length > 0 || missing.length > 0;
}
if (failed) process.exit(1);

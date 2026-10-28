/**
 * `pnpm content:format`: rewrites every content file in the canonical layout
 * the in-game editor writes, so editor saves produce minimal diffs.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { CONTENT_DIR, readContentFiles } from './lib/load-content';

for (const [path, data] of Object.entries(readContentFiles())) {
  const file = join(CONTENT_DIR, path);
  const options = await resolveConfig(file);
  const next = await format(JSON.stringify(data), { ...options, parser: 'json', filepath: file });
  if (next !== readFileSync(file, 'utf8')) {
    writeFileSync(file, next);
    console.log(`formatted content/${path}`);
  }
}

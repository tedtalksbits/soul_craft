/** Node-side content loading for tests and scripts. The browser uses Vite's glob import instead. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { buildContent, type Content, type ContentFiles } from '../../src/content/content';

export const ROOT = join(import.meta.dirname, '..', '..');
export const CONTENT_DIR = join(ROOT, 'content');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

export function readContentFiles(dir = CONTENT_DIR): ContentFiles {
  const files: Record<string, unknown> = {};
  for (const full of walk(dir)) {
    if (!full.endsWith('.json')) continue;
    files[relative(dir, full).split(sep).join('/')] = JSON.parse(readFileSync(full, 'utf8'));
  }
  return files;
}

export function loadContent(dir = CONTENT_DIR): Content {
  return buildContent(readContentFiles(dir));
}

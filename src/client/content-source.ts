import type { ContentFiles } from '../content/content';

/** Every content file, bundled at build time. Keys are relative to /content. */
const BUNDLED = import.meta.glob<unknown>('/content/**/*.json', { eager: true, import: 'default' });

export function bundledContentFiles(): ContentFiles {
  return Object.fromEntries(
    Object.entries(BUNDLED).map(([path, data]) => [path.replace(/^\/content\//, ''), data]),
  );
}

/** Re-reads one content file from the dev server, bypassing caches. */
export async function fetchContentFile(path: string): Promise<unknown> {
  const res = await fetch(`/content/${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`could not fetch content/${path}: ${res.status}`);
  return res.json();
}

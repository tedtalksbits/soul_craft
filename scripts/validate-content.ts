/** `pnpm content:validate`: checks every content file and cross-reference, exits non-zero on problems. */
import { ContentError } from '../src/content/content';
import { loadContent } from './lib/load-content';

try {
  const c = loadContent();
  console.log(
    `content OK: ${c.tiles.length} tiles, ${Object.keys(c.enemies).length} enemies, ` +
      `${Object.keys(c.biomes).length} biomes, ${Object.keys(c.prefabs).length} prefabs, ` +
      `${Object.keys(c.scenarios).length} scenarios`,
  );
} catch (err) {
  if (err instanceof ContentError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

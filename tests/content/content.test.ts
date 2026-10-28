import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildContent, ContentError } from '../../src/content/content';
import { SpriteSheetSchema } from '../../src/content/sprite-sheet';
import { readContentFiles, ROOT } from '../../scripts/lib/load-content';
import { content } from '../helpers';

const SPRITES = join(ROOT, 'assets', 'sprites');

describe('content files', () => {
  it('all validate and cross-reference', () => {
    expect(content.tiles.length).toBeGreaterThan(0);
  });

  it('reports every problem with its file', () => {
    const files = { ...readContentFiles() } as Record<string, unknown>;
    files['enemies.json'] = { ...(files['enemies.json'] as object), ghost: { name: 'Ghost' } };
    files['prefabs/broken.json'] = { legend: {}, rows: ['ab'] };
    files['typo.json'] = {};
    try {
      buildContent(files);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ContentError);
      const text = (err as ContentError).problems.join('\n');
      expect(text).toMatch(/enemies\.json: ghost\./);
      expect(text).toMatch(/prefabs\/broken\.json: .*"a" is not in the legend/);
      expect(text).toMatch(/typo\.json: not a recognised content file/);
    }
  });
});

describe('sprite sheets', () => {
  const sheets = readdirSync(SPRITES).filter((f) => f.endsWith('.json'));

  it.each(sheets)('%s is valid and has its image', (file) => {
    const def = SpriteSheetSchema.parse(JSON.parse(readFileSync(join(SPRITES, file), 'utf8')));
    expect(existsSync(join(SPRITES, def.image))).toBe(true);
  });

  it('every tile frame exists in the tiles sheet', () => {
    const tiles = SpriteSheetSchema.parse(JSON.parse(readFileSync(join(SPRITES, 'tiles.json'), 'utf8')));
    const missing = content.tiles.flatMap((t) =>
      t.frames.filter((f) => !(f in tiles.frames)).map((f) => `${t.id}:${f}`),
    );
    expect(missing).toEqual([]);
  });

  it('every sprite referenced by content has a sheet', () => {
    const names = [
      content.player.sprite,
      ...Object.values(content.enemies).map((e) => e.sprite),
      'props',
      'tiles',
      'font',
    ];
    for (const n of names) expect(existsSync(join(SPRITES, `${n}.json`)), n).toBe(true);
  });
});

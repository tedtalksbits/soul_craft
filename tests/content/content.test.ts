import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
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
      expect(text).toMatch(/typo\.json: not a recognized content file/);
    }
  });
});

describe('gear content', () => {
  it('rejects a perk pool too small for the best tier, and unknown perks and tables', () => {
    const files = { ...readContentFiles() } as Record<string, unknown>;
    const loot = files['loot.json'] as { perks: Record<string, unknown> };
    files['loot.json'] = { ...loot, perks: { damage: loot.perks['damage'] } };
    const enemies = files['enemies.json'] as Record<string, object>;
    files['enemies.json'] = {
      ...enemies,
      slime: { ...enemies['slime'], gear: { chance: 0.1, table: 'nope' } },
    };
    try {
      buildContent(files);
      expect.unreachable();
    } catch (err) {
      const text = (err as ContentError).problems.join('\n');
      expect(text).toMatch(/loot\.json: perks: only 1 can roll on a weapon/);
      expect(text).toMatch(/items\.json: ashen_hood\.innate: unknown perk "abilityDamage"/);
      expect(text).toMatch(/enemies\.json: slime\.gear: unknown table "nope"/);
    }
  });
});

describe('perk content', () => {
  it('rejects a class perk for a class that does not exist, and a power naming an unknown ability', () => {
    const files = { ...readContentFiles() } as Record<string, unknown>;
    const loot = files['loot.json'] as { perks: Record<string, object> };
    files['loot.json'] = {
      ...loot,
      perks: { ...loot.perks, ambush: { ...loot.perks['ambush'], class: 'bard' } },
    };
    const items = files['items.json'] as Record<string, { power: { effect: object } }>;
    const brand = items['cinderbrand']!;
    files['items.json'] = {
      ...items,
      cinderbrand: {
        ...brand,
        power: { ...brand.power, effect: { ...brand.power.effect, ability: 'nope' } },
      },
    };
    try {
      buildContent(files);
      expect.unreachable();
    } catch (err) {
      const text = (err as ContentError).problems.join('\n');
      expect(text).toMatch(/loot\.json: perks\.ambush: unknown class "bard"/);
      expect(text).toMatch(/items\.json: cinderbrand\.power: unknown ability "nope"/);
    }
  });
});

describe('sprite sheets', () => {
  const sheets = readdirSync(SPRITES).filter((f) => f.endsWith('.json'));

  it.each(sheets)('%s is valid and has its image', (file) => {
    const def = SpriteSheetSchema.parse(JSON.parse(readFileSync(join(SPRITES, file), 'utf8')));
    expect(existsSync(join(SPRITES, def.image))).toBe(true);
  });

  it.each(sheets)('%s only references frames that exist in its image', (file) => {
    const def = SpriteSheetSchema.parse(JSON.parse(readFileSync(join(SPRITES, file), 'utf8')));
    const { width, height } = PNG.sync.read(readFileSync(join(SPRITES, def.image)));
    expect(width % def.frameWidth, 'image width is a whole number of frames').toBe(0);
    expect(height % def.frameHeight, 'image height is a whole number of frames').toBe(0);
    const count = (width / def.frameWidth) * (height / def.frameHeight);
    const refs = [
      ...Object.values(def.frames),
      ...Object.values(def.animations).flatMap((a) => a.frames.filter((f) => typeof f === 'number')),
    ];
    expect(refs.filter((i) => i >= count)).toEqual([]);
    const named = Object.values(def.animations).flatMap((a) => a.frames.filter((f) => typeof f === 'string'));
    expect(named.filter((n) => !(n in def.frames))).toEqual([]);
  });

  it('every item icon exists in the items sheet', () => {
    const items = SpriteSheetSchema.parse(JSON.parse(readFileSync(join(SPRITES, 'items.json'), 'utf8')));
    const missing = Object.entries(content.items).filter(([, def]) => !(def.icon in items.frames));
    expect(missing.map(([id, def]) => `${id}: ${def.icon}`)).toEqual([]);
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

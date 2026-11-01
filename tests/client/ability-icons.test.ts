import fs from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { SpriteSheetSchema } from '../../src/content/sprite-sheet';
import { content } from '../helpers';

describe('full-color ability atlas', () => {
  it('provides a valid 48px frame for every playable ability and variant', () => {
    const meta = SpriteSheetSchema.parse(
      JSON.parse(fs.readFileSync(new URL('../../assets/sprites/abilities.json', import.meta.url), 'utf8')),
    );
    const png = PNG.sync.read(
      fs.readFileSync(new URL('../../assets/sprites/abilities.png', import.meta.url)),
    );
    expect([meta.frameWidth, meta.frameHeight]).toEqual([48, 48]);
    expect([png.width % 48, png.height % 48]).toEqual([0, 0]);
    const frameCount = (png.width / 48) * (png.height / 48);
    for (const id of Object.keys(content.abilities)) {
      const frame = meta.frames[id];
      expect(frame, id).toBeDefined();
      expect(frame, id).toBeLessThan(frameCount);
    }
  });
});

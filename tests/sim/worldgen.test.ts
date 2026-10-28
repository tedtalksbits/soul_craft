import { describe, expect, it } from 'vitest';
import { CHUNK } from '../../src/sim/constants';
import { WorldGenerator } from '../../src/sim/world/generator';
import { content } from '../helpers';

describe('WorldGenerator', () => {
  it('generates identical chunks for the same seed, regardless of order', () => {
    const a = new WorldGenerator(123, content);
    const b = new WorldGenerator(123, content);
    a.generate(0, 0);
    a.generate(5, -3);
    const fromA = a.generate(2, 7);
    const fromB = b.generate(2, 7);
    expect(Array.from(fromB.tiles)).toEqual(Array.from(fromA.tiles));
    expect(fromB.spawns).toEqual(fromA.spawns);
  });

  it('produces different worlds for different seeds', () => {
    const a = new WorldGenerator(1, content).generate(4, 4);
    const b = new WorldGenerator(2, content).generate(4, 4);
    expect(Array.from(a.tiles)).not.toEqual(Array.from(b.tiles));
  });

  it.each([1, 2, 3, 99, 4242])('seed %i starts in the origin village with a bonfire and dry land', (seed) => {
    const gen = new WorldGenerator(seed, content);
    const chunks = [gen.generate(-1, -1), gen.generate(0, -1), gen.generate(-1, 0), gen.generate(0, 0)];
    const bonfires = chunks.flatMap((c) => c.spawns).filter((s) => s.entity.kind === 'bonfire');
    expect(bonfires.map((b) => b.id)).toContain('ashen_village@origin#15,11');

    const spawn = gen.originSpawn();
    const tx = Math.floor(spawn.x / 16);
    const ty = Math.floor(spawn.y / 16);
    const cx = Math.floor(tx / CHUNK);
    const cy = Math.floor(ty / CHUNK);
    const spawnTile = gen.generate(cx, cy).tiles[(ty - cy * CHUNK) * CHUNK + (tx - cx * CHUNK)]!;
    expect(content.tile(spawnTile).solid).toBe(false);
    const water = content.tileId('water');
    const r = content.world.origin.safeRadius - 1;
    for (let y = -r; y <= r; y += 3)
      for (let x = -r; x <= r; x += 3) if (Math.hypot(x, y) < r) expect(gen.terrainAt(x, y)).not.toBe(water);
  });

  it('keeps enemy spawns away from the origin', () => {
    const gen = new WorldGenerator(7, content);
    for (let cy = -2; cy <= 1; cy++)
      for (let cx = -2; cx <= 1; cx++)
        for (const s of gen.generate(cx, cy).spawns)
          if (s.entity.kind === 'enemy' && !s.id.includes('@'))
            expect(Math.hypot(s.x / 16, s.y / 16)).toBeGreaterThanOrEqual(content.world.origin.safeRadius);
  });

  it('only places enemy spawns on walkable tiles', () => {
    const gen = new WorldGenerator(11, content);
    for (let cx = 3; cx < 8; cx++) {
      const chunk = gen.generate(cx, 2);
      for (const s of chunk.spawns) {
        const tx = Math.floor(s.x / 16) - cx * CHUNK;
        const ty = Math.floor(s.y / 16) - 2 * CHUNK;
        expect(content.tile(chunk.tiles[ty * CHUNK + tx]!).solid).toBe(false);
      }
    }
  });
});

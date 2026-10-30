/**
 * The world map's ground: each chunk drawn once as a tiny image, one pixel per
 * tile in the tile's `map` color, then cached. Unloaded chunks are generated
 * from the seed (deterministic, so they match what the player saw); loaded ones
 * use the live tiles, so felled trees show.
 */
import { CHUNK } from '../../sim/constants';
import type { Simulation } from '../../sim/simulation';
import { chunkKey } from '../../sim/world/generator';

export class MapTerrain {
  private readonly cache = new Map<string, HTMLCanvasElement>();
  private sim: Simulation | null = null;

  /** The 32×32 image of a chunk. The cache resets for a different game. */
  chunk(sim: Simulation, cx: number, cy: number): HTMLCanvasElement {
    if (sim !== this.sim) {
      this.cache.clear();
      this.sim = sim;
    }
    const key = chunkKey(cx, cy);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const tiles = sim.world.getChunk(key)?.tiles ?? sim.world.gen.generate(cx, cy).tiles;
    const canvas = document.createElement('canvas');
    canvas.width = CHUNK;
    canvas.height = CHUNK;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const img = ctx.createImageData(CHUNK, CHUNK);
      tiles.forEach((id, i) => {
        const hex = sim.content.tiles[id]?.map ?? '#000000';
        const n = Number.parseInt(hex.slice(1), 16);
        img.data[i * 4] = (n >> 16) & 0xff;
        img.data[i * 4 + 1] = (n >> 8) & 0xff;
        img.data[i * 4 + 2] = n & 0xff;
        img.data[i * 4 + 3] = 255;
      });
      ctx.putImageData(img, 0, 0);
    }
    this.cache.set(key, canvas);
    return canvas;
  }

  /** Forget a chunk's image, e.g. after the player changed its tiles. */
  invalidate(key: string): void {
    this.cache.delete(key);
  }
}

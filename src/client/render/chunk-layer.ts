/**
 * Draws loaded chunks. Each chunk becomes one container of tile sprites cached
 * as a single texture, rebuilt only when its tiles or the tile art change.
 */
import { Container, Sprite } from 'pixi.js';
import { hash32 } from '../../core/hash';
import { CHUNK, TILE } from '../../sim/constants';
import type { Simulation } from '../../sim/simulation';
import type { Chunk } from '../../sim/world/chunk-world';
import type { Assets } from '../assets';

interface ChunkView {
  container: Container;
  version: number;
  assetsVersion: number;
}

export class ChunkLayer {
  readonly root = new Container();
  private readonly views = new Map<string, ChunkView>();

  constructor(private readonly assets: Assets) {}

  sync(sim: Simulation): void {
    const live = new Set<string>();
    for (const chunk of sim.world.loaded) {
      live.add(chunk.key);
      const view = this.views.get(chunk.key);
      if (view && view.version === chunk.version && view.assetsVersion === this.assets.version) continue;
      if (view) view.container.destroy({ children: true });
      this.views.set(chunk.key, this.build(sim, chunk));
    }
    for (const [key, view] of this.views) {
      if (live.has(key)) continue;
      view.container.destroy({ children: true });
      this.views.delete(key);
    }
  }

  /** Drops every cached chunk, e.g. when switching worlds. */
  clear(): void {
    for (const view of this.views.values()) view.container.destroy({ children: true });
    this.views.clear();
  }

  private build(sim: Simulation, chunk: Chunk): ChunkView {
    const sheet = this.assets.sheet('tiles');
    const content = sim.content;
    const container = new Container();
    container.position.set(chunk.cx * CHUNK * TILE, chunk.cy * CHUNK * TILE);
    const frameFor = (frames: readonly string[], tx: number, ty: number) =>
      sheet?.named.get(frames[hash32(tx, ty) % frames.length] ?? '') ?? this.assets.missingTexture;

    for (let y = 0; y < CHUNK; y++) {
      for (let x = 0; x < CHUNK; x++) {
        const tx = chunk.cx * CHUNK + x;
        const ty = chunk.cy * CHUNK + y;
        const tile = content.tile(chunk.tiles[y * CHUNK + x] ?? 0);
        if (tile.overlay) {
          const biome = content.biomes[sim.world.gen.biomeAt(tx, ty)];
          const groundId = biome?.ground[0]?.[0];
          const ground = groundId === undefined ? undefined : content.tiles[content.tileId(groundId)];
          if (ground) container.addChild(place(frameFor(ground.frames, tx, ty), x, y));
        }
        container.addChild(place(frameFor(tile.frames, tx, ty), x, y));
      }
    }
    container.cacheAsTexture(true);
    this.root.addChild(container);
    return { container, version: chunk.version, assetsVersion: this.assets.version };
  }
}

function place(texture: Sprite['texture'], x: number, y: number): Sprite {
  const s = new Sprite(texture);
  s.position.set(x * TILE, y * TILE);
  if (texture.width !== TILE) s.setSize(TILE, TILE);
  return s;
}

/**
 * Draws loaded chunks. Each chunk becomes one container of tile sprites cached
 * as a single texture, rebuilt only when its tiles or the tile art change.
 */
import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { hash32 } from '../../core/hash';
import { Body } from '../../sim/components';
import { CHUNK, TILE } from '../../sim/constants';
import type { Simulation } from '../../sim/simulation';
import type { Chunk } from '../../sim/world/chunk-world';
import type { Assets } from '../assets';

interface ChunkView {
  container: Container;
  scenery: SceneryView[];
  version: number;
  assetsVersion: number;
}

interface SceneryView {
  root: Container;
  canopy?: Sprite;
  textures: Texture[];
}

/** Compare the player's head/body area with foliage drawn in front of their feet. */
export function canopyHidesPlayer(
  bounds: { x: number; y: number; width: number; height: number },
  treeFeet: number,
  player: { x: number; y: number; w: number; h: number },
): boolean {
  const feet = player.y + player.h / 2;
  return (
    treeFeet > feet &&
    player.x + player.w / 2 + 3 > bounds.x &&
    player.x - player.w / 2 - 3 < bounds.x + bounds.width &&
    feet > bounds.y &&
    feet - 34 < bounds.y + bounds.height
  );
}

export class ChunkLayer {
  readonly root = new Container();
  private readonly views = new Map<string, ChunkView>();

  constructor(
    private readonly assets: Assets,
    private readonly depthLayer: Container,
  ) {}

  sync(sim: Simulation, dtMs = 1000 / 60): void {
    const live = new Set<string>();
    for (const chunk of sim.world.loaded) {
      live.add(chunk.key);
      const view = this.views.get(chunk.key);
      if (view && view.version === chunk.version && view.assetsVersion === this.assets.version) continue;
      if (view) this.destroy(view);
      this.views.set(chunk.key, this.build(sim, chunk));
    }
    for (const [key, view] of this.views) {
      if (live.has(key)) continue;
      this.destroy(view);
      this.views.delete(key);
    }
    const player = sim.ecs.get(sim.player, Body);
    const blend = 1 - Math.exp(-Math.max(0, dtMs) / 90);
    for (const view of this.views.values()) {
      for (const scenery of view.scenery) {
        const canopy = scenery.canopy;
        if (!canopy) continue;
        const bounds = {
          x: scenery.root.x + canopy.x,
          y: scenery.root.y + canopy.y,
          width: canopy.texture.width,
          height: canopy.texture.height,
        };
        const target = player && canopyHidesPlayer(bounds, scenery.root.y, player) ? 0.18 : 1;
        canopy.alpha += (target - canopy.alpha) * blend;
      }
    }
  }

  /** Drops every cached chunk, e.g. when switching worlds. */
  clear(): void {
    for (const view of this.views.values()) this.destroy(view);
    this.views.clear();
  }

  private destroy(view: ChunkView): void {
    view.container.destroy({ children: true });
    for (const scenery of view.scenery) {
      scenery.root.destroy({ children: true });
      for (const texture of scenery.textures) texture.destroy();
    }
  }

  private build(sim: Simulation, chunk: Chunk): ChunkView {
    const sheet = this.assets.sheet('tiles');
    const content = sim.content;
    const container = new Container();
    const scenery: SceneryView[] = [];
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
        const scenerySheet = tile.scenery ? this.assets.sheet(tile.scenery.sheet) : undefined;
        const sceneryFrame = tile.scenery?.frame ?? tile.frames[hash32(tx, ty) % tile.frames.length];
        const sceneryTexture = sceneryFrame ? scenerySheet?.named.get(sceneryFrame) : undefined;
        if (sceneryTexture && scenerySheet) {
          const root = new Container();
          root.position.set((tx + 0.5) * TILE, (ty + 1) * TILE);
          root.zIndex = root.y;
          const view: SceneryView = { root, textures: [] };
          const [ax, ay] = scenerySheet.def.anchor;
          const split = tile.scenery?.fadeAbove;
          if (split && split < sceneryTexture.height) {
            for (const [start, height] of [
              [0, split],
              [split, sceneryTexture.height - split],
            ]) {
              if (start === undefined || height === undefined) continue;
              const frame = sceneryTexture.frame;
              const texture = new Texture({
                source: sceneryTexture.source,
                frame: new Rectangle(frame.x, frame.y + start, frame.width, height),
              });
              view.textures.push(texture);
              const part = new Sprite(texture);
              part.position.set(-ax * frame.width, -ay * frame.height + start);
              root.addChild(part);
              if (start === 0) view.canopy = part;
            }
          } else {
            const sprite = new Sprite(sceneryTexture);
            sprite.anchor.set(ax, ay);
            root.addChild(sprite);
          }
          this.depthLayer.addChild(root);
          scenery.push(view);
        } else container.addChild(place(frameFor(tile.frames, tx, ty), x, y));
      }
    }
    container.cacheAsTexture(true);
    this.root.addChild(container);
    return { container, scenery, version: chunk.version, assetsVersion: this.assets.version };
  }
}

function place(texture: Sprite['texture'], x: number, y: number): Sprite {
  const s = new Sprite(texture);
  s.position.set(x * TILE, y * TILE);
  if (texture.width !== TILE) s.setSize(TILE, TILE);
  return s;
}

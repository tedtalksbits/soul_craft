/**
 * Deterministic world generation. Any chunk can be generated on its own from
 * (seed, content, cx, cy), so the world is effectively infinite and chunks
 * stitch seamlessly. Nothing here touches the ECS or mutable sim state.
 *
 * Layers, in order:
 *   1. climate noise (moisture, temperature) -> biome
 *   2. elevation and river noise -> lakes, rivers and walkable fords
 *   3. biome ground + scatter (trees, rocks, tall grass)
 *   4. handmade prefabs, one optional placement per region of chunks
 *   5. enemy spawn points from the biome's spawn table
 */
import type { Content } from '../../content/content';
import type { PrefabDef, PrefabEntityDef } from '../../content/schemas';
import { hash32, hashString, hashUnit } from '../../core/hash';
import { fbm } from '../../core/noise';
import { Rng } from '../../core/rng';
import { CHUNK, TILE } from '../constants';

export interface SpawnPoint {
  /** Stable across sessions: used to remember kills and to respawn. */
  id: string;
  /** World pixels, center of the tile. */
  x: number;
  y: number;
  entity: PrefabEntityDef;
}

export interface Area {
  id: string;
  name: string;
  darkness: number | undefined;
  /** Inclusive tile bounds. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ChunkData {
  cx: number;
  cy: number;
  tiles: Uint16Array;
  spawns: SpawnPoint[];
  areas: Area[];
}

export interface PrefabPlacement {
  id: string;
  prefabId: string;
  prefab: PrefabDef;
  x0: number;
  y0: number;
  w: number;
  h: number;
}

export const chunkKey = (cx: number, cy: number): string => `${cx},${cy}`;

const SALT = {
  moisture: hashString('moisture'),
  temperature: hashString('temperature'),
  elevation: hashString('elevation'),
  river: hashString('river'),
  ford: hashString('ford'),
  ground: hashString('ground'),
  scatter: hashString('scatter'),
  region: hashString('region'),
  spawns: hashString('spawns'),
};

export class WorldGenerator {
  private readonly seeds: Record<keyof typeof SALT, number>;
  private readonly placementCache = new Map<string, PrefabPlacement | null>();

  constructor(
    readonly seed: number,
    readonly content: Content,
  ) {
    this.seeds = Object.fromEntries(
      Object.entries(SALT).map(([k, salt]) => [k, hash32(seed, salt)]),
    ) as Record<keyof typeof SALT, number>;
  }

  climate(tx: number, ty: number): { moisture: number; temperature: number } {
    const s = this.content.world.terrain.climateScale;
    return {
      moisture: fbm(this.seeds.moisture, tx * s, ty * s, 3),
      temperature: fbm(this.seeds.temperature, tx * s, ty * s, 3),
    };
  }

  biomeAt(tx: number, ty: number): string {
    const origin = this.content.world.origin;
    if (origin.biome !== undefined && Math.hypot(tx, ty) < origin.safeRadius * 2) return origin.biome;
    const { moisture, temperature } = this.climate(tx, ty);
    const inRange = (v: number, r: readonly [number, number] | undefined) => !r || (v >= r[0] && v <= r[1]);
    for (const rule of this.content.world.biomeRules) {
      if (inRange(moisture, rule.moisture) && inRange(temperature, rule.temperature)) return rule.biome;
    }
    // Unreachable: content validation guarantees a catch-all last rule.
    throw new Error('No biome rule matched');
  }

  /** Terrain before prefabs and player edits. */
  terrainAt(tx: number, ty: number): number {
    const c = this.content;
    const t = c.world.terrain;
    const nearOrigin = Math.hypot(tx, ty) < c.world.origin.safeRadius;

    if (!nearOrigin) {
      const elevation = fbm(this.seeds.elevation, tx * t.elevationScale, ty * t.elevationScale, 4);
      if (elevation < t.lakeLevel) {
        return c.tileId(elevation > t.lakeLevel - t.shoreWidth ? t.shallowTile : t.waterTile);
      }
      const river = Math.abs(fbm(this.seeds.river, tx * t.riverScale, ty * t.riverScale, 3) - 0.5);
      if (river < t.riverWidth) {
        const ford = fbm(this.seeds.ford, tx * t.fordScale, ty * t.fordScale, 2) > t.fordThreshold;
        const bank = river > t.riverWidth * 0.6;
        return c.tileId(ford || bank ? t.shallowTile : t.waterTile);
      }
    }

    const biome = c.biomes[this.biomeAt(tx, ty)];
    if (!biome) throw new Error('biome missing after validation');
    for (let i = 0; i < biome.scatter.length; i++) {
      const s = biome.scatter[i];
      if (!s) continue;
      if (
        fbm(this.seeds.scatter + i * 7919, tx * s.scale, ty * s.scale, 2) > s.threshold &&
        hashUnit(this.seeds.scatter, i, tx, ty) < s.chance
      ) {
        return c.tileId(s.tile);
      }
    }
    const roll = hashUnit(this.seeds.ground, tx, ty);
    let total = 0;
    for (const [, w] of biome.ground) total += w;
    let acc = 0;
    for (const [tile, w] of biome.ground) {
      acc += w / total;
      if (roll < acc) return c.tileId(tile);
    }
    return c.tileId(biome.ground[0]?.[0] ?? '');
  }

  /** The prefab placed in a region, if any. Region (0, 0) always holds the origin prefab. */
  placementFor(rx: number, ry: number): PrefabPlacement | null {
    const key = `${rx},${ry}`;
    const cached = this.placementCache.get(key);
    if (cached !== undefined) return cached;
    const placement = this.computePlacement(rx, ry);
    this.placementCache.set(key, placement);
    return placement;
  }

  private computePlacement(rx: number, ry: number): PrefabPlacement | null {
    const w = this.content.world;
    if (rx === 0 && ry === 0) {
      const prefab = this.content.prefabs[w.origin.prefab];
      if (!prefab) throw new Error('origin prefab missing after validation');
      const { pw, ph } = prefabSize(prefab);
      return {
        id: `${w.origin.prefab}@origin`,
        prefabId: w.origin.prefab,
        prefab,
        x0: -Math.floor(pw / 2),
        y0: -Math.floor(ph / 2),
        w: pw,
        h: ph,
      };
    }
    const rng = new Rng(hash32(this.seeds.region, rx, ry));
    const prefabId = rng.weighted(w.regions.prefabs);
    if (prefabId === null) return null;
    const prefab = this.content.prefabs[prefabId];
    if (!prefab) return null;
    const { pw, ph } = prefabSize(prefab);
    const span = w.regions.sizeChunks * CHUNK;
    const margin = 2;
    if (pw + margin * 2 > span || ph + margin * 2 > span) return null;
    const x0 = rx * span + rng.int(margin, span - pw - margin);
    const y0 = ry * span + rng.int(margin, span - ph - margin);
    // Keep the starting area to the origin prefab alone.
    if (Math.hypot(x0 + pw / 2, y0 + ph / 2) < w.origin.safeRadius + Math.max(pw, ph)) return null;
    if (prefab.biomes && !prefab.biomes.includes(this.biomeAt(x0 + (pw >> 1), y0 + (ph >> 1)))) return null;
    return { id: `${prefabId}@${rx},${ry}`, prefabId, prefab, x0, y0, w: pw, h: ph };
  }

  /** Prefab placements whose bounds intersect a chunk. */
  placementsTouching(cx: number, cy: number): PrefabPlacement[] {
    const span = this.content.world.regions.sizeChunks * CHUNK;
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const out: PrefabPlacement[] = [];
    const rxs = new Set([Math.floor(x0 / span), Math.floor((x0 + CHUNK - 1) / span)]);
    const rys = new Set([Math.floor(y0 / span), Math.floor((y0 + CHUNK - 1) / span)]);
    // The origin prefab is centered on (0, 0) and can poke into neighbouring regions.
    rxs.add(0);
    rys.add(0);
    for (const rx of rxs) {
      for (const ry of rys) {
        const p = this.placementFor(rx, ry);
        if (p && p.x0 < x0 + CHUNK && p.x0 + p.w > x0 && p.y0 < y0 + CHUNK && p.y0 + p.h > y0) out.push(p);
      }
    }
    return out;
  }

  /** The player's starting position in world pixels. */
  originSpawn(): { x: number; y: number } {
    const p = this.placementFor(0, 0);
    if (!p) throw new Error('origin placement missing');
    for (const [y, row] of p.prefab.rows.entries()) {
      for (const [x, ch] of [...row].entries()) {
        if (p.prefab.legend[ch]?.entity?.kind === 'playerSpawn') return tileCenter(p.x0 + x, p.y0 + y);
      }
    }
    throw new Error('origin prefab has no playerSpawn');
  }

  generate(cx: number, cy: number): ChunkData {
    const c = this.content;
    const ox = cx * CHUNK;
    const oy = cy * CHUNK;
    const tiles = new Uint16Array(CHUNK * CHUNK);
    for (let y = 0; y < CHUNK; y++) {
      for (let x = 0; x < CHUNK; x++) tiles[y * CHUNK + x] = this.terrainAt(ox + x, oy + y);
    }

    const spawns: SpawnPoint[] = [];
    const areas: Area[] = [];
    const placements = this.placementsTouching(cx, cy);
    for (const p of placements) {
      if (p.prefab.name) {
        areas.push({
          id: p.id,
          name: p.prefab.name,
          darkness: p.prefab.darkness,
          x0: p.x0,
          y0: p.y0,
          x1: p.x0 + p.w - 1,
          y1: p.y0 + p.h - 1,
        });
      }
      for (const [py, row] of p.prefab.rows.entries()) {
        for (const [px, ch] of [...row].entries()) {
          const tx = p.x0 + px;
          const ty = p.y0 + py;
          if (tx < ox || ty < oy || tx >= ox + CHUNK || ty >= oy + CHUNK) continue;
          const entry = p.prefab.legend[ch];
          if (!entry) continue;
          if (entry.tile) tiles[(ty - oy) * CHUNK + (tx - ox)] = c.tileId(entry.tile);
          if (entry.entity && entry.entity.kind !== 'playerSpawn') {
            spawns.push({ id: `${p.id}#${px},${py}`, ...tileCenter(tx, ty), entity: entry.entity });
          }
        }
      }
    }

    this.addEnemySpawns(cx, cy, tiles, placements, spawns);
    return { cx, cy, tiles, spawns, areas };
  }

  private addEnemySpawns(
    cx: number,
    cy: number,
    tiles: Uint16Array,
    placements: readonly PrefabPlacement[],
    out: SpawnPoint[],
  ): void {
    const c = this.content;
    const rng = new Rng(hash32(this.seeds.spawns, cx, cy));
    const ox = cx * CHUNK;
    const oy = cy * CHUNK;
    const biome = c.biomes[this.biomeAt(ox + CHUNK / 2, oy + CHUNK / 2)];
    if (!biome) return;
    const perChunk = biome.spawns.perChunk;
    const count = Math.floor(perChunk) + (rng.chance(perChunk % 1) ? 1 : 0);
    const nearPrefab = (tx: number, ty: number) =>
      placements.some((p) => tx >= p.x0 - 3 && tx < p.x0 + p.w + 3 && ty >= p.y0 - 3 && ty < p.y0 + p.h + 3);

    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 12; attempt++) {
        const lx = rng.int(1, CHUNK - 2);
        const ly = rng.int(1, CHUNK - 2);
        const tx = ox + lx;
        const ty = oy + ly;
        if (c.tile(tiles[ly * CHUNK + lx] ?? 0).solid) continue;
        if (Math.hypot(tx, ty) < c.world.origin.safeRadius || nearPrefab(tx, ty)) continue;
        const local = c.biomes[this.biomeAt(tx, ty)] ?? biome;
        out.push({
          id: `${chunkKey(cx, cy)}#${i}`,
          ...tileCenter(tx, ty),
          entity: { kind: 'enemy', archetype: rng.weighted(local.spawns.table) },
        });
        break;
      }
    }
  }
}

function prefabSize(p: PrefabDef): { pw: number; ph: number } {
  return { pw: p.rows[0]?.length ?? 0, ph: p.rows.length };
}

export function tileCenter(tx: number, ty: number): { x: number; y: number } {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}

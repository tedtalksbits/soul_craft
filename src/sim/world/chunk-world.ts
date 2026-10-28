/**
 * The loaded part of the infinite tile world: generated chunks plus the
 * player's edits (stored as overrides in SimState so saves stay small).
 *
 * Unloaded space reads as solid, so nothing can walk off the simulated area.
 */
import type { Content } from '../../content/content';
import type { TileDef } from '../../content/schemas';
import { CHUNK, TILE } from '../constants';
import type { SimState } from '../state';
import { chunkKey, WorldGenerator, type Area, type ChunkData } from './generator';

export interface Chunk extends ChunkData {
  key: string;
  /** Bumped on every tile change so renderers know to rebuild. */
  version: number;
}

const floorDiv = (a: number, b: number) => Math.floor(a / b);

export class ChunkWorld {
  private readonly chunks = new Map<string, Chunk>();
  gen: WorldGenerator;

  constructor(
    private readonly state: SimState,
    private content: Content,
  ) {
    this.gen = new WorldGenerator(state.seed, content);
  }

  get loaded(): IterableIterator<Chunk> {
    return this.chunks.values();
  }

  get loadedKeys(): string[] {
    return [...this.chunks.keys()];
  }

  isLoaded(key: string): boolean {
    return this.chunks.has(key);
  }

  getChunk(key: string): Chunk | undefined {
    return this.chunks.get(key);
  }

  load(cx: number, cy: number): Chunk {
    const key = chunkKey(cx, cy);
    const existing = this.chunks.get(key);
    if (existing) return existing;
    const chunk: Chunk = { ...this.gen.generate(cx, cy), key, version: 0 };
    this.applyOverrides(chunk);
    this.chunks.set(key, chunk);
    return chunk;
  }

  unload(key: string): void {
    this.chunks.delete(key);
  }

  /** Re-generates loaded chunks, e.g. after content was hot-reloaded. Entities are untouched. */
  setContent(content: Content): void {
    this.content = content;
    this.gen = new WorldGenerator(this.state.seed, content);
    for (const old of [...this.chunks.values()]) {
      const fresh: Chunk = { ...this.gen.generate(old.cx, old.cy), key: old.key, version: old.version + 1 };
      this.applyOverrides(fresh);
      this.chunks.set(old.key, fresh);
    }
  }

  /** Tile id at a tile coordinate, or -1 if that chunk is not loaded. */
  tileIdAt(tx: number, ty: number): number {
    const chunk = this.chunks.get(chunkKey(floorDiv(tx, CHUNK), floorDiv(ty, CHUNK)));
    if (!chunk) return -1;
    return chunk.tiles[(ty - chunk.cy * CHUNK) * CHUNK + (tx - chunk.cx * CHUNK)] ?? -1;
  }

  tileAt(tx: number, ty: number): TileDef | undefined {
    const id = this.tileIdAt(tx, ty);
    return id < 0 ? undefined : this.content.tile(id);
  }

  isSolid(tx: number, ty: number): boolean {
    return this.tileAt(tx, ty)?.solid ?? true;
  }

  blocksProjectiles(tx: number, ty: number): boolean {
    const t = this.tileAt(tx, ty);
    return t ? (t.blocksProjectiles ?? t.solid) : true;
  }

  /** Changes a tile and records it so the edit survives unloading and saving. */
  setTile(tx: number, ty: number, tileKey: string): void {
    const chunk = this.chunks.get(chunkKey(floorDiv(tx, CHUNK), floorDiv(ty, CHUNK)));
    if (!chunk) return;
    const index = (ty - chunk.cy * CHUNK) * CHUNK + (tx - chunk.cx * CHUNK);
    chunk.tiles[index] = this.content.tileId(tileKey);
    chunk.version++;
    (this.state.tileOverrides[chunk.key] ??= {})[String(index)] = tileKey;
  }

  /** The named prefab area containing a world-pixel point, if its chunk is loaded. */
  areaAt(x: number, y: number): Area | undefined {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    const chunk = this.chunks.get(chunkKey(floorDiv(tx, CHUNK), floorDiv(ty, CHUNK)));
    return chunk?.areas.find((a) => tx >= a.x0 && tx <= a.x1 && ty >= a.y0 && ty <= a.y1);
  }

  private applyOverrides(chunk: Chunk): void {
    const overrides = this.state.tileOverrides[chunk.key];
    if (!overrides) return;
    for (const [index, tileKey] of Object.entries(overrides)) {
      const id = this.content.tileIndex.get(tileKey);
      // A tile removed from content since the save: keep the generated tile.
      if (id !== undefined) chunk.tiles[Number(index)] = id;
    }
  }
}

export const chunkOf = (worldPx: number): number => floorDiv(floorDiv(worldPx, TILE), CHUNK);

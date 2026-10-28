import type { Box } from '../core/math';
import type { Body } from './components';
import { TILE } from './constants';
import type { ChunkWorld } from './world/chunk-world';

export function bodyBox(b: Body): Box {
  return { x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h };
}

/** Whether a body centred at (x, y) would overlap a solid tile. */
export function blockedAt(world: ChunkWorld, b: Body, x: number, y: number): boolean {
  const l = Math.floor((x - b.w / 2) / TILE);
  const r = Math.floor((x + b.w / 2 - 0.01) / TILE);
  const t = Math.floor((y - b.h / 2) / TILE);
  const btm = Math.floor((y + b.h / 2 - 0.01) / TILE);
  for (let ty = t; ty <= btm; ty++) for (let tx = l; tx <= r; tx++) if (world.isSolid(tx, ty)) return true;
  return false;
}

/**
 * Moves a body one axis at a time, sliding along walls. When a full step is
 * blocked it creeps forward in half-pixel steps so bodies rest flush against
 * walls. Returns whether either axis hit something.
 */
export function moveBody(world: ChunkWorld, b: Body, dx: number, dy: number): boolean {
  let hit = false;
  if (dx !== 0) {
    if (!blockedAt(world, b, b.x + dx, b.y)) b.x += dx;
    else {
      hit = true;
      const step = Math.sign(dx) * 0.5;
      for (let i = 0; i < Math.abs(dx) * 2 && !blockedAt(world, b, b.x + step, b.y); i++) b.x += step;
    }
  }
  if (dy !== 0) {
    if (!blockedAt(world, b, b.x, b.y + dy)) b.y += dy;
    else {
      hit = true;
      const step = Math.sign(dy) * 0.5;
      for (let i = 0; i < Math.abs(dy) * 2 && !blockedAt(world, b, b.x, b.y + step); i++) b.y += step;
    }
  }
  return hit;
}

import type { Box } from '../core/math';
import type { Body } from './components';
import { TILE } from './constants';
import type { ChunkWorld } from './world/chunk-world';

export function bodyBox(b: Body): Box {
  return { x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h };
}

/** Whether a body centered at (x, y) would overlap a solid tile. */
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
export function moveBody(world: ChunkWorld, b: Body, dx: number, dy: number, slide = 0): boolean {
  let hit = false;
  if (dx !== 0) {
    if (!blockedAt(world, b, b.x + dx, b.y)) b.x += dx;
    else {
      hit = true;
      const step = Math.sign(dx) * 0.5;
      for (let i = 0; i < Math.abs(dx) * 2 && !blockedAt(world, b, b.x + step, b.y); i++) b.x += step;
      if (slide > 0 && dy === 0) slideAroundCorner(world, b, 'x', dx, slide);
    }
  }
  if (dy !== 0) {
    if (!blockedAt(world, b, b.x, b.y + dy)) b.y += dy;
    else {
      hit = true;
      const step = Math.sign(dy) * 0.5;
      for (let i = 0; i < Math.abs(dy) * 2 && !blockedAt(world, b, b.x, b.y + step); i++) b.y += step;
      if (slide > 0 && dx === 0) slideAroundCorner(world, b, 'y', dy, slide);
    }
  }
  return hit;
}

/**
 * A body walking straight into an obstacle that it overlaps by at most `slide` px
 * sideways is nudged towards the opening (no faster than it was moving), so it
 * rounds corners and threads narrow gaps instead of stopping dead. Diagonal input
 * needs no help: it already slides along walls.
 */
function slideAroundCorner(world: ChunkWorld, b: Body, axis: 'x' | 'y', d: number, slide: number): void {
  const ahead = Math.sign(d);
  const speed = Math.min(Math.abs(d), 1);
  for (let k = 1; k <= slide; k++) {
    for (const side of [-1, 1]) {
      const [sx, sy] = axis === 'x' ? [b.x, b.y + side * k] : [b.x + side * k, b.y];
      const [ax, ay] = axis === 'x' ? [sx + ahead, sy] : [sx, sy + ahead];
      if (blockedAt(world, b, sx, sy) || blockedAt(world, b, ax, ay)) continue;
      const [nx, ny] = axis === 'x' ? [b.x, b.y + side * speed] : [b.x + side * speed, b.y];
      if (!blockedAt(world, b, nx, ny)) [b.x, b.y] = [nx, ny];
      return;
    }
  }
}

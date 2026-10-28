import type { Dir } from '../../core/math';

/**
 * Eight-way facing for sprite selection. The simulation only tracks four
 * directions (enough for gameplay); art may have diagonals, so the renderer
 * derives them from movement.
 */
export type Dir8 = Dir | 'down_right' | 'up_right' | 'up_left' | 'down_left';

/** Clockwise from +x in screen space (y points down). */
const OCTANTS: readonly Dir8[] = [
  'right',
  'down_right',
  'down',
  'down_left',
  'left',
  'up_left',
  'up',
  'up_right',
];
const MOVING = 0.05;

export function dir8FromVec(x: number, y: number): Dir8 {
  const octant = Math.round(Math.atan2(y, x) / (Math.PI / 4));
  return OCTANTS[(octant + 8) % 8]!;
}

/**
 * Facing to draw this frame. While moving, the direction of travel. When
 * stopped, the previous diagonal is kept as long as it still includes the
 * sim's facing (so stopping after walking down-right keeps that pose), and
 * snaps to the sim's facing otherwise (e.g. an attack aimed elsewhere).
 */
export function resolveDir8(previous: Dir8 | undefined, facing: Dir, vx: number, vy: number): Dir8 {
  if (Math.abs(vx) + Math.abs(vy) > MOVING) return dir8FromVec(vx, vy);
  if (previous !== undefined && previous.split('_').includes(facing)) return previous;
  return facing;
}

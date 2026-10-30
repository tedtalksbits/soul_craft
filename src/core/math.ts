export type Dir = 'up' | 'down' | 'left' | 'right';

export const DIR_VEC: Readonly<Record<Dir, readonly [number, number]>> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/** Four-way facing for a vector, preferring the horizontal axis on exact diagonals. */
export function dirFromVec(x: number, y: number, fallback: Dir): Dir {
  if (x === 0 && y === 0) return fallback;
  if (Math.abs(x) >= Math.abs(y)) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'down' : 'up';
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function normalize(x: number, y: number): [number, number] {
  const len = Math.hypot(x, y);
  return len === 0 ? [0, 0] : [x / len, y / len];
}

/** Axis-aligned box in world pixels, top-left origin. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

const COMPASS_WORDS = [
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
  'north',
  'north-east',
] as const;

/** The 8-way compass word for a direction in world space, where y grows southward: "north-east". */
export function compassWord(dx: number, dy: number): string {
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return COMPASS_WORDS[(octant + 8) % 8] ?? 'north';
}

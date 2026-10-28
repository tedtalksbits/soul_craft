import { hashUnit } from './hash';

/**
 * Seeded value noise over an infinite plane. Lattice values come from hashing,
 * so there are no tables and any coordinate can be sampled independently,
 * which is what chunk streaming needs.
 */
export function valueNoise(seed: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hashUnit(seed, xi, yi);
  const b = hashUnit(seed, xi + 1, yi);
  const c = hashUnit(seed, xi, yi + 1);
  const d = hashUnit(seed, xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal value noise normalised to [0, 1). */
export function fbm(seed: number, x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(seed + i * 1013, x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

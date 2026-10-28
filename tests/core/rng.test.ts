import { describe, expect, it } from 'vitest';
import { hash32 } from '../../src/core/hash';
import { fbm } from '../../src/core/noise';
import { Rng } from '../../src/core/rng';

describe('Rng', () => {
  it('is reproducible from a seed and from saved state', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seq = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seq);

    const resumed = new Rng(a.state());
    expect(resumed.next()).toBe(a.next());
  });

  it('stays within bounds', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const n = r.int(3, 5);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
      const f = r.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it('respects weights', () => {
    const r = new Rng(1);
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 4000; i++)
      counts[
        r.weighted([
          ['a', 3],
          ['b', 1],
        ] as const)
      ]++;
    expect(counts.a / counts.b).toBeGreaterThan(2.5);
    expect(counts.a / counts.b).toBeLessThan(3.5);
  });
});

describe('hashing and noise', () => {
  it('is pure', () => {
    expect(hash32(1, 2, 3)).toBe(hash32(1, 2, 3));
    expect(hash32(1, 2, 3)).not.toBe(hash32(3, 2, 1));
    expect(fbm(9, 1.5, -2.25)).toBe(fbm(9, 1.5, -2.25));
  });
});

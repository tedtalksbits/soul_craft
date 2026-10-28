/**
 * Seedable, serializable PRNG (sfc32). Every random decision the simulation
 * makes must go through an Rng so a seed plus an input log replays exactly.
 */

export type RngState = [number, number, number, number];

/** splitmix32: spreads a single seed into well-mixed state words. */
function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seedOrState: number | RngState) {
    if (typeof seedOrState === 'number') {
      const mix = splitmix32(seedOrState);
      this.a = mix();
      this.b = mix();
      this.c = mix();
      this.d = mix();
      for (let i = 0; i < 12; i++) this.nextUint();
    } else {
      [this.a, this.b, this.c, this.d] = seedOrState;
    }
  }

  nextUint(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextUint() / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick on empty list');
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Picks from `[value, weight]` pairs. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const [, w] of entries) total += w;
    let roll = this.next() * total;
    for (const [value, w] of entries) {
      roll -= w;
      if (roll < 0) return value;
    }
    const last = entries[entries.length - 1];
    if (!last) throw new Error('Rng.weighted on empty list');
    return last[0];
  }

  state(): RngState {
    return [this.a, this.b, this.c, this.d];
  }
}

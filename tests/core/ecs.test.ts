import { describe, expect, it } from 'vitest';
import { defineComponent, World } from '../../src/core/ecs';

const Pos = defineComponent<{ x: number; y: number }>('pos');
const Tag = defineComponent<{ label: string }>('tag');

describe('World', () => {
  it('queries entities that have every requested component', () => {
    const w = new World();
    const a = w.create();
    const b = w.create();
    w.add(a, Pos, { x: 1, y: 2 });
    w.add(a, Tag, { label: 'a' });
    w.add(b, Pos, { x: 3, y: 4 });
    expect([...w.query(Pos, Tag)]).toEqual([[a, { x: 1, y: 2 }, { label: 'a' }]]);
    expect([...w.query(Pos)].map(([e]) => e)).toEqual([a, b]);
  });

  it('hides destroyed entities immediately and deletes them on flush', () => {
    const w = new World();
    const a = w.create();
    w.add(a, Pos, { x: 0, y: 0 });
    w.destroy(a);
    expect(w.isAlive(a)).toBe(false);
    expect([...w.query(Pos)]).toEqual([]);
    expect(w.has(a, Pos)).toBe(true);
    w.flush();
    expect(w.has(a, Pos)).toBe(false);
  });

  it('round-trips through a snapshot without sharing references', () => {
    const w = new World();
    const a = w.create();
    w.add(a, Pos, { x: 5, y: 6 });
    const copy = World.fromSnapshot(w.snapshot());
    copy.need(a, Pos).x = 99;
    expect(w.need(a, Pos).x).toBe(5);
    expect(copy.create()).toBe(a + 1);
  });

  it('throws on need() for a missing component', () => {
    const w = new World();
    expect(() => w.need(w.create(), Pos)).toThrow(/no pos/);
  });
});

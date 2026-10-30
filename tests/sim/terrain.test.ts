import { describe, expect, it } from 'vitest';
import { Body, Pickup } from '../../src/sim/components';
import { TILE } from '../../src/sim/constants';
import { tileDamageKey } from '../../src/sim/modules/terrain';
import type { Simulation } from '../../src/sim/simulation';
import { Simulation as Sim, type SimSnapshot } from '../../src/sim/simulation';
import { content, face, newSim, ofType, press, run } from '../helpers';

/** Places a tile directly to the player's right and faces it. Returns its tile coordinates. */
function tileToTheRight(sim: Simulation, tileId: string): [number, number] {
  face(sim, 'right');
  const pb = sim.ecs.need(sim.player, Body);
  const tx = Math.floor((pb.x + 14) / TILE);
  const ty = Math.floor(pb.y / TILE);
  sim.world.setTile(tx, ty, tileId);
  return [tx, ty];
}

const swing = (sim: Simulation) => press(sim, ['attack'], 25);

describe('cuttable terrain', () => {
  it('fells a tree after three swings, one hit per swing, leaving the biome ground', () => {
    const sim = newSim();
    const [tx, ty] = tileToTheRight(sim, 'tree');
    const first = swing(sim);
    const second = swing(sim);
    expect(ofType(first, 'tileHit').map((e) => e.hitsLeft)).toEqual([2]);
    expect(ofType(second, 'tileHit').map((e) => e.hitsLeft)).toEqual([1]);
    expect(sim.world.tileAt(tx, ty)?.id).toBe('tree');

    const third = swing(sim);
    expect(ofType(third, 'tileCut')).toEqual([expect.objectContaining({ tile: 'tree', hits: 3 })]);
    expect(sim.world.tileAt(tx, ty)?.id).toBe('grass');
    expect(sim.state.tileDamage).toEqual({});
  });

  it('drops crafting materials, never souls, when trees and mushrooms break', () => {
    const sim = newSim();
    tileToTheRight(sim, 'giant_shroom');
    const events = [...swing(sim), ...swing(sim)];
    expect(ofType(events, 'tileCut')).toHaveLength(1);
    const drops = [...sim.ecs.query(Pickup)].map(([, p]) => p);
    expect(drops.map((p) => p.item)).toContain('fungal_cap');
    expect(drops.every((p) => p.kind === 'item')).toBe(true);
  });

  it('remembers partial damage across a save and restore', () => {
    const sim = newSim();
    const [tx, ty] = tileToTheRight(sim, 'tree');
    swing(sim);
    expect(sim.state.tileDamage[tileDamageKey(tx, ty)]).toBe(1);
    const restored = Sim.restore(JSON.parse(JSON.stringify(sim.snapshot())) as SimSnapshot, content);
    face(restored, 'right');
    swing(restored);
    const events = swing(restored);
    expect(ofType(events, 'tileCut')).toHaveLength(1);
  });

  it('turns a felled dead tree into the ground of the biome it stands in', () => {
    const sim = newSim();
    let target: [number, number] | undefined;
    for (let r = 60; r < 600 && !target; r += 4) {
      for (let a = 0; a < 16 && !target; a++) {
        const tx = Math.round(Math.cos(a) * r);
        const ty = Math.round(Math.sin(a) * r);
        // Well inside the hills, so the tree's tile (one or two to the right) is too.
        const hills = [0, 1, 2, 3].every((d) => sim.world.gen.biomeAt(tx + d, ty) === 'ashen_hills');
        if (hills) target = [tx, ty];
      }
    }
    expect(target).toBeDefined();
    const body = sim.ecs.need(sim.player, Body);
    body.x = target![0] * TILE + TILE / 2;
    body.y = target![1] * TILE + TILE / 2;
    run(sim, 2);
    // Clear the player's own tile so the body is not wedged inside scatter.
    sim.world.setTile(target![0], target![1], 'ash');
    const [tx, ty] = tileToTheRight(sim, 'dead_tree');
    swing(sim);
    swing(sim);
    expect(sim.world.gen.biomeAt(tx, ty)).toBe('ashen_hills');
    expect(sim.world.tileAt(tx, ty)?.id).toBe('ash');
  });

  it('breaks a rock in four swings into stone, the restoration material', () => {
    const sim = newSim();
    const [tx, ty] = tileToTheRight(sim, 'rock');
    const events = [...swing(sim), ...swing(sim), ...swing(sim)];
    expect(ofType(events, 'tileCut')).toEqual([]);
    expect(ofType(swing(sim), 'tileCut')).toHaveLength(1);
    expect(sim.world.tileAt(tx, ty)?.id).not.toBe('rock');
    const drops = [...sim.ecs.query(Pickup)].map(([, p]) => p.item);
    expect(drops).toContain('stone');
  });

  it('leaves walls and graves untouched', () => {
    for (const id of ['wall', 'grave']) {
      const sim = newSim();
      const [tx, ty] = tileToTheRight(sim, id);
      const events = [...swing(sim), ...swing(sim), ...swing(sim), ...swing(sim)];
      expect(ofType(events, 'tileHit')).toEqual([]);
      expect(sim.world.tileAt(tx, ty)?.id).toBe(id);
    }
  });
});

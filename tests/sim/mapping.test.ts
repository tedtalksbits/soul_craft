import { describe, expect, it } from 'vitest';
import { Body, Health } from '../../src/sim/components';
import { TILE } from '../../src/sim/constants';
import { inputFrame } from '../../src/sim/input';
import { applyDamage } from '../../src/sim/modules/combat';
import { isExplored } from '../../src/sim/modules/mapping';
import type { Simulation } from '../../src/sim/simulation';
import { content, newSim, run } from '../helpers';

const playerTile = (sim: Simulation) => {
  const pb = sim.ecs.need(sim.player, Body);
  return { tx: Math.floor(pb.x / TILE), ty: Math.floor(pb.y / TILE) };
};

describe('world map', () => {
  const r = content.player.exploration.revealRadius;

  it('reveals the ground around the player and nothing far away', () => {
    const sim = newSim();
    run(sim, 1);
    const { tx, ty } = playerTile(sim);
    expect(isExplored(sim.state, tx, ty)).toBe(true);
    expect(isExplored(sim.state, tx + r - 2, ty)).toBe(true);
    expect(isExplored(sim.state, tx + r * 4, ty)).toBe(false);
  });

  it('remembers what was seen after the player walks on', () => {
    const sim = newSim();
    run(sim, 1);
    const start = playerTile(sim);
    sim.ecs.need(sim.player, Body).x += r * 5 * TILE;
    run(sim, 2);
    const now = playerTile(sim);
    expect(isExplored(sim.state, start.tx, start.ty)).toBe(true);
    expect(isExplored(sim.state, now.tx, now.ty)).toBe(true);
  });

  it('marks the village and its crafting stations from the start', () => {
    const sim = newSim();
    run(sim, 1);
    const kinds = Object.values(sim.state.landmarks).map((l) => l.kind);
    expect(kinds).toContain('village');
    expect(kinds).toContain('forge');
    expect(kinds).toContain('alchemy');
    const village = Object.values(sim.state.landmarks).find((l) => l.kind === 'village');
    expect(village?.name).toBe('Ashen Village');
  });

  it('marks a set piece once the player has seen it', () => {
    const sim = newSim();
    let placement = null;
    for (let ry = -6; ry <= 6 && !placement; ry++) {
      for (let rx = -6; rx <= 6 && !placement; rx++) {
        const p = sim.world.gen.placementFor(rx, ry);
        if (p?.prefab.marker === 'wayshrine') placement = p;
      }
    }
    if (!placement) throw new Error('no wayshrine near the origin');
    expect(sim.state.landmarks[placement.id]).toBeUndefined();
    Object.assign(sim.ecs.need(sim.player, Body), {
      x: (placement.x0 + placement.w / 2) * TILE,
      y: (placement.y0 + placement.h + 2) * TILE,
    });
    run(sim, 2);
    expect(sim.state.landmarks[placement.id]).toMatchObject({ kind: 'wayshrine', name: 'Wayshrine' });
  });

  it('remembers where the player died', () => {
    const sim = newSim();
    const pb = sim.ecs.need(sim.player, Body);
    const where = { x: pb.x, y: pb.y };
    const hp = sim.ecs.need(sim.player, Health).hp;
    applyDamage(sim, sim.player, { amount: hp, crit: false, fromX: pb.x + 1, fromY: pb.y, knockback: 0 });
    expect(sim.state.lastDeath).toEqual(where);
  });

  it('places and clears the pin through the input channel', () => {
    const sim = newSim();
    run(sim, 1, inputFrame({ actions: [{ type: 'setPin', at: { x: 400, y: -120 } }] }));
    expect(sim.state.pin).toEqual({ x: 400, y: -120 });
    run(sim, 1, inputFrame({ actions: [{ type: 'setPin', at: null }] }));
    expect(sim.state.pin).toBeNull();
  });
});

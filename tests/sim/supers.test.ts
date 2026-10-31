import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/core/ecs';
import {
  Abilities,
  Blast,
  Body,
  Empowered,
  Overshield,
  Projectile,
  Staggered,
  Veiled,
  Zone,
} from '../../src/sim/components';
import { inputFrame } from '../../src/sim/input';
import { FULL_ENERGY } from '../../src/sim/modules/energy';
import { versionsOf } from '../../src/sim/modules/variants';
import type { Simulation } from '../../src/sim/simulation';
import { content, newSim, ofType, run, spawnNear } from '../helpers';

/** A player of the class whose super `variant` replaces, using it, bar full, untouchable. */
function withSuper(variant: string): Simulation {
  const sim = newSim();
  sim.state.cheats.god = true;
  sim.state.cheats.noclip = true;
  const base = content.baseAbility(variant);
  const cls = Object.entries(content.classes).find(([, c]) => c.abilities.super === base)?.[0];
  if (cls === undefined) throw new Error(`no class has ${base}`);
  const a = sim.ecs.need(sim.player, Abilities);
  a.class = cls;
  a.unlocked = { class: true, super: true };
  a.energy = FULL_ENERGY;
  a.learned[variant] = true;
  a.chosen[base] = variant;
  return sim;
}

/** Fires the super toward (dx, dy) from the player and runs to its release tick. */
function cast(sim: Simulation, ability: string, dx: number) {
  const pb = sim.ecs.need(sim.player, Body);
  const events = run(sim, 1, inputFrame({ press: ['super'], aim: { x: pb.x + dx, y: pb.y } }));
  return events.concat(run(sim, content.ability(ability).cast.release));
}

function pinned(sim: Simulation, dx: number, dy = 0): Entity {
  const e = spawnNear(sim, 'hollow', dx, dy);
  sim.ecs.add(e, Staggered, { ticks: 1e6 });
  return e;
}

describe('super versions', () => {
  it('every super has two other versions', () => {
    for (const cls of Object.values(content.classes))
      expect(versionsOf(content, cls.abilities.super)).toHaveLength(3);
  });

  it('Knife Fan throws a fan of knives that each hit what they meet', () => {
    const sim = withSuper('knife_fan');
    const left = pinned(sim, 60, -14);
    const right = pinned(sim, 60, 14);
    cast(sim, 'knife_fan', 100);
    const volley = content.ability('knife_fan').effects.find((f) => f.type === 'volley');
    expect([...sim.ecs.query(Projectile)]).toHaveLength(volley?.type === 'volley' ? volley.count : -1);
    const events = run(sim, 40);
    const hit = new Set(
      ofType(events, 'damaged')
        .filter((e) => e.ability === 'knife_fan')
        .map((e) => e.target),
    );
    expect(hit.has(left) && hit.has(right)).toBe(true);
  });

  it('Pyre burns around the player wherever they go', () => {
    const sim = withSuper('pyre');
    cast(sim, 'pyre', 10);
    const zone = [...sim.ecs.query(Zone, Body)];
    expect(zone).toHaveLength(1);
    const pb = sim.ecs.need(sim.player, Body);
    Object.assign(pb, { x: pb.x + 80, y: pb.y + 30 });
    run(sim, 1);
    expect(zone[0]?.[2]).toMatchObject({ x: pb.x, y: pb.y });
  });

  it('Ghost Run hides the player and quickens their step', () => {
    const sim = withSuper('ghost_run');
    cast(sim, 'ghost_run', 10);
    expect(sim.ecs.has(sim.player, Veiled)).toBe(true);
    expect(sim.ecs.need(sim.player, Empowered).speed).toBeGreaterThan(0);
    run(sim, content.ability('ghost_run').cast.ticks); // the cast holds the player still
    const pb = sim.ecs.need(sim.player, Body);
    const x = pb.x;
    run(sim, 10, inputFrame({ move: [1, 0] }));
    const walked = pb.x - x;
    const plain = newSim();
    plain.state.cheats.noclip = true;
    const qb = plain.ecs.need(plain.player, Body);
    const qx = qb.x;
    run(plain, 10, inputFrame({ move: [1, 0] }));
    expect(walked).toBeGreaterThan(qb.x - qx);
  });

  it('Meteor falls after a fuse', () => {
    const sim = withSuper('meteor');
    cast(sim, 'meteor', 60);
    expect([...sim.ecs.query(Blast)]).toHaveLength(1);
  });

  it('Bastion shields the player standing in it', () => {
    const sim = withSuper('bastion');
    cast(sim, 'bastion', 10);
    run(sim, 30);
    expect(sim.ecs.get(sim.player, Overshield)?.hp ?? 0).toBeGreaterThan(0);
  });

  it('Avalanche charges far and hits what it meets', () => {
    const sim = withSuper('avalanche');
    const enemy = pinned(sim, 80);
    const pb = sim.ecs.need(sim.player, Body);
    const x = pb.x;
    const events = cast(sim, 'avalanche', 200).concat(run(sim, 30));
    expect(pb.x - x).toBeGreaterThan(120);
    expect(ofType(events, 'damaged').some((e) => e.target === enemy && e.ability === 'avalanche')).toBe(true);
  });
});

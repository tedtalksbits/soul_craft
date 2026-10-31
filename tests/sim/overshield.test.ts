import { describe, expect, it } from 'vitest';
import { Abilities, Body, Health, Invulnerable, Overshield, Player } from '../../src/sim/components';
import { TICK_RATE } from '../../src/sim/constants';
import { inputFrame } from '../../src/sim/input';
import { applyDamage } from '../../src/sim/modules/combat';
import { playerStats } from '../../src/sim/modules/items';
import { refreshAbilities } from '../../src/sim/modules/abilities';
import type { Simulation } from '../../src/sim/simulation';
import { content, newSim, ofType, run } from '../helpers';

/** A fresh game as `cls`, using the `variant` of its AoE. */
function withVariant(cls: string, variant: string): Simulation {
  const sim = newSim();
  sim.state.cheats.noclip = true;
  const a = sim.ecs.need(sim.player, Abilities);
  a.class = cls;
  const base = content.baseAbility(variant);
  a.learned[variant] = true;
  a.chosen[base] = variant;
  return sim;
}

/** Throws the AoE onto the player's own feet and waits `after` ticks. */
function castAtFeet(sim: Simulation, after: number) {
  const pb = sim.ecs.need(sim.player, Body);
  const events = run(sim, 1, inputFrame({ press: ['aoe'], aim: { x: pb.x + 1, y: pb.y } }));
  return events.concat(run(sim, after));
}

const zoneOf = (id: string) => {
  const fx = content.ability(id).effects.find((f) => f.type === 'zone');
  if (fx?.type !== 'zone') throw new Error(`${id} has no zone`);
  return fx;
};

function hitPlayer(sim: Simulation, amount: number) {
  const pb = sim.ecs.need(sim.player, Body);
  // Clear the i-frames from any earlier blow so each hit lands.
  sim.ecs.remove(sim.player, Invulnerable);
  return applyDamage(sim, sim.player, { amount, crit: false, fromX: pb.x + 10, fromY: pb.y, knockback: 0 });
}

describe('healing and shielding zones', () => {
  it('Hearth heals the player standing in its fire', () => {
    const sim = withVariant('ashcaller', 'hearth');
    const health = sim.ecs.need(sim.player, Health);
    health.hp = 30;
    const zone = zoneOf('hearth');
    const events = castAtFeet(sim, zone.delay + zone.duration + 20);
    const healed = ofType(events, 'healed').reduce((n, e) => n + e.amount, 0);
    expect(healed).toBeGreaterThan(zone.heal * 5);
    expect(health.hp).toBe(Math.min(health.max, 30 + healed));
  });

  it('Cinder Ward builds an overshield up to its cap, which fades once the fire is gone', () => {
    const sim = withVariant('ashcaller', 'cinder_ward');
    const zone = zoneOf('cinder_ward');
    const shield = zone.shield!;
    castAtFeet(sim, zone.delay + zone.duration - 5);
    expect(sim.ecs.need(sim.player, Overshield).hp).toBe(shield.max);
    const events = run(sim, Math.round(shield.seconds * TICK_RATE) + 40);
    expect(sim.ecs.has(sim.player, Overshield)).toBe(false);
    expect(ofType(events, 'overshieldFaded')).toHaveLength(1);
  });
});

describe('overshield', () => {
  it('Rally shields the player at once', () => {
    const sim = withVariant('vanguard', 'rally');
    const fx = content.ability('rally').effects.find((f) => f.type === 'overshield');
    const events = castAtFeet(sim, content.ability('rally').cast.ticks);
    expect(sim.ecs.need(sim.player, Overshield).hp).toBe(fx?.type === 'overshield' ? fx.amount : -1);
    expect(ofType(events, 'overshieldGained')).toHaveLength(1);
  });

  it('soaks blows before health, and a fully soaked blow does not make the player flinch', () => {
    const sim = newSim();
    sim.ecs.add(sim.player, Overshield, { hp: 20, ticks: 600 });
    const health = sim.ecs.need(sim.player, Health);
    const hp = health.hp;
    hitPlayer(sim, 5);
    expect(health.hp).toBe(hp);
    expect(sim.ecs.need(sim.player, Player).state).not.toBe('hurt');
    const left = sim.ecs.need(sim.player, Overshield).hp;
    expect(left).toBeLessThan(20);

    // A bigger blow breaks it, and only what it could not soak gets through.
    const dealt = Math.max(1, Math.round(40 * (1 - playerStats(sim, sim.player).defense)));
    hitPlayer(sim, 40);
    expect(sim.ecs.has(sim.player, Overshield)).toBe(false);
    expect(health.hp).toBe(hp - (dealt - left));
  });

  it('resting clears it', () => {
    const sim = newSim();
    sim.ecs.add(sim.player, Overshield, { hp: 20, ticks: 600 });
    refreshAbilities(sim);
    expect(sim.ecs.has(sim.player, Overshield)).toBe(false);
  });
});

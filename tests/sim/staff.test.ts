import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/core/ecs';
import {
  Abilities,
  Ai,
  ContactDamage,
  Equipment,
  Health,
  Motion,
  Pinned,
  Projectile,
  type ItemStack,
} from '../../src/sim/components';
import { TICK_RATE } from '../../src/sim/constants';
import { Action, NO_INPUT, type InputFrame } from '../../src/sim/input';
import { abilityPower } from '../../src/sim/modules/progression';
import { embersHeld, onAbilityUsed, swingOf } from '../../src/sim/modules/weapons';
import type { Simulation } from '../../src/sim/simulation';
import { content, face, newSim, ofType, press, run, spawnNear } from '../helpers';

const staff = content.weapons.types.staff;
const sig = staff.signature.type === 'embers' ? staff.signature : undefined;
const HOLD: InputFrame = { ...NO_INPUT, held: Action.attack };

function wield(sim: Simulation, item = 'ember_staff', extra: Partial<ItemStack> = {}): void {
  sim.ecs.need(sim.player, Equipment).weapon = { item, count: 1, level: 0, ...extra };
}

function perked(perks: { perk: string; value: number }[]): Partial<ItemStack> {
  return { gear: { tier: 'rare', power: 1, seed: 1, perks } };
}

function dummy(sim: Simulation, dx: number, dy: number): Entity {
  const e = spawnNear(sim, 'hollow', dx, dy);
  sim.ecs.remove(e, Ai);
  sim.ecs.remove(e, ContactDamage);
  sim.ecs.remove(e, Motion);
  Object.assign(sim.ecs.need(e, Health), { hp: 9999, max: 9999 });
  return e;
}

const hitsOn = (events: ReturnType<typeof run>, e: Entity) =>
  ofType(events, 'damaged').filter((d) => d.target === e);

/** Holds a full charge, lets go, and waits for the shot to land. */
function fireball(sim: Simulation, after = 60): ReturnType<typeof run> {
  const events = run(sim, 1, { ...HOLD, pressed: Action.attack });
  events.push(...run(sim, staff.chain[0]!.activeFrom + staff.charged.chargeTicks + 2, HOLD));
  events.push(...run(sim, after));
  return events;
}

function bonk(sim: Simulation, times: number): void {
  for (let i = 0; i < times; i++) press(sim, ['attack'], staff.chain[i % staff.chain.length]!.duration);
}

describe('the Ember staff', () => {
  it('stores an Ember with every melee hit, up to its limit', () => {
    const sim = newSim();
    wield(sim);
    face(sim, 'right');
    dummy(sim, 16, 0);
    bonk(sim, 2);
    expect(embersHeld(sim)).toBe(2);
    bonk(sim, 4);
    expect(embersHeld(sim)).toBe(sig?.max);
  });

  it('a charged attack looses a fireball that spends an Ember', () => {
    const sim = newSim();
    wield(sim);
    face(sim, 'right');
    const foe = dummy(sim, 70, 0);
    swingOf(sim).embers = 2;
    const events = fireball(sim);
    expect(embersHeld(sim)).toBe(1);
    expect(hitsOn(events, foe)).toHaveLength(1);
  });

  it('with no Embers stored it is only a spark', () => {
    const shot = (embers: number) => {
      const sim = newSim();
      wield(sim);
      face(sim, 'right');
      const foe = dummy(sim, 70, 0);
      swingOf(sim).embers = embers;
      return hitsOn(fireball(sim), foe)[0]!.amount;
    };
    expect(shot(0)).toBeLessThan(shot(1) * 0.5);
  });

  it('the Ashcaller stores an Ember with each ability', () => {
    const sim = newSim();
    wield(sim);
    sim.ecs.need(sim.player, Abilities).class = 'ashcaller';
    onAbilityUsed(sim);
    expect(embersHeld(sim)).toBe(1);
    const vanguard = newSim();
    wield(vanguard);
    onAbilityUsed(vanguard);
    expect(embersHeld(vanguard)).toBe(0);
  });
});

describe('staff perks', () => {
  it('a fireball loosed with every Ember bursts', () => {
    const sim = newSim();
    wield(sim, 'ember_staff', perked([{ perk: 'fullEmberBlast', value: 1 }]));
    face(sim, 'right');
    dummy(sim, 70, 0);
    const beside = dummy(sim, 70, 18);
    swingOf(sim).embers = sig?.max ?? 4;
    const events = fireball(sim);
    expect(ofType(events, 'weaponRule').map((r) => r.rule)).toContain('emberBurst');
    expect(hitsOn(events, beside)).toHaveLength(1);
  });

  it('fireballs fly through foes', () => {
    const sim = newSim();
    wield(sim, 'ember_staff', perked([{ perk: 'piercingFire', value: 1 }]));
    face(sim, 'right');
    dummy(sim, 50, 0);
    const behind = dummy(sim, 90, 0);
    swingOf(sim).embers = 1;
    expect(hitsOn(fireball(sim), behind)).toHaveLength(1);
  });

  it('Embers held strengthen abilities', () => {
    const sim = newSim();
    wield(sim, 'ember_staff', perked([{ perk: 'emberPower', value: 0.05 }]));
    const bare = abilityPower(sim);
    swingOf(sim).embers = 4;
    expect(abilityPower(sim)).toBeCloseTo(bare + 0.2);
  });

  it('pins burn their foe once a second, with the bow perk', () => {
    const sim = newSim();
    wield(sim, 'ashwood_bow', perked([{ perk: 'pinBurn', value: 2 }]));
    const foe = dummy(sim, 60, 0);
    sim.ecs.add(foe, Pinned, { count: 3, ticks: 999 });
    const burns = hitsOn(run(sim, TICK_RATE * 2 + 1), foe);
    expect(burns.length).toBeGreaterThanOrEqual(2);
    expect(burns[0]!.amount).toBe(6);
  });
});

describe('Hearthwood', () => {
  it('heals with every Ember spent', () => {
    const sim = newSim();
    wield(sim, 'hearthwood', { gear: { tier: 'legendary', power: 1, seed: 1, perks: [] } });
    const health = sim.ecs.need(sim.player, Health);
    health.hp = 50;
    swingOf(sim).embers = 2;
    fireball(sim, staff.charged.activeFrom + 1);
    expect(health.hp).toBe(56);
    expect([...sim.ecs.query(Projectile)].some(([, p]) => p.kind === 'fireball')).toBe(true);
  });
});

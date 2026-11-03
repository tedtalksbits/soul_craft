import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/core/ecs';
import {
  Abilities,
  Ai,
  Body,
  ContactDamage,
  Motion,
  Equipment,
  Health,
  Marked,
  Player,
  Staggered,
  Stamina,
  type ItemStack,
} from '../../src/sim/components';
import { Action, NO_INPUT, type InputFrame } from '../../src/sim/input';
import { applyDamage } from '../../src/sim/modules/combat';
import { rollGear } from '../../src/sim/modules/gear';
import { moveNumbers, spendMark, swingOf } from '../../src/sim/modules/weapons';
import type { Simulation } from '../../src/sim/simulation';
import { content, face, newSim, ofType, press, run, spawnNear, unarmored } from '../helpers';

const weapons = content.weapons;
const HOLD: InputFrame = { ...NO_INPUT, held: Action.attack };
const player = (sim: Simulation) => sim.ecs.need(sim.player, Player);

function wield(sim: Simulation, item: string, extra: Partial<ItemStack> = {}): void {
  sim.ecs.need(sim.player, Equipment).weapon = { item, count: 1, level: 0, ...extra };
}

/** A foe that stands still, never hurts on touch, and takes a lot of killing. */
function dummy(sim: Simulation, dx: number, dy: number, archetype = 'hollow'): Entity {
  const e = spawnNear(sim, archetype, dx, dy);
  sim.ecs.remove(e, Ai);
  sim.ecs.remove(e, ContactDamage);
  sim.ecs.remove(e, Motion);
  Object.assign(sim.ecs.need(e, Health), { hp: 9999, max: 9999 });
  return e;
}

const damageTo = (events: ReturnType<typeof run>, e: Entity) =>
  ofType(events, 'damaged').filter((d) => d.target === e);

/** Taps attack and waits out the move. */
function tap(sim: Simulation, after: number): ReturnType<typeof run> {
  return press(sim, ['attack'], after);
}

/** Holds attack for `ticks`, then lets go and waits `after` ticks. */
function hold(sim: Simulation, ticks: number, after: number): ReturnType<typeof run> {
  const events = run(sim, 1, { ...HOLD, pressed: Action.attack });
  events.push(...run(sim, ticks, HOLD));
  events.push(...run(sim, after));
  return events;
}

describe('the light chain', () => {
  it('runs through its steps while tapped in rhythm, and starts over once the window lapses', () => {
    const sim = newSim();
    // Away from the tree below the spawn: facing it, an attack would swing the axe (modules/tools.ts).
    face(sim, 'right');
    const chain = weapons.types.sword.chain;
    const steps: number[] = [];
    for (const move of chain) {
      tap(sim, 0);
      steps.push(swingOf(sim).step);
      run(sim, move.duration);
    }
    expect(steps).toEqual([0, 1, 2]);
    run(sim, weapons.types.sword.chainWindow + 1);
    tap(sim, 0);
    expect(swingOf(sim).step).toBe(0);
  });

  it('ends in a finisher that reaches farther', () => {
    const sim = newSim();
    const [first, , finisher] = weapons.types.sword.chain;
    const opening = moveNumbers(sim, first);
    const last = moveNumbers(sim, finisher);
    expect(last.reach).toBeGreaterThan(opening.reach);
    expect(last.damage).toBeGreaterThan(opening.damage);
  });
});

describe('holding attack', () => {
  it('turns the swing into a charge, and a full charge into the charged attack', () => {
    const sim = newSim();
    face(sim, 'right');
    const foe = dummy(sim, 18, 0);
    const light = weapons.types.sword.chain[0]!;
    const charged = weapons.types.sword.charged;
    run(sim, 1, { ...HOLD, pressed: Action.attack });
    run(sim, light.activeFrom, HOLD);
    expect(player(sim).state).toBe('charge');
    const events = run(sim, charged.chargeTicks, HOLD);
    expect(ofType(events, 'chargeFull')).toHaveLength(1);
    const swing = run(sim, charged.duration);
    expect(swingOf(sim)).toMatchObject({ move: 'charged', charge: 1 });
    expect(damageTo(swing, foe)).toHaveLength(1);
  });

  it('lets go early and it is the light attack after all', () => {
    const sim = newSim();
    face(sim, 'right');
    const foe = dummy(sim, 14, 0);
    const events = hold(sim, weapons.types.sword.chain[0]!.activeFrom + 2, 20);
    expect(swingOf(sim).move).toBe('chain');
    expect(damageTo(events, foe)).toHaveLength(1);
  });

  it('a roll cancels a charge', () => {
    const sim = newSim();
    hold(sim, 10, 0);
    run(sim, 1, { ...HOLD, pressed: Action.roll });
    expect(player(sim).state).toBe('roll');
  });
});

describe('dash-strikes', () => {
  it('come out of an attack pressed during a roll', () => {
    const sim = newSim();
    // Away from the tree below the spawn: facing it, an attack would swing the axe (modules/tools.ts).
    face(sim, 'right');
    press(sim, ['roll'], 12);
    tap(sim, content.player.roll.duration);
    expect(swingOf(sim).move).toBe('dash');
  });
});

describe('the sword: Flow', () => {
  it('rolling through a blow makes the counter crit and refunds the roll', () => {
    const sim = newSim();
    face(sim, 'right');
    const foe = dummy(sim, 40, 0);
    press(sim, ['roll'], content.player.roll.iframesFrom + 1);
    const pb = sim.ecs.need(sim.player, Body);
    applyDamage(sim, sim.player, { amount: 10, crit: false, fromX: pb.x, fromY: pb.y - 1, knockback: 0 });
    run(sim, content.player.roll.duration);
    pb.x = sim.ecs.need(foe, Body).x - 14;
    pb.y = sim.ecs.need(foe, Body).y;
    const stamina = sim.ecs.need(sim.player, Stamina);
    stamina.value = 50;
    const events = tap(sim, 20);
    expect(damageTo(events, foe)[0]?.crit).toBe(true);
    expect(ofType(events, 'weaponRule').map((r) => r.rule)).toContain('flow');
    // The roll's stamina came back (less the swing's own cost).
    expect(stamina.value).toBeGreaterThan(50);
  });
});

describe('the spear: Tipper', () => {
  it('hits harder at the tip than up close', () => {
    const tip = newSim();
    wield(tip, 'ashwood_spear');
    face(tip, 'right');
    const far = dummy(tip, 28, 0);
    const tipEvents = tap(tip, 20);
    expect(ofType(tipEvents, 'weaponRule').map((r) => r.rule)).toContain('tipper');

    const close = newSim();
    wield(close, 'ashwood_spear');
    face(close, 'right');
    const near = dummy(close, 12, 0);
    const closeEvents = tap(close, 20);
    expect(ofType(closeEvents, 'weaponRule')).toHaveLength(0);
    expect(damageTo(tipEvents, far)[0]!.amount).toBeGreaterThan(damageTo(closeEvents, near)[0]!.amount);
  });

  it('a full charge sweeps all the way round', () => {
    const sim = newSim();
    wield(sim, 'ashwood_spear');
    face(sim, 'right');
    const behind = dummy(sim, -16, 0);
    const charged = weapons.types.spear.charged;
    const events = hold(
      sim,
      weapons.types.spear.chain[0]!.activeFrom + charged.chargeTicks + 1,
      charged.duration,
    );
    expect(damageTo(events, behind)).toHaveLength(1);
  });
});

describe('the hammer: Break', () => {
  it('carries through a blow mid-swing, where a sword flinches', () => {
    const hit = (item: string) => {
      const sim = unarmored(newSim());
      wield(sim, item);
      tap(sim, 4);
      const pb = sim.ecs.need(sim.player, Body);
      applyDamage(sim, sim.player, { amount: 5, crit: false, fromX: pb.x, fromY: pb.y - 1, knockback: 0 });
      return player(sim).state;
    };
    expect(hit('bone_cleaver')).toBe('attack');
    expect(hit('iron_sword')).toBe('hurt');
  });

  it('staggers what it hits, and crushes what is already staggered', () => {
    const sim = newSim();
    wield(sim, 'bone_cleaver');
    face(sim, 'right');
    const foe = dummy(sim, 16, 0);
    const first = weapons.types.hammer.chain[0]!;
    const opening = tap(sim, first.duration);
    expect(damageTo(opening, foe)[0]?.crit).toBe(false);
    expect(sim.ecs.has(foe, Staggered)).toBe(true);
    const crush = tap(sim, weapons.types.hammer.chain[1]!.duration);
    expect(damageTo(crush, foe)[0]?.crit).toBe(true);
    expect(ofType(crush, 'weaponRule').map((r) => r.rule)).toContain('crush');
  });

  it('a full-charge slam sends a shockwave, even past where it landed', () => {
    const sim = newSim();
    wield(sim, 'bone_cleaver');
    face(sim, 'right');
    const aside = dummy(sim, 30, 22);
    const charged = weapons.types.hammer.charged;
    const events = hold(
      sim,
      weapons.types.hammer.chain[0]!.activeFrom + charged.chargeTicks + 1,
      charged.duration,
    );
    expect(ofType(events, 'shockwave')).toHaveLength(1);
    expect(damageTo(events, aside)).toHaveLength(1);
  });
});

describe('class affinity', () => {
  it('a class fights harder with its own weapon types', () => {
    const damage = (cls: string) => {
      const sim = newSim();
      sim.ecs.need(sim.player, Abilities).class = cls;
      wield(sim, 'ashwood_spear');
      face(sim, 'right');
      const foe = dummy(sim, 28, 0);
      return damageTo(tap(sim, 20), foe)[0]!.amount;
    };
    // Same seed, same roll: the only difference is the spear's affinity with the Vanguard.
    expect(damage('vanguard')).toBeGreaterThan(damage('stalker'));
  });
});

describe('type perks', () => {
  it('roll only on the weapon types they change', () => {
    for (let seed = 1; seed <= 300; seed++) {
      for (const p of rollGear(content, 'ashwood_spear', 'noble', 1, seed).gear!.perks)
        expect(content.loot.perks[p.perk]?.weaponTypes ?? ['spear']).toContain('spear');
      for (const p of rollGear(content, 'bone_cleaver', 'noble', 1, seed).gear!.perks)
        expect(content.loot.perks[p.perk]?.weaponTypes ?? ['hammer']).toContain('hammer');
    }
  });
});

describe('Legendary weapons', () => {
  it('Oathspear marks on a tipper, and the next ability hit staggers the marked foe', () => {
    const sim = newSim();
    wield(sim, 'oathspear', { gear: { tier: 'legendary', power: 1, seed: 1, perks: [] } });
    face(sim, 'right');
    const foe = dummy(sim, 30, 0);
    tap(sim, 20);
    expect(sim.ecs.has(foe, Marked)).toBe(true);
    spendMark(sim, foe);
    expect(sim.ecs.has(foe, Marked)).toBe(false);
    expect(sim.ecs.get(foe, Staggered)?.ticks).toBeGreaterThan(60);
  });

  it('Gravebell pulls foes in before the shockwave', () => {
    const sim = newSim();
    wield(sim, 'gravebell', { gear: { tier: 'legendary', power: 1, seed: 1, perks: [] } });
    face(sim, 'right');
    const far = dummy(sim, 30, 50);
    const before = { ...sim.ecs.need(far, Body) };
    const charged = weapons.types.hammer.charged;
    const events = hold(
      sim,
      weapons.types.hammer.chain[0]!.activeFrom + charged.chargeTicks + 1,
      charged.duration,
    );
    const after = sim.ecs.need(far, Body);
    const pb = sim.ecs.need(sim.player, Body);
    expect(Math.hypot(after.x - pb.x, after.y - pb.y)).toBeLessThan(
      Math.hypot(before.x - pb.x, before.y - pb.y),
    );
    expect(damageTo(events, far)).toHaveLength(1);
  });
});

describe('lunges', () => {
  it('stop short of a foe in front instead of walking into it', () => {
    const sim = newSim();
    face(sim, 'right');
    const foe = spawnNear(sim, 'hollow', 14, 0);
    sim.ecs.remove(foe, Ai);
    const events = tap(sim, 20);
    expect(damageTo(events, foe)).toHaveLength(1);
    expect(ofType(events, 'damaged').filter((d) => d.isPlayer)).toHaveLength(0);
  });
});

describe('charged stamina', () => {
  it('a charged attack costs several light swings, and the perk takes a share off', () => {
    const cost = (perk: number) => {
      const sim = newSim();
      wield(sim, 'iron_sword', {
        gear: {
          tier: 'rare',
          power: 10,
          seed: 1,
          perks: perk ? [{ perk: 'chargedStamina', value: perk }] : [],
        },
      });
      const def = weapons.types.sword;
      const light = moveNumbers(sim, def.chain[0]).staminaCost;
      return { light, charged: moveNumbers(sim, def.charged).staminaCost };
    };
    const plain = cost(0);
    expect(plain.charged).toBeCloseTo(plain.light * weapons.types.sword.charged.stamina);
    expect(plain.charged).toBeGreaterThanOrEqual(plain.light * 3);
    expect(cost(0.25).charged).toBeCloseTo(plain.charged * 0.75);
  });
});

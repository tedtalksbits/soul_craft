import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/core/ecs';
import {
  Abilities,
  Ai,
  Bleed,
  Body,
  ContactDamage,
  Equipment,
  Facing,
  Health,
  Motion,
  Staggered,
  Stamina,
  Veiled,
  type ItemStack,
} from '../../src/sim/components';
import { rollGear } from '../../src/sim/modules/gear';
import { spawnDecoy, veil } from '../../src/sim/modules/stealth';
import { swingOf } from '../../src/sim/modules/weapons';
import type { Simulation } from '../../src/sim/simulation';
import { content, face, newSim, ofType, press, run, spawnNear } from '../helpers';

const daggers = content.weapons.types.daggers;
const sig = daggers.signature.type === 'flank' ? daggers.signature : undefined;

function wield(sim: Simulation, item = 'bone_daggers', extra: Partial<ItemStack> = {}): void {
  sim.ecs.need(sim.player, Equipment).weapon = { item, count: 1, level: 0, ...extra };
}

/** A foe that stands still facing `dir`, never hurts on touch, and takes a lot of killing. */
function dummy(sim: Simulation, dx: number, dy: number, dir: Facing['dir']): Entity {
  const e = spawnNear(sim, 'hollow', dx, dy);
  sim.ecs.remove(e, Ai);
  sim.ecs.remove(e, ContactDamage);
  sim.ecs.remove(e, Motion);
  sim.ecs.need(e, Facing).dir = dir;
  Object.assign(sim.ecs.need(e, Health), { hp: 9999, max: 9999 });
  return e;
}

const rules = (events: ReturnType<typeof run>) => ofType(events, 'weaponRule').map((r) => r.rule);
const hitsOn = (events: ReturnType<typeof run>, e: Entity) =>
  ofType(events, 'damaged').filter((d) => d.target === e);

/** Taps through `n` light moves in rhythm. */
function chain(sim: Simulation, n: number): ReturnType<typeof run> {
  const events: ReturnType<typeof run> = [];
  for (let i = 0; i < n; i++)
    events.push(...press(sim, ['attack'], daggers.chain[i % daggers.chain.length]!.duration));
  return events;
}

describe('twin daggers', () => {
  it('chain five quick hits', () => {
    const sim = newSim();
    wield(sim);
    const steps: number[] = [];
    for (const move of daggers.chain) {
      press(sim, ['attack'], 0);
      steps.push(swingOf(sim).step);
      run(sim, move.duration);
    }
    expect(steps).toEqual([0, 1, 2, 3, 4]);
  });

  it('crit from behind (Flank), and not from the front', () => {
    const behind = newSim();
    wield(behind);
    face(behind, 'right');
    // It faces right, away from the player on its left.
    const away = dummy(behind, 10, 0, 'right');
    const back = press(behind, ['attack'], daggers.chain[0]!.duration);
    expect(rules(back)).toContain('flank');
    expect(hitsOn(back, away)[0]?.crit).toBe(true);

    const front = newSim();
    wield(front);
    face(front, 'right');
    dummy(front, 10, 0, 'left');
    expect(rules(press(front, ['attack'], daggers.chain[0]!.duration))).not.toContain('flank');
  });

  it('stack Bleed that bursts at five, staggering', () => {
    const sim = newSim();
    wield(sim);
    face(sim, 'right');
    const foe = dummy(sim, 10, 0, 'left');
    const first = chain(sim, (sig?.bleed.stacks ?? 5) - 1);
    expect(rules(first)).not.toContain('bleed');
    expect(sim.ecs.get(foe, Bleed)?.stacks).toBe((sig?.bleed.stacks ?? 5) - 1);
    const burst = chain(sim, 1);
    expect(rules(burst)).toContain('bleed');
    expect(sim.ecs.has(foe, Bleed)).toBe(false);
    expect(sim.ecs.has(foe, Staggered)).toBe(true);
  });

  it('a Bleed lapses if the hits stop', () => {
    const sim = newSim();
    wield(sim);
    face(sim, 'right');
    const foe = dummy(sim, 10, 0, 'left');
    chain(sim, 2);
    run(sim, sig?.bleed.ticks ?? 180);
    expect(sim.ecs.has(foe, Bleed)).toBe(false);
  });

  it('a full charge lunges through the foe, untouched', () => {
    const sim = newSim();
    wield(sim);
    face(sim, 'right');
    const foe = spawnNear(sim, 'hollow', 16, 0);
    sim.ecs.remove(foe, Ai);
    sim.ecs.remove(foe, Motion);
    const events = press(sim, ['attack'], 0);
    const hold = { moveX: 0, moveY: 0, aim: null, pressed: 0, held: 1 };
    events.push(...run(sim, daggers.chain[0]!.activeFrom + daggers.charged.chargeTicks + 1, hold));
    events.push(...run(sim, daggers.charged.duration));
    expect(hitsOn(events, foe)).toHaveLength(1);
    expect(sim.ecs.need(sim.player, Body).x).toBeGreaterThan(sim.ecs.need(foe, Body).x);
    expect(ofType(events, 'damaged').filter((d) => d.isPlayer)).toHaveLength(0);
  });
});

describe('the Stalker with daggers', () => {
  it('turns a decoy into a Flank, even from the front', () => {
    const sim = newSim();
    sim.ecs.need(sim.player, Abilities).class = 'stalker';
    wield(sim);
    face(sim, 'right');
    dummy(sim, 10, 0, 'left');
    const pb = sim.ecs.need(sim.player, Body);
    spawnDecoy(sim, pb.x - 60, pb.y, 5);
    expect(rules(press(sim, ['attack'], daggers.chain[0]!.duration))).toContain('flank');
  });
});

describe('Twinfang', () => {
  it('keeps Vanish through the first strike and breaks it on the second', () => {
    const sim = newSim();
    wield(sim, 'twinfang', { gear: { tier: 'legendary', power: 1, seed: 1, perks: [] } });
    veil(sim, 10, 0.5);
    run(sim, 2);
    press(sim, ['attack'], daggers.chain[0]!.duration);
    expect(sim.ecs.has(sim.player, Veiled)).toBe(true);
    press(sim, ['attack'], daggers.chain[1]!.duration);
    expect(sim.ecs.has(sim.player, Veiled)).toBe(false);
  });
});

describe('dagger perks', () => {
  it('make every fifth swing free', () => {
    const sim = newSim();
    wield(sim, 'bone_daggers', {
      gear: { tier: 'rare', power: 1, seed: 1, perks: [{ perk: 'freeFifth', value: 1 }] },
    });
    const stamina = sim.ecs.need(sim.player, Stamina);
    const costs: number[] = [];
    for (let i = 0; i < 5; i++) {
      stamina.value = 100;
      stamina.delay = 999;
      press(sim, ['attack'], 0);
      costs.push(100 - stamina.value);
      run(sim, daggers.chain[i]!.duration);
    }
    expect(costs[4]).toBe(0);
    expect(costs.slice(0, 4).every((c) => c > 0)).toBe(true);
  });

  it('make bleeding foes take more from everything', () => {
    const hit = (bleeding: boolean) => {
      const sim = newSim();
      wield(sim, 'bone_daggers', {
        gear: { tier: 'rare', power: 1, seed: 1, perks: [{ perk: 'bleedVulnerability', value: 0.5 }] },
      });
      face(sim, 'right');
      const foe = dummy(sim, 10, 0, 'left');
      if (bleeding) sim.ecs.add(foe, Bleed, { stacks: 1, ticks: 999 });
      return hitsOn(press(sim, ['attack'], daggers.chain[0]!.duration), foe)[0]!.amount;
    };
    expect(hit(true)).toBeGreaterThan(hit(false));
  });

  it('roll only on daggers', () => {
    for (let seed = 1; seed <= 200; seed++)
      for (const p of rollGear(content, 'iron_sword', 'noble', 1, seed).gear!.perks)
        expect(content.loot.perks[p.perk]?.weaponTypes ?? ['sword']).not.toEqual(['daggers']);
  });
});

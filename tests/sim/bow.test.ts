import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/core/ecs';
import {
  Ai,
  Body,
  ContactDamage,
  Equipment,
  Health,
  Motion,
  Pinned,
  Player,
  Projectile,
  Staggered,
  Stamina,
  type ItemStack,
} from '../../src/sim/components';
import { Action, NO_INPUT, type InputFrame } from '../../src/sim/input';
import { swingOf } from '../../src/sim/modules/weapons';
import type { Simulation } from '../../src/sim/simulation';
import { content, face, newSim, ofType, press, run, spawnNear } from '../helpers';

const bow = content.weapons.types.bow;
const sig = bow.signature.type === 'pin' ? bow.signature : undefined;
const HOLD: InputFrame = { ...NO_INPUT, held: Action.attack };

function wield(sim: Simulation, item = 'ashwood_bow', extra: Partial<ItemStack> = {}): void {
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

const arrows = (sim: Simulation) => [...sim.ecs.query(Projectile)].filter(([, p]) => p.bow);
const hitsOn = (events: ReturnType<typeof run>, e: Entity) =>
  ofType(events, 'damaged').filter((d) => d.target === e);
const rules = (events: ReturnType<typeof run>) => ofType(events, 'weaponRule').map((r) => r.rule);

/** Draws the bow, lets go `t` ticks into the charge, and waits for the arrow to land. */
function drawAndLoose(sim: Simulation, t: number, after = 40): ReturnType<typeof run> {
  const events = run(sim, 1, { ...HOLD, pressed: Action.attack });
  events.push(...run(sim, bow.chain[0]!.activeFrom + t - 1, HOLD));
  events.push(...run(sim, after));
  return events;
}

describe('the bow', () => {
  it('a tap looses a quick arrow that lodges a pin', () => {
    const sim = newSim();
    wield(sim);
    face(sim, 'right');
    const foe = dummy(sim, 80, 0);
    const events = press(sim, ['attack'], 40);
    expect(hitsOn(events, foe)).toHaveLength(1);
    expect(sim.ecs.get(foe, Pinned)?.count).toBe(1);
    expect(arrows(sim)).toHaveLength(0);
  });

  it('holds at most so many pins', () => {
    const sim = newSim();
    wield(sim);
    face(sim, 'right');
    const foe = dummy(sim, 60, 0);
    for (let i = 0; i < (sig?.pins ?? 5) + 2; i++) press(sim, ['attack'], 30);
    expect(sim.ecs.get(foe, Pinned)?.count).toBe(sig?.pins);
  });

  it('drawing burns stamina, and an empty bar looses the arrow', () => {
    const sim = newSim();
    wield(sim);
    const stamina = sim.ecs.need(sim.player, Stamina);
    run(sim, 1, { ...HOLD, pressed: Action.attack });
    run(sim, bow.chain[0]!.activeFrom + 10, HOLD);
    expect(sim.ecs.need(sim.player, Player).state).toBe('charge');
    const drawn = stamina.value;
    run(sim, 10, HOLD);
    expect(stamina.value).toBeLessThan(drawn);
    stamina.value = 0;
    run(sim, 2, HOLD);
    expect(sim.ecs.need(sim.player, Player).state).toBe('attack');
  });

  it('a Perfect Shot pierces, staggers and rips out every pin', () => {
    const sim = newSim();
    wield(sim);
    face(sim, 'right');
    const first = dummy(sim, 50, 0);
    const second = dummy(sim, 90, 0);
    sim.ecs.add(first, Pinned, { count: 3, ticks: 999 });
    const events = drawAndLoose(sim, bow.charged.chargeTicks + 2);
    expect(swingOf(sim).perfect).toBe(true);
    expect(rules(events)).toEqual(expect.arrayContaining(['perfect', 'rip']));
    expect(hitsOn(events, second)).toHaveLength(1);
    expect(sim.ecs.has(first, Staggered)).toBe(true);
    expect(sim.ecs.has(first, Pinned)).toBe(false);
  });

  it('a full draw held past the window is strong but not Perfect', () => {
    const sim = newSim();
    wield(sim);
    face(sim, 'right');
    const first = dummy(sim, 50, 0);
    const second = dummy(sim, 90, 0);
    const events = drawAndLoose(sim, bow.charged.chargeTicks + (sig?.window ?? 6) + 2);
    expect(swingOf(sim)).toMatchObject({ move: 'charged', charge: 1, perfect: false });
    expect(hitsOn(events, first)).toHaveLength(1);
    expect(hitsOn(events, second)).toHaveLength(0);
  });

  it('shoots backward out of a roll, stepping away', () => {
    const sim = newSim();
    wield(sim);
    face(sim, 'right');
    press(sim, ['roll'], 12);
    const before = sim.ecs.need(sim.player, Body).x;
    press(sim, ['attack'], content.player.roll.duration);
    expect(swingOf(sim).move).toBe('dash');
    expect(sim.ecs.need(sim.player, Body).x).toBeLessThan(before + 30);
    expect(arrows(sim)).toHaveLength(1);
  });
});

describe('bow perks', () => {
  it('split a charged shot in three', () => {
    const sim = newSim();
    wield(sim, 'ashwood_bow', perked([{ perk: 'splitShot', value: 1 }]));
    face(sim, 'right');
    drawAndLoose(sim, bow.charged.chargeTicks + 10, bow.charged.activeFrom + 1);
    expect(arrows(sim)).toHaveLength(3);
  });

  it('kick a foe away from a quick shot up close', () => {
    const sim = newSim();
    wield(sim, 'ashwood_bow', perked([{ perk: 'bowKick', value: 1 }]));
    face(sim, 'right');
    const foe = spawnNear(sim, 'hollow', 14, 0);
    sim.ecs.remove(foe, Ai);
    const before = sim.ecs.need(foe, Body).x;
    press(sim, ['attack'], 10);
    expect(sim.ecs.need(foe, Body).x).toBeGreaterThan(before + 3);
  });

  it('make a shot out of a roll free', () => {
    const sim = newSim();
    wield(sim, 'ashwood_bow', perked([{ perk: 'freeDashShot', value: 1 }]));
    press(sim, ['roll'], 12);
    const stamina = sim.ecs.need(sim.player, Stamina);
    const before = stamina.value;
    press(sim, ['attack'], content.player.roll.duration - 12);
    expect(swingOf(sim).move).toBe('dash');
    expect(stamina.value).toBeGreaterThanOrEqual(before);
  });
});

describe('Pale Wind', () => {
  it('a Perfect Shot makes the next roll free', () => {
    const sim = newSim();
    wield(sim, 'pale_wind', { gear: { tier: 'legendary', power: 1, seed: 1, perks: [] } });
    drawAndLoose(sim, bow.charged.chargeTicks + 2);
    const stamina = sim.ecs.need(sim.player, Stamina);
    stamina.value = 60;
    stamina.delay = 999;
    press(sim, ['roll'], 0);
    expect(stamina.value).toBe(60);
    run(sim, content.player.roll.duration + 2);
    stamina.value = 60;
    press(sim, ['roll'], 0);
    expect(stamina.value).toBeLessThan(60);
  });
});

describe('arrows in flight', () => {
  it('hit a foe aimed at through its body, not only at its feet', () => {
    const sim = newSim();
    wield(sim);
    const foe = dummy(sim, 60, 0);
    const fb = sim.ecs.need(foe, Body);
    // Aimed at the torso, a body's height above its footprint, as a player aims at the sprite.
    const aim = { x: fb.x, y: fb.y - 10 };
    const events = run(sim, 1, { ...NO_INPUT, pressed: Action.attack, aim });
    events.push(...run(sim, 40, { ...NO_INPUT, aim }));
    expect(hitsOn(events, foe)).toHaveLength(1);
  });

  it('never skip a small foe at full speed', () => {
    const sim = newSim();
    wield(sim);
    face(sim, 'down');
    const foe = spawnNear(sim, 'slime', 0, 50);
    sim.ecs.remove(foe, Ai);
    sim.ecs.remove(foe, Motion);
    sim.ecs.remove(foe, ContactDamage);
    Object.assign(sim.ecs.need(foe, Health), { hp: 9999, max: 9999 });
    expect(hitsOn(drawAndLoose(sim, bow.charged.chargeTicks + 30), foe)).toHaveLength(1);
  });
});

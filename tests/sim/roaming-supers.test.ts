import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/core/ecs';
import {
  Abilities,
  Ai,
  Body,
  ContactDamage,
  Equipment,
  Health,
  Motion,
  Player,
  Projectile,
  Stamina,
  Veiled,
  Wielding,
} from '../../src/sim/components';
import { TICK_RATE } from '../../src/sim/constants';
import { Action, inputFrame, NO_INPUT } from '../../src/sim/input';
import { applyDamage, killEnemy } from '../../src/sim/modules/combat';
import { weaponType } from '../../src/sim/modules/weapons';
import type { Simulation } from '../../src/sim/simulation';
import { content, face, newSim, ofType, run, spawnNear } from '../helpers';

const bladestorm = content.ability('bladestorm');
const wield = bladestorm.effects.find((f) => f.type === 'wield');
if (wield?.type !== 'wield') throw new Error('Bladestorm wields the shade blades');
const blades = content.weapons.supers[wield.weapon]!;

/** A class holding `item`, its super charged and cast (by default a Stalker with a bow: the blades now in hand). */
function storming(cls = 'stalker', item = 'ashwood_bow'): Simulation {
  const sim = newSim();
  const a = sim.ecs.need(sim.player, Abilities);
  a.class = cls;
  a.unlocked = { class: true, super: true };
  a.energy = 100;
  sim.ecs.need(sim.player, Equipment).weapon = { item, count: 1, level: 0 };
  face(sim, 'right');
  const pb = sim.ecs.need(sim.player, Body);
  run(sim, 1, inputFrame({ press: ['super'], aim: { x: pb.x + 40, y: pb.y } }));
  run(sim, content.ability(content.playerClass(cls).abilities.super).cast.ticks);
  return sim;
}

/** A foe that stands still, never hurts on touch, and takes a lot of killing. */
function dummy(sim: Simulation, dx: number, dy: number, archetype = 'hollow'): Entity {
  const e = spawnNear(sim, archetype, dx, dy);
  sim.ecs.remove(e, Ai);
  sim.ecs.remove(e, ContactDamage);
  sim.ecs.remove(e, Motion);
  Object.assign(sim.ecs.need(e, Health), { hp: 99999, max: 99999 });
  return e;
}

const tap = (sim: Simulation, aim: { x: number; y: number } | null = null) => {
  const events = run(sim, 1, { ...NO_INPUT, pressed: Action.attack, aim });
  return events.concat(run(sim, 20));
};
const hitsOn = (events: ReturnType<typeof run>, e: Entity) =>
  ofType(events, 'damaged').filter((d) => d.target === e);

describe('Bladestorm, a roaming super', () => {
  it('puts the shade blades in hand even with a bow equipped: melee strikes, no arrows, no stamina', () => {
    const sim = storming();
    expect(sim.ecs.has(sim.player, Wielding)).toBe(true);
    expect(weaponType(sim).def.name).toBe(blades.name);
    const foe = dummy(sim, 18, 0);
    const stamina = sim.ecs.need(sim.player, Stamina).value;
    const events = tap(sim);
    expect(hitsOn(events, foe)).toHaveLength(1);
    expect([...sim.ecs.query(Projectile)]).toEqual([]);
    expect(sim.ecs.need(sim.player, Stamina).value).toBeGreaterThanOrEqual(stamina);
  });

  it('snaps each strike to a foe off to the side of the aim', () => {
    const sim = storming();
    const pb = sim.ecs.need(sim.player, Body);
    const foe = dummy(sim, 30, 14);
    // Aimed straight right; the foe sits about 25° below that line.
    expect(hitsOn(tap(sim, { x: pb.x + 60, y: pb.y }), foe)).toHaveLength(1);
  });

  it('takes less damage and never flinches', () => {
    const sim = storming();
    const health = sim.ecs.need(sim.player, Health);
    Object.assign(health, { hp: 500, max: 500 });
    const plain = newSim();
    const ph = plain.ecs.need(plain.player, Health);
    Object.assign(ph, { hp: 500, max: 500 });
    const blow = (s: Simulation) => {
      const b = s.ecs.need(s.player, Body);
      applyDamage(s, s.player, { amount: 100, crit: false, fromX: b.x + 1, fromY: b.y, knockback: 0 });
    };
    blow(sim);
    blow(plain);
    expect(500 - health.hp).toBeLessThan(500 - ph.hp);
    expect(500 - health.hp).toBeCloseTo((500 - ph.hp) * (1 - wield.resistance), -1);
    expect(sim.ecs.need(sim.player, Player).state).not.toBe('hurt');
  });

  it('does less to a boss, and its hits never charge the next super', () => {
    const sim = storming();
    const hollow = dummy(sim, 18, 0);
    const first = hitsOn(tap(sim), hollow)[0]!.amount;
    sim.ecs.destroy(hollow);
    const boss = dummy(sim, 18, 0, 'grub');
    sim.ecs.need(boss, Health).hp = 99999;
    const onBoss = hitsOn(tap(sim), boss)[0]!.amount;
    expect(onBoss).toBeLessThan(first);
    expect(sim.ecs.need(sim.player, Abilities).energy).toBe(0);
  });

  it('lasts its time plus a second a kill (to the cap), warns, then ends in a vanish', () => {
    const sim = storming();
    const w = sim.ecs.need(sim.player, Wielding);
    const before = w.ticks;
    for (let i = 0; i < 10; i++) killEnemy(sim, spawnNear(sim, 'slime', 60, 0));
    expect(w.ticks - before).toBe(Math.round(wield.maxBonus * TICK_RATE));
    const events = run(sim, w.ticks + 1);
    expect(ofType(events, 'wieldEnding')).toHaveLength(1);
    expect(ofType(events, 'wieldEnded')).toHaveLength(1);
    expect(sim.ecs.has(sim.player, Wielding)).toBe(false);
    expect(weaponType(sim).id).toBe('bow');
    expect(sim.ecs.has(sim.player, Veiled)).toBe(true);
  });
});

describe('Earthshatter and Cinder Storm, roaming supers', () => {
  it('Earthshatter gives a Vanguard the stone maul, whatever they hold, and ends in a slam', () => {
    const sim = storming('vanguard', 'ashwood_bow');
    expect(weaponType(sim).def.name).toBe(content.weapons.supers['stone_maul']!.name);
    expect(weaponType(sim).id).toBe('hammer');
    const foe = dummy(sim, 20, 0);
    expect(
      hitsOn(run(sim, 1, { ...NO_INPUT, pressed: Action.attack }).concat(run(sim, 30)), foe),
    ).toHaveLength(1);
    const w = sim.ecs.need(sim.player, Wielding);
    const end = run(sim, w.ticks + 1);
    expect(ofType(end, 'wieldEnded')).toHaveLength(1);
    expect(hitsOn(end, foe).length).toBeGreaterThan(0);
  });

  it('Cinder Storm gives an Ashcaller fire bolts at full strength, no Embers needed', () => {
    const sim = storming('ashcaller', 'iron_sword');
    expect(weaponType(sim).def.name).toBe(content.weapons.supers['cinder_stave']!.name);
    const foe = dummy(sim, 60, 0);
    const bolts = hitsOn(tap(sim).concat(run(sim, 30)), foe);
    expect(bolts).toHaveLength(1);
    // Not a weak spark: the full bolt, from the stave's base damage and ability power.
    const stave = content.weapons.supers['cinder_stave']!;
    expect(bolts[0]!.amount).toBeGreaterThanOrEqual(
      Math.floor(stave.base.damage * stave.chain[0]!.damage * 0.9),
    );
  });

  it('Cinder Storm’s held cinder ball bursts on what stands beside its mark', () => {
    const sim = storming('ashcaller', 'iron_sword');
    const near = dummy(sim, 60, 0);
    const beside = dummy(sim, 62, 24);
    const stave = content.weapons.supers['cinder_stave']!;
    const events = run(sim, 1, { ...NO_INPUT, pressed: Action.attack, held: Action.attack });
    events.push(
      ...run(sim, stave.chain[0]!.activeFrom + stave.charged.chargeTicks + 4, {
        ...NO_INPUT,
        held: Action.attack,
      }),
    );
    events.push(...run(sim, 60));
    expect(hitsOn(events, near).length).toBeGreaterThan(0);
    expect(hitsOn(events, beside).length).toBeGreaterThan(0);
  });
});

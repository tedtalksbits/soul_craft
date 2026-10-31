import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/core/ecs';
import { Abilities, Ambush, Blast, Body, Decoy, Staggered, Veiled } from '../../src/sim/components';
import { TICK_RATE } from '../../src/sim/constants';
import { inputFrame } from '../../src/sim/input';
import { applyDamage } from '../../src/sim/modules/combat';
import { enemyTarget } from '../../src/sim/modules/stealth';
import type { Simulation } from '../../src/sim/simulation';
import { content, newSim, ofType, press, run, spawnNear } from '../helpers';

/** A Stalker using `variant`, every slot awake, invulnerable unless a test says otherwise. */
function stalker(variant: string): Simulation {
  const sim = newSim();
  sim.state.cheats.god = true;
  sim.state.cheats.noclip = true;
  const a = sim.ecs.need(sim.player, Abilities);
  a.class = 'stalker';
  a.unlocked = { class: true, super: true };
  a.learned[variant] = true;
  a.chosen[content.baseAbility(variant)] = variant;
  return sim;
}

/** Holds an enemy still so the tests are about the trick, not the AI. */
function pinned(sim: Simulation, archetype: string, dx: number, dy = 0): Entity {
  const e = spawnNear(sim, archetype, dx, dy);
  sim.ecs.add(e, Staggered, { ticks: 1e6 });
  return e;
}

function castAt(sim: Simulation, key: 'aoe' | 'classAbility', x: number, y: number) {
  return run(sim, 1, inputFrame({ press: [key], aim: { x, y } }));
}

/** The one result of a query (fails the test if there is not exactly one). */
function only<T>(rows: Iterable<T>): T {
  const all = [...rows];
  expect(all).toHaveLength(1);
  return all[0]!;
}

function decoySeconds(id: string): number {
  const found = content.ability(id).effects.find((f) => f.type === 'decoy');
  if (found?.type !== 'decoy') throw new Error(`${id} leaves no decoy`);
  return found.seconds;
}

describe('Latch', () => {
  it('sticks to the enemy it lands near and bursts wherever that enemy went', () => {
    const sim = stalker('latch');
    const enemy = pinned(sim, 'hollow', 50);
    const eb = sim.ecs.need(enemy, Body);
    castAt(sim, 'aoe', eb.x, eb.y);
    run(sim, content.ability('latch').cast.release);
    const [charge, blast] = only(sim.ecs.query(Blast));
    expect(blast.stuck).toBe(enemy);

    // The enemy moves off; the charge goes with it.
    Object.assign(eb, { x: eb.x + 60, y: eb.y + 20 });
    run(sim, 1);
    expect(sim.ecs.need(charge, Body)).toMatchObject({ x: eb.x, y: eb.y });
    const events = run(sim, 60);
    expect(ofType(events, 'damaged').some((e) => e.target === enemy && e.ability === 'latch')).toBe(true);
  });

  it('falls to the ground if its enemy dies first', () => {
    const sim = stalker('latch');
    const enemy = pinned(sim, 'hollow', 50);
    const eb = sim.ecs.need(enemy, Body);
    castAt(sim, 'aoe', eb.x, eb.y);
    run(sim, content.ability('latch').cast.release);
    sim.ecs.destroy(enemy);
    run(sim, 1);
    const [, blast] = only(sim.ecs.query(Blast));
    expect(blast.stuck).toBeNull();
  });
});

describe('False Step', () => {
  it('leaves a decoy where the player stood, which enemies chase until it fades', () => {
    const sim = stalker('false_step');
    const start = { ...sim.ecs.need(sim.player, Body) };
    const enemy = pinned(sim, 'hollow', -40);
    castAt(sim, 'classAbility', start.x + 100, start.y);
    run(sim, 20);
    const [, , db] = only(sim.ecs.query(Decoy, Body));
    expect(db).toMatchObject({ x: start.x, y: start.y });
    const def = content.enemy('hollow');
    expect(enemyTarget(sim, def, sim.ecs.need(enemy, Body))).toMatchObject({
      x: start.x,
      y: start.y,
      sees: true,
    });

    const events = run(sim, decoySeconds('false_step') * TICK_RATE);
    expect([...sim.ecs.query(Decoy)]).toHaveLength(0);
    expect(ofType(events, 'decoyFaded')).toHaveLength(1);
  });

  it('does not fool a boss', () => {
    const sim = stalker('false_step');
    const pb = sim.ecs.need(sim.player, Body);
    castAt(sim, 'classAbility', pb.x + 100, pb.y);
    run(sim, 20);
    const near = { x: pb.x - 30, y: pb.y, w: 20, h: 20 };
    expect(enemyTarget(sim, content.enemy('ashen_warden'), near)).toMatchObject({ x: pb.x, y: pb.y });
  });
});

describe('Vanish', () => {
  function vanished() {
    const sim = stalker('vanish');
    const pb = sim.ecs.need(sim.player, Body);
    castAt(sim, 'classAbility', pb.x + 100, pb.y);
    run(sim, content.ability('vanish').cast.ticks + 2);
    expect(sim.ecs.has(sim.player, Veiled)).toBe(true);
    return sim;
  }

  it('hides the player from enemies unless they are close enough to touch', () => {
    const sim = vanished();
    const pb = sim.ecs.need(sim.player, Body);
    const def = content.enemy('hollow');
    expect(enemyTarget(sim, def, { x: pb.x + 60, y: pb.y, w: 10, h: 10 }).sees).toBe(false);
    expect(enemyTarget(sim, def, { x: pb.x + 10, y: pb.y, w: 10, h: 10 }).sees).toBe(true);
  });

  it('attacking breaks it into an ambush: double damage that gets past a shield', () => {
    const sim = vanished();
    press(sim, ['attack']);
    expect(sim.ecs.has(sim.player, Veiled)).toBe(false);
    expect(sim.ecs.has(sim.player, Ambush)).toBe(true);

    const knight = spawnNear(sim, 'knight', 30, 0);
    const kb = sim.ecs.need(knight, Body);
    const blow = { amount: 10, crit: false, fromX: kb.x - 10, fromY: kb.y, knockback: 0 };
    sim.events.drain();
    expect(applyDamage(sim, knight, blow)).toBe('hit');
    const dealt = ofType(sim.events.drain(), 'damaged').find((e) => e.target === knight);
    expect(dealt?.amount).toBe(20);
    // Used up: the next blow is blocked as usual.
    expect(applyDamage(sim, knight, blow)).toBe('blocked');
  });

  it('taking a hit breaks it', () => {
    const sim = vanished();
    sim.state.cheats.god = false;
    const pb = sim.ecs.need(sim.player, Body);
    applyDamage(sim, sim.player, { amount: 5, crit: false, fromX: pb.x + 5, fromY: pb.y, knockback: 0 });
    expect(sim.ecs.has(sim.player, Veiled)).toBe(false);
    expect(sim.ecs.has(sim.player, Ambush)).toBe(false);
  });
});

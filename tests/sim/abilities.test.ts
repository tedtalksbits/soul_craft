import { describe, expect, it } from 'vitest';
import {
  Abilities,
  Body,
  Bonfire,
  Empowered,
  Health,
  Player,
  Staggered,
  Stamina,
  Zone,
} from '../../src/sim/components';
import { TICK_RATE } from '../../src/sim/constants';
import { inputFrame, type ActionName } from '../../src/sim/input';
import { applyDamage } from '../../src/sim/modules/combat';
import { restAt } from '../../src/sim/modules/interaction';
import { playerStats } from '../../src/sim/modules/items';
import { Simulation } from '../../src/sim/simulation';
import { content, face, newSim, ofType, press, run, spawnNear } from '../helpers';

/** A fresh game as the given class, invulnerable so enemies can't interrupt casts. */
function asClass(cls: string): Simulation {
  const sim = newSim();
  sim.state.cheats.god = true;
  sim.state.cheats.noclip = true;
  sim.ecs.need(sim.player, Abilities).class = cls;
  return sim;
}

const abilities = (sim: Simulation) => sim.ecs.need(sim.player, Abilities);
const castTicks = (id: string) => content.ability(id).cast.ticks;

/** Presses an ability key aimed `dx` px to the player's right, then waits `after` ticks. */
function cast(sim: Simulation, key: ActionName, after: number, dx = 40) {
  const pb = sim.ecs.need(sim.player, Body);
  const events = run(sim, 1, inputFrame({ press: [key], aim: { x: pb.x + dx, y: pb.y } }));
  return events.concat(run(sim, after));
}

/** Holds an enemy still (as if staggered for ever) so area tests aren't about AI. */
function pin(sim: Simulation, archetype: string, dx: number, dy = 0) {
  const e = spawnNear(sim, archetype, dx, dy);
  sim.ecs.add(e, Staggered, { ticks: 1e6 });
  return e;
}

describe('classes', () => {
  it('a new game starts as the content start class, abilities ready, super empty', () => {
    const a = abilities(newSim());
    expect(a).toEqual({
      class: content.player.start.class,
      cooldowns: { aoe: 0, class: 0 },
      energy: 0,
      casting: null,
    });
  });

  it('a new game can start as any class, and refuses one that does not exist', () => {
    const sim = Simulation.create({ seed: 1, content, playerClass: 'ashcaller' });
    expect(abilities(sim).class).toBe('ashcaller');
    expect(() => Simulation.create({ seed: 1, content, playerClass: 'bard' })).toThrow(/Unknown class/);
  });

  it('only changes class while resting at a bonfire', () => {
    const sim = newSim();
    run(sim, 1, inputFrame({ actions: [{ type: 'setClass', class: 'stalker' }] }));
    expect(abilities(sim).class).toBe('vanguard');

    const [bonfire] = [...sim.ecs.query(Bonfire)][0] ?? [];
    if (bonfire === undefined) throw new Error('no bonfire loaded');
    restAt(sim, bonfire);
    const events = run(sim, 1, inputFrame({ actions: [{ type: 'setClass', class: 'stalker' }] }));
    expect(ofType(events, 'classChanged')).toEqual([{ type: 'classChanged', class: 'stalker' }]);
    expect(abilities(sim).class).toBe('stalker');
  });

  it('resting readies every ability but keeps earned super energy', () => {
    const sim = asClass('vanguard');
    cast(sim, 'aoe', castTicks('ground_slam'));
    abilities(sim).energy = 40;
    expect(abilities(sim).cooldowns.aoe).toBeGreaterThan(0);
    const [bonfire] = [...sim.ecs.query(Bonfire)][0] ?? [];
    if (bonfire === undefined) throw new Error('no bonfire loaded');
    restAt(sim, bonfire);
    expect(abilities(sim).cooldowns.aoe).toBe(0);
    expect(abilities(sim).energy).toBe(40);
  });
});

describe('AoE abilities', () => {
  it('Ground Slam hits and staggers what is around the player, then goes on cooldown', () => {
    const sim = asClass('vanguard');
    const near = pin(sim, 'hollow', 28);
    const far = pin(sim, 'hollow', 90);
    sim.ecs.remove(near, Staggered);
    const events = cast(sim, 'aoe', castTicks('ground_slam'));
    const hit = ofType(events, 'damaged').map((e) => e.target);
    expect(hit).toContain(near);
    expect(hit).not.toContain(far);
    expect(sim.ecs.has(near, Staggered)).toBe(true);
    expect(abilities(sim).cooldowns.aoe).toBeGreaterThan(10 * TICK_RATE);

    run(sim, 4); // the hit's hitstop holds the cast a few ticks longer
    const again = cast(sim, 'aoe', 2);
    expect(ofType(again, 'abilityNotReady')).toEqual([{ type: 'abilityNotReady', slot: 'aoe' }]);
  });

  it('a cast interrupted before its release costs nothing', () => {
    const sim = asClass('vanguard');
    sim.state.cheats.god = false;
    cast(sim, 'aoe', 2);
    const pb = sim.ecs.need(sim.player, Body);
    applyDamage(sim, sim.player, { amount: 5, crit: false, fromX: pb.x + 1, fromY: pb.y, knockback: 0 });
    const events = run(sim, castTicks('ground_slam'));
    expect(ofType(events, 'abilityUsed')).toEqual([]);
    expect(abilities(sim).cooldowns.aoe).toBe(0);
  });

  it('goes through the knight’s shield and staggers it, opening it to the sword', () => {
    const sim = asClass('vanguard');
    face(sim, 'right');
    const knight = spawnNear(sim, 'knight', 20, 0);
    const blocked = press(sim, ['attack'], 20);
    expect(ofType(blocked, 'blocked')).toHaveLength(1);

    const slam = cast(sim, 'aoe', castTicks('ground_slam'));
    expect(ofType(slam, 'damaged').some((e) => e.target === knight)).toBe(true);
    expect(sim.ecs.has(knight, Staggered)).toBe(true);

    const kb = sim.ecs.need(knight, Body);
    Object.assign(sim.ecs.need(sim.player, Body), { x: kb.x - 18, y: kb.y });
    face(sim, 'right');
    const sword = press(sim, ['attack'], 12);
    expect(ofType(sword, 'blocked')).toEqual([]);
    expect(ofType(sword, 'damaged').some((e) => e.target === knight)).toBe(true);
  });

  it('Ash Bomb lands at the cursor, capped at its range, and bursts after its fuse', () => {
    const sim = asClass('stalker');
    const def = content.ability('ash_bomb');
    const fx = def.effects[0];
    if (fx?.type !== 'blast') throw new Error('ash bomb is a blast');
    const target = pin(sim, 'hollow', fx.range);
    const early = cast(sim, 'aoe', def.cast.release + fx.fuse - 2, 400);
    expect(ofType(early, 'damaged')).toEqual([]);
    const burst = run(sim, 4);
    expect(ofType(burst, 'blast')).toHaveLength(1);
    expect(ofType(burst, 'damaged').some((e) => e.target === target)).toBe(true);
  });

  it('Fire Pot leaves burning ground that hurts on every interval, then goes out', () => {
    const sim = asClass('ashcaller');
    const target = pin(sim, 'knight', 50);
    const zoneFx = content.ability('fire_pot').effects.find((fx) => fx.type === 'zone');
    if (zoneFx?.type !== 'zone') throw new Error('fire pot leaves a zone');
    const events = cast(sim, 'aoe', castTicks('fire_pot') + zoneFx.delay + zoneFx.duration + 2, 50);
    const burns = ofType(events, 'damaged').filter((e) => e.target === target);
    // The burst, plus one burn at the start of the zone and one per interval after.
    expect(burns.length).toBe(1 + 1 + Math.floor(zoneFx.duration / zoneFx.interval));
    expect([...sim.ecs.query(Zone)]).toEqual([]);
  });
});

describe('class abilities', () => {
  it('Shadowstep carries the player its full distance, untouchable on the way', () => {
    const sim = asClass('stalker');
    sim.state.cheats.god = false;
    const pb = sim.ecs.need(sim.player, Body);
    const start = pb.x;
    const dash = content.ability('shadowstep');
    cast(sim, 'classAbility', dash.cast.release + 3, 100);
    const hit = { amount: 50, crit: false, fromX: pb.x - 5, fromY: pb.y, knockback: 0 };
    expect(applyDamage(sim, sim.player, hit)).toBe('ignored');
    run(sim, dash.cast.ticks);
    const fx = dash.effects[0];
    if (fx?.type !== 'dash') throw new Error('shadowstep is a dash');
    expect(pb.x - start).toBeCloseTo(fx.distance, 0);
  });

  it('Shield Charge staggers what it runs into', () => {
    const sim = asClass('vanguard');
    const target = spawnNear(sim, 'hollow', 30, 0);
    cast(sim, 'classAbility', castTicks('shield_charge'), 60);
    expect(sim.ecs.has(target, Staggered)).toBe(true);
  });
});

describe('supers', () => {
  it('need a full bar, which sword hits fill', () => {
    const sim = asClass('stalker');
    expect(ofType(cast(sim, 'super', 2), 'abilityNotReady')).toEqual([
      { type: 'abilityNotReady', slot: 'super' },
    ]);
    face(sim, 'right');
    const passive = content.player.energy.perSecond / TICK_RATE;
    const before = abilities(sim).energy;
    const hollow = spawnNear(sim, 'hollow', 16, 0);
    sim.ecs.add(hollow, Staggered, { ticks: 1e6 });
    press(sim, ['attack'], 20);
    expect(abilities(sim).energy - before).toBeGreaterThan(passive * 21);
  });

  it('Bladestorm makes swings free and harder for its duration, then ends', () => {
    const sim = asClass('stalker');
    abilities(sim).energy = 100;
    const base = playerStats(sim, sim.player).damage;
    const def = content.ability('bladestorm');
    const used = cast(sim, 'super', def.cast.ticks);
    expect(ofType(used, 'empowered')).toHaveLength(1);
    expect(abilities(sim).energy).toBeLessThan(1);
    expect(playerStats(sim, sim.player).damage).toBeCloseTo(base * 1.6);
    const stamina = sim.ecs.need(sim.player, Stamina).value;
    press(sim, ['attack'], 1);
    expect(sim.ecs.need(sim.player, Stamina).value).toBeGreaterThanOrEqual(stamina);
    const later = run(sim, 10 * TICK_RATE);
    expect(ofType(later, 'empowerEnded')).toHaveLength(1);
    expect(sim.ecs.has(sim.player, Empowered)).toBe(false);
  });

  it('Earthshatter halves the damage the player takes while it lasts', () => {
    const sim = asClass('vanguard');
    sim.state.cheats.god = false;
    abilities(sim).energy = 100;
    cast(sim, 'super', castTicks('earthshatter'));
    run(sim, 60);
    const pb = sim.ecs.need(sim.player, Body);
    applyDamage(sim, sim.player, { amount: 40, crit: false, fromX: pb.x + 1, fromY: pb.y, knockback: 0 });
    expect(sim.ecs.need(sim.player, Health).hp).toBe(100 - 20);
    expect(sim.ecs.need(sim.player, Player).state).toBe('hurt');
  });
});

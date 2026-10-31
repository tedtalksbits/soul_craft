import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/core/ecs';
import {
  Abilities,
  Body,
  Health,
  Invulnerable,
  Overshield,
  Player,
  Staggered,
  Veiled,
} from '../../src/sim/components';
import { TICK_RATE } from '../../src/sim/constants';
import { inputFrame, type PlayerAction } from '../../src/sim/input';
import { applyDamage } from '../../src/sim/modules/combat';
import { canWear, modifierSlots, wornModifiers } from '../../src/sim/modules/modifiers';
import type { Simulation } from '../../src/sim/simulation';
import { content, newSim, ofType, run, spawnNear } from '../helpers';

const act = (sim: Simulation, ...actions: PlayerAction[]) => run(sim, 1, inputFrame({ actions }));
const wear = (sim: Simulation, modifier: string, on = true) =>
  act(sim, { type: 'wearModifier', modifier, on });
const abilities = (sim: Simulation) => sim.ecs.need(sim.player, Abilities);
const player = (sim: Simulation) => sim.ecs.need(sim.player, Player);
const costOf = (id: string) => content.modifier(id).souls ?? 0;

/** A player of `cls` seated at a bonfire with `souls` to spend and every slot awake. */
function resting(cls: string, souls = 10_000): Simulation {
  const sim = newSim();
  const p = player(sim);
  p.state = 'sit';
  p.souls = souls;
  const a = abilities(sim);
  a.class = cls;
  a.unlocked = { class: true, super: true };
  return sim;
}

/** A player of `cls` already wearing `ids` (out in the world, not resting). */
function wearing(cls: string, ...ids: string[]): Simulation {
  const sim = newSim();
  sim.state.cheats.noclip = true;
  const a = abilities(sim);
  a.class = cls;
  a.unlocked = { class: true, super: true };
  a.modifiers[cls] = ids;
  return sim;
}

/** An enemy that stands still, with `hp` left. */
function dummy(sim: Simulation, dx: number, hp = 1): Entity {
  const e = spawnNear(sim, 'hollow', dx, 0);
  sim.ecs.add(e, Staggered, { ticks: 1e6 });
  sim.ecs.need(e, Health).hp = hp;
  return e;
}

function kill(sim: Simulation, e: Entity) {
  const b = sim.ecs.need(e, Body);
  return applyDamage(sim, e, { amount: 999, crit: false, fromX: b.x - 5, fromY: b.y, knockback: 0 });
}

describe('wearing modifiers', () => {
  it('learning one at a bonfire costs souls once; taking it off and on again is free', () => {
    const sim = resting('ashcaller');
    wear(sim, 'kindling');
    expect(wornModifiers(sim)).toEqual(['kindling']);
    expect(player(sim).souls).toBe(10_000 - costOf('kindling'));
    wear(sim, 'kindling', false);
    wear(sim, 'kindling');
    expect(wornModifiers(sim)).toEqual(['kindling']);
    expect(player(sim).souls).toBe(10_000 - costOf('kindling'));
  });

  it('fits only as many as there are slots, and a defeated Warden opens another', () => {
    const sim = resting('ashcaller');
    expect(modifierSlots(sim)).toBe(content.modifiers.slots.base);
    wear(sim, 'kindling');
    wear(sim, 'quick_flame');
    expect(canWear(sim, 'ember_heart', true)).toEqual({ ok: false, reason: 'no free slot' });

    sim.state.bossesDefeated['ashen_warden'] = true;
    expect(modifierSlots(sim)).toBe(content.modifiers.slots.base + content.modifiers.slots.perWarden);
    wear(sim, 'ember_heart');
    expect(wornModifiers(sim)).toHaveLength(3);
  });

  it("a Warden's modifier is free, but only once that Warden has fallen", () => {
    const sim = resting('ashcaller', 0);
    expect(canWear(sim, 'wardens_pyre', true).ok).toBe(false);
    sim.state.bossesDefeated['ashen_warden'] = true;
    expect(canWear(sim, 'wardens_pyre', true)).toEqual({ ok: true, cost: 0 });
  });

  it('needs a bonfire, the souls, and a modifier of your own class', () => {
    const away = resting('ashcaller');
    player(away).state = 'free';
    expect(canWear(away, 'kindling', true).ok).toBe(false);
    expect(canWear(resting('ashcaller', costOf('kindling') - 1), 'kindling', true).ok).toBe(false);
    expect(canWear(resting('ashcaller'), 'opportunist', true).ok).toBe(false);
  });

  it('each class keeps its own', () => {
    const sim = resting('ashcaller');
    wear(sim, 'kindling');
    abilities(sim).class = 'stalker';
    expect(wornModifiers(sim)).toEqual([]);
    abilities(sim).class = 'ashcaller';
    expect(wornModifiers(sim)).toEqual(['kindling']);
  });
});

describe('modifier effects', () => {
  it('a cooldown modifier readies its slot sooner', () => {
    const sim = wearing('stalker', 'light_feet');
    const pb = sim.ecs.need(sim.player, Body);
    run(sim, 1, inputFrame({ press: ['classAbility'], aim: { x: pb.x + 50, y: pb.y } }));
    run(sim, content.ability('shadowstep').cast.release);
    const full = Math.round(content.ability('shadowstep').cooldown * TICK_RATE);
    expect(abilities(sim).cooldowns.class).toBeLessThanOrEqual(Math.round(full * 0.75));
  });

  it('Kindling: a kill inside your fire takes time off the pot, a kill outside does not', () => {
    const sim = wearing('ashcaller', 'kindling');
    const inside = dummy(sim, 40);
    const outside = dummy(sim, -60);
    const ib = sim.ecs.need(inside, Body);
    run(sim, 1, inputFrame({ press: ['aoe'], aim: { x: ib.x, y: ib.y } }));
    run(sim, content.ability('fire_pot').cast.release);
    const a = abilities(sim);

    let before = a.cooldowns.aoe;
    kill(sim, outside);
    expect(a.cooldowns.aoe).toBe(before);
    before = a.cooldowns.aoe;
    kill(sim, inside);
    expect(a.cooldowns.aoe).toBe(before - 3 * TICK_RATE);
  });

  it('Iron Will: blows taken fill the super, even ones an overshield soaks', () => {
    const sim = wearing('vanguard', 'iron_will');
    sim.ecs.add(sim.player, Overshield, { hp: 100, ticks: 600 });
    const pb = sim.ecs.need(sim.player, Body);
    sim.ecs.remove(sim.player, Invulnerable);
    applyDamage(sim, sim.player, { amount: 20, crit: false, fromX: pb.x + 5, fromY: pb.y, knockback: 0 });
    expect(abilities(sim).energy).toBeGreaterThan(0);
  });

  it('Braced Charge: the class ability leaves the player shielded', () => {
    const sim = wearing('vanguard', 'braced_charge');
    const pb = sim.ecs.need(sim.player, Body);
    run(sim, 1, inputFrame({ press: ['classAbility'], aim: { x: pb.x + 50, y: pb.y } }));
    run(sim, content.ability('shield_charge').cast.release);
    expect(sim.ecs.get(sim.player, Overshield)?.hp).toBe(20);
  });

  it('Opportunist: a blow out of hiding lands harder still', () => {
    const sim = wearing('stalker', 'opportunist');
    abilities(sim).chosen['shadowstep'] = 'vanish';
    const pb = sim.ecs.need(sim.player, Body);
    run(sim, 1, inputFrame({ press: ['classAbility'], aim: { x: pb.x + 50, y: pb.y } }));
    run(sim, content.ability('vanish').cast.ticks);
    expect(sim.ecs.need(sim.player, Veiled).bonus).toBe(1 + 0.75);
  });

  it("Warden's Resolve: kills heal", () => {
    const sim = wearing('vanguard', 'wardens_resolve');
    const health = sim.ecs.need(sim.player, Health);
    health.hp = 20;
    const events = (kill(sim, dummy(sim, 30)), sim.events.drain());
    expect(health.hp).toBe(26);
    expect(ofType(events, 'healed')).toHaveLength(1);
  });

  it('wears nothing unless worn', () => {
    const sim = wearing('vanguard');
    const health = sim.ecs.need(sim.player, Health);
    health.hp = 20;
    kill(sim, dummy(sim, 30));
    expect(health.hp).toBe(20);
  });
});

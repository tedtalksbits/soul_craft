import { describe, expect, it } from 'vitest';
import { TIERS, type TierId } from '../../src/content/schemas';
import {
  Abilities,
  Body,
  Equipment,
  Health,
  Invulnerable,
  Overshield,
  Player,
  Stamina,
  Zone,
  type ItemStack,
} from '../../src/sim/components';
import { TICK_RATE } from '../../src/sim/constants';
import { applyDamage } from '../../src/sim/modules/combat';
import { gearTotals, legendaryPower, rollDrop, rollGear } from '../../src/sim/modules/gear';
import { flaskCapacity } from '../../src/sim/modules/items';
import { ambushBonus, modifiedCooldown } from '../../src/sim/modules/modifiers';
import { onRest, onWeaponHit } from '../../src/sim/modules/perks';
import { respawnPlayer } from '../../src/sim/modules/player';
import type { Simulation } from '../../src/sim/simulation';
import { content, newSim, ofType, press, run, spawnNear, unarmored } from '../helpers';

const { loot } = content;
const eq = (sim: Simulation) => sim.ecs.need(sim.player, Equipment);
const health = (sim: Simulation) => sim.ecs.need(sim.player, Health);

function made(item: string, tier: TierId, perks: { perk: string; value: number }[] = []): ItemStack {
  return { item, count: 1, level: 0, gear: { tier, ilvl: 1, seed: 7, perks } };
}

/** A blow to the player from just above, after clearing any grace period. */
function hit(sim: Simulation, amount: number): void {
  sim.ecs.remove(sim.player, Invulnerable);
  const pb = sim.ecs.need(sim.player, Body);
  applyDamage(sim, sim.player, { amount, crit: false, fromX: pb.x, fromY: pb.y - 1, knockback: 0 });
}

const seeds = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('rolls', () => {
  it('rolls Greater perks only on Noble and better, about one in twenty', () => {
    const noble = seeds(400).flatMap((s) => rollGear(content, 'iron_sword', 'noble', 1, s).gear!.perks);
    const share = noble.filter((p) => p.greater).length / noble.length;
    expect(share).toBeGreaterThan(loot.greater.chance / 2);
    expect(share).toBeLessThan(loot.greater.chance * 2);
    const rare = seeds(400).flatMap((s) => rollGear(content, 'iron_sword', 'rare', 1, s).gear!.perks);
    expect(rare.some((p) => p.greater)).toBe(false);
  });

  it('Blights a few Rare-or-better drops with one drawback that takes its stat away', () => {
    const drops = seeds(1500).map((s) => rollDrop(content, 'rare', 1, s));
    const blighted = drops.filter((d) => d.gear?.blighted);
    expect(blighted.length / drops.length).toBeGreaterThan(loot.blight.chance / 2);
    expect(blighted.length / drops.length).toBeLessThan(loot.blight.chance * 2);
    for (const d of blighted) {
      const drawbacks = d.gear!.perks.filter((p) => loot.perks[p.perk]?.drawback);
      expect(drawbacks).toHaveLength(1);
    }
    expect(seeds(1500).some((s) => rollDrop(content, 'standard', 1, s).gear?.blighted)).toBe(false);
    // A drawback lowers what it names.
    const frail = made('iron_mail', 'rare', [{ perk: 'frail', value: 10 }]);
    expect(gearTotals(content, { ...eq(newSim()), chest: frail }).maxHp).toBe(-10);
  });

  it('never rolls a drawback as a normal perk, or a perk below its tier', () => {
    for (const s of seeds(300)) {
      for (const p of rollGear(content, 'ring_of_vigor', 'rare', 1, s).gear!.perks) {
        expect(loot.perks[p.perk]?.drawback).toBe(false);
        expect(p.perk).not.toBe('flaskCharges'); // Noble and better
      }
      for (const p of rollGear(content, 'iron_greaves', 'standard', 1, s).gear!.perks)
        expect(p.perk).not.toBe('rollIframes'); // Rare and better
    }
  });

  it('favors class perks for the class being played', () => {
    const classPerks = (cls: string | null) =>
      seeds(600)
        .flatMap((s) => rollGear(content, 'ring_of_vigor', 'noble', 1, s, cls).gear!.perks)
        .map((p) => loot.perks[p.perk]?.class)
        .filter((c) => c !== undefined);
    const vanguard = classPerks('vanguard');
    expect(vanguard.filter((c) => c === 'vanguard').length / vanguard.length).toBeGreaterThan(0.75);
    const none = classPerks(null);
    expect(none.filter((c) => c === 'vanguard').length / none.length).toBeLessThan(0.5);
  });
});

describe('no doubled perks', () => {
  it('never rolls a perk the base already carries', () => {
    for (const item of ['cinderbrand', 'ring_of_the_last_ember', 'padded_jacket', 'ashen_hood']) {
      const def = content.item(item);
      const innate = 'innate' in def ? def.innate.map((r) => r.perk) : [];
      for (const s of seeds(200))
        for (const p of rollGear(content, item, 'legendary', 1, s).gear!.perks)
          expect(innate).not.toContain(p.perk);
    }
  });
});

describe('Legendaries', () => {
  it('drop as a Legendary base with its power, its partner perk and three rolled perks', () => {
    for (const s of seeds(60)) {
      const drop = rollDrop(content, 'legendary', 1, s);
      const power = legendaryPower(content, drop);
      expect(power).toBeDefined();
      const def = content.item(drop.item);
      expect('innate' in def && def.innate.length).toBe(1);
      const rolled = drop.gear!.perks.filter((p) => !loot.perks[p.perk]?.drawback);
      expect(rolled).toHaveLength(loot.tiers.legendary.perks);
    }
  });

  it('never drop below Legendary', () => {
    for (const tier of TIERS.filter((t) => t !== 'legendary'))
      for (const s of seeds(200))
        expect(legendaryPower(content, rollDrop(content, tier, 1, s))).toBeUndefined();
  });
});

describe('effect perks share the modifier hooks', () => {
  it('a weapon’s kill heal closes wounds on a kill', () => {
    const sim = newSim();
    eq(sim).weapon = made('iron_sword', 'standard', [{ perk: 'killHeal', value: 1 }]);
    health(sim).hp = 50;
    const enemy = spawnNear(sim, 'hollow', 20, 0);
    const pb = sim.ecs.need(sim.player, Body);
    applyDamage(sim, enemy, { amount: 999, crit: false, fromX: pb.x, fromY: pb.y, knockback: 0 });
    expect(health(sim).hp).toBe(54);
  });

  it('a helmet shortens a cooldown', () => {
    const sim = newSim();
    const before = modifiedCooldown(sim, 'class', 10);
    eq(sim).helmet = made('iron_helm', 'standard', [{ perk: 'classCooldown', value: 1 }]);
    expect(modifiedCooldown(sim, 'class', 10)).toBe(Math.round(before * 0.88));
  });

  it('a class perk works only for its own class', () => {
    const sim = newSim();
    eq(sim).ring0 = made('ring_of_vigor', 'standard', [{ perk: 'ambush', value: 1 }]);
    expect(ambushBonus(sim)).toBe(0);
    sim.ecs.need(sim.player, Abilities).class = 'stalker';
    expect(ambushBonus(sim)).toBeCloseTo(0.25);
  });
});

describe('chest and leg perks', () => {
  it('a rest shield goes up when resting', () => {
    const sim = newSim();
    eq(sim).chest = made('iron_mail', 'standard', [{ perk: 'restShield', value: 1 }]);
    onRest(sim);
    expect(sim.ecs.get(sim.player, Overshield)?.hp).toBe(20);
  });

  it('poise shrugs off one flinch, then waits its turn', () => {
    const sim = unarmored(newSim());
    eq(sim).chest = made('iron_mail', 'standard', [{ perk: 'poise', value: 1 }]);
    hit(sim, 10);
    expect(sim.ecs.need(sim.player, Player).state).toBe('free');
    hit(sim, 10);
    expect(sim.ecs.need(sim.player, Player).state).toBe('hurt');
  });

  it('extra i-frames make a roll safe for longer', () => {
    const base = content.player.roll.iframesTo - content.player.roll.iframesFrom + 1;
    const sim = newSim();
    eq(sim).legs = made('iron_greaves', 'rare', [{ perk: 'rollIframes', value: 2 }]);
    press(sim, ['roll'], content.player.roll.iframesFrom);
    expect(sim.ecs.get(sim.player, Invulnerable)?.ticks).toBe(base + 2 - 1);
  });

  it('a flask charge perk fills one more flask at each refill', () => {
    const sim = newSim();
    const before = flaskCapacity(sim);
    eq(sim).ring0 = made('ring_of_vigor', 'noble', [{ perk: 'flaskCharges', value: 1 }]);
    respawnPlayer(sim);
    expect(sim.ecs.need(sim.player, Player).flasks).toBe(before + 1);
  });
});

describe('Legendary powers', () => {
  it('the Last Ember catches one killing blow per rest', () => {
    const sim = newSim();
    eq(sim).ring0 = made('ring_of_the_last_ember', 'legendary');
    hit(sim, 9999);
    expect(health(sim).hp).toBe(1);
    expect(sim.ecs.need(sim.player, Player).state).not.toBe('dead');
    expect(sim.ecs.need(sim.player, Stamina).value).toBe(sim.ecs.need(sim.player, Stamina).max);
    hit(sim, 9999);
    expect(sim.ecs.need(sim.player, Player).state).toBe('dead');

    const again = newSim();
    eq(again).ring0 = made('ring_of_the_last_ember', 'legendary');
    hit(again, 9999);
    onRest(again);
    health(again).hp = health(again).max;
    hit(again, 9999);
    expect(health(again).hp).toBe(1);
  });

  it('Last Coal shields you once you fall below a third', () => {
    const sim = unarmored(newSim());
    eq(sim).chest = made('pyreheart_cuirass', 'legendary');
    health(sim).hp = health(sim).max / 2;
    hit(sim, Math.ceil(health(sim).max * 0.25));
    expect(sim.ecs.get(sim.player, Overshield)?.hp).toBe(40);
  });

  it('Ashwalk gives back a roll’s stamina when the roll takes a blow', () => {
    const sim = newSim();
    eq(sim).legs = made('ashwalker_greaves', 'legendary');
    const stamina = sim.ecs.need(sim.player, Stamina);
    press(sim, ['roll'], content.player.roll.iframesFrom + 1);
    const after = stamina.value;
    const pb = sim.ecs.need(sim.player, Body);
    const events: unknown[] = [];
    for (let i = 0; i < 2; i++)
      applyDamage(sim, sim.player, { amount: 10, crit: false, fromX: pb.x, fromY: pb.y - 1, knockback: 0 });
    events.push(...sim.events.drain());
    expect(stamina.value).toBeGreaterThan(after);
    expect(ofType(events as never[], 'dodged')).toHaveLength(1);
  });

  it('Kindled Edge sets the ground alight every third hit in a row', () => {
    const sim = newSim();
    eq(sim).weapon = made('cinderbrand', 'legendary');
    const enemy = spawnNear(sim, 'hollow', 20, 0);
    const zones = () => [...sim.ecs.query(Zone)].length;
    onWeaponHit(sim, enemy);
    onWeaponHit(sim, enemy);
    expect(zones()).toBe(0);
    onWeaponHit(sim, enemy);
    expect(zones()).toBe(1);
    // A streak that lapses starts over.
    onWeaponHit(sim, enemy);
    run(sim, 2 * TICK_RATE);
    onWeaponHit(sim, enemy);
    onWeaponHit(sim, enemy);
    expect(zones()).toBe(1);
  });

  it('Vigil charges the super while you stand still', () => {
    const sim = newSim();
    eq(sim).helmet = made('crown_of_the_unforgotten', 'legendary');
    const a = sim.ecs.need(sim.player, Abilities);
    a.unlocked.super = true;
    a.energy = 0;
    run(sim, TICK_RATE);
    expect(a.energy).toBeGreaterThan(2.5);
    const moving = a.energy;
    run(sim, TICK_RATE, { moveX: 1, moveY: 0, aim: null, pressed: 0, held: 0 });
    expect(a.energy - moving).toBeLessThan(0.5);
  });
});

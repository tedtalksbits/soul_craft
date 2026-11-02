import { describe, expect, it } from 'vitest';
import { TIERS, type TierId } from '../../src/content/schemas';
import { gearSlotOf } from '../../src/content/content';
import {
  Body,
  Equipment,
  Health,
  Inventory,
  Pickup,
  Player,
  Stamina,
  type ItemStack,
} from '../../src/sim/components';
import { inputFrame, type PlayerAction } from '../../src/sim/input';
import { applyDamage, killEnemy } from '../../src/sim/modules/combat';
import { rollDrop, rollGear, rollTier, weaponNumbers } from '../../src/sim/modules/gear';
import { addItem, addStack, compareGear, playerStats } from '../../src/sim/modules/items';
import { playerPower } from '../../src/sim/modules/power';
import { dropPickup } from '../../src/sim/modules/pickups';
import type { Simulation } from '../../src/sim/simulation';
import { content, newSim, ofType, press, run, spawnNear } from '../helpers';

const act = (sim: Simulation, ...actions: PlayerAction[]) => run(sim, 1, inputFrame({ actions }));
const eq = (sim: Simulation) => sim.ecs.need(sim.player, Equipment);
const stacks = (sim: Simulation) => sim.ecs.need(sim.player, Inventory).stacks;
const { loot } = content;

/** A piece of gear with exactly the given perks. */
function made(item: string, tier: TierId, perks: { perk: string; value: number }[], power = 10): ItemStack {
  return { item, count: 1, level: 0, gear: { tier, power, seed: 7, perks } };
}

describe('a new character', () => {
  it('starts in Common gear on every slot but the rings, at the starting Power (the empty rings count 0)', () => {
    const sim = newSim();
    const worn = eq(sim);
    expect([worn.weapon?.item, worn.helmet?.item, worn.chest?.item, worn.legs?.item]).toEqual(
      content.player.start.gear,
    );
    expect([worn.ring0, worn.ring1]).toEqual([null, null]);
    expect(playerPower(sim)).toBe(Math.floor((4 * loot.power.start) / 6));
    // The jacket's innate +10 max HP is there from the first tick.
    expect(sim.ecs.need(sim.player, Health)).toMatchObject({ hp: 110, max: 110 });
  });
});

describe('rolling gear', () => {
  it('rolls a tier’s number of different perks, all of which fit the slot', () => {
    for (const tier of TIERS) {
      for (const item of ['iron_sword', 'iron_helm', 'iron_mail', 'iron_greaves', 'ring_of_vigor']) {
        const gear = rollGear(content, item, tier, 3, 99).gear!;
        expect(gear.perks).toHaveLength(loot.tiers[tier].perks);
        expect(new Set(gear.perks.map((p) => p.perk)).size).toBe(gear.perks.length);
        const slot = gearSlotOf(content.item(item))!;
        for (const p of gear.perks) expect(loot.perks[p.perk]?.slots).toContain(slot);
      }
    }
  });

  it('lands each perk within its spread of the target for the tier, whatever its Power', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const item of ['iron_sword', 'iron_helm', 'iron_mail', 'iron_greaves', 'ring_of_breath']) {
        for (const p of rollGear(content, item, 'noble', seed * 20, seed).gear!.perks) {
          const def = loot.perks[p.perk]!;
          if (def.fixed) {
            expect(p.value).toBe(def.value);
            continue;
          }
          // A Greater perk is that much stronger again.
          const greater = p.greater ? loot.greater.factor : 1;
          const target = def.value * loot.tiers.noble.perkStrength * greater;
          const [lo, hi] = [target * (1 - loot.perkSpread), target * (1 + loot.perkSpread)];
          if (def.integer) {
            expect(p.value).toBeGreaterThanOrEqual(Math.max(1, Math.round(lo)));
            expect(p.value).toBeLessThanOrEqual(Math.round(hi));
          } else {
            expect(p.value).toBeGreaterThanOrEqual(lo - 0.001);
            expect(p.value).toBeLessThanOrEqual(hi + 0.001);
          }
        }
      }
    }
  });

  it('makes the same item from the same seed, and a different one from another', () => {
    expect(rollDrop(content, 'rare', 2, 1234)).toEqual(rollDrop(content, 'rare', 2, 1234));
    const many = new Set(
      Array.from({ length: 20 }, (_, i) => JSON.stringify(rollDrop(content, 'rare', 2, i + 1))),
    );
    expect(many.size).toBeGreaterThan(15);
  });

  it('never drops the Firekeeper’s own sword', () => {
    for (let seed = 1; seed <= 200; seed++)
      expect(rollDrop(content, 'common', 1, seed).item).not.toBe('chipped_sword');
  });

  it('scales base numbers by tier, never by Power (Power is checked against the foe instead)', () => {
    const rare = weaponNumbers(content, made('iron_sword', 'rare', [], 10))!;
    expect(rare.damage).toBe(Math.round(16 * loot.tiers.rare.stats));
    expect(weaponNumbers(content, made('iron_sword', 'rare', [], 900))!.damage).toBe(rare.damage);
    expect(weaponNumbers(content, { item: 'iron_sword', count: 1, level: 0 })!.damage).toBe(16);
  });
});

describe('the armor curve', () => {
  it('cuts hits to k / (k + Armor), and never by more than the cap', () => {
    const sim = newSim();
    const k = content.player.armor.k;
    const { armor, defense } = playerStats(sim, sim.player);
    expect(defense).toBeCloseTo(1 - k / (k + armor));

    eq(sim).chest = made('iron_mail', 'legendary', [{ perk: 'armor', value: 1000 }]);
    expect(playerStats(sim, sim.player).defense).toBe(content.player.armor.cap);
    const health = sim.ecs.need(sim.player, Health);
    const before = health.hp;
    const pb = sim.ecs.need(sim.player, Body);
    applyDamage(sim, sim.player, { amount: 40, crit: false, fromX: pb.x, fromY: pb.y - 1, knockback: 0 });
    expect(health.hp).toBe(before - 40 * (1 - content.player.armor.cap));
  });
});

describe('equipping', () => {
  it('keeps a piece of gear’s rolls on and off', () => {
    const sim = newSim();
    const sword = made('iron_sword', 'noble', [
      { perk: 'damage', value: 0.1 },
      { perk: 'critChance', value: 0.06 },
      { perk: 'souls', value: 0.12 },
    ]);
    addStack(sim, sim.player, structuredClone(sword));
    act(sim, { type: 'equip', index: 0 });
    expect(eq(sim).weapon).toEqual(sword);
    act(sim, { type: 'unequip', slot: 'weapon' });
    expect(stacks(sim).find((s) => s.item === 'iron_sword')).toEqual(sword);
  });

  it('fills a free ring slot before replacing a ring', () => {
    const sim = newSim();
    addItem(sim, sim.player, 'ring_of_vigor', 1);
    addItem(sim, sim.player, 'ring_of_breath', 1);
    act(sim, { type: 'equip', index: 0 });
    act(sim, { type: 'equip', index: 0 });
    expect([eq(sim).ring0?.item, eq(sim).ring1?.item]).toEqual(['ring_of_vigor', 'ring_of_breath']);
  });
});

describe('Power and comparisons', () => {
  it('rises with higher-Power gear, ignores buffs, and is worked out without touching the player', () => {
    const sim = newSim();
    addStack(sim, sim.player, made('iron_sword', 'rare', [{ perk: 'damage', value: 0.1 }], 70));
    const before = JSON.stringify(eq(sim));
    const c = compareGear(sim, 0)!;
    expect(JSON.stringify(eq(sim))).toBe(before);
    expect(c.slot).toBe('weapon');
    expect(c.replaces?.item).toBe('chipped_sword');
    expect(c.after.damage).toBeGreaterThan(c.now.damage);
    expect(c.after.power).toBeGreaterThan(c.now.power);

    act(sim, { type: 'equip', index: 0 });
    expect(playerPower(sim)).toBe(c.after.power);
    addItem(sim, sim.player, 'ember_tonic', 1);
    act(sim, { type: 'use', item: 'ember_tonic' });
    run(sim, content.player.flask.duration);
    expect(playerPower(sim)).toBe(c.after.power);
  });

  it('follows each piece’s Power, not its stats: a stronger chest at lower Power lowers it', () => {
    const sim = newSim();
    addStack(sim, sim.player, made('iron_mail', 'noble', [{ perk: 'maxHp', value: 30 }], 1));
    const c = compareGear(sim, 0)!;
    expect(c.after.armor).toBeGreaterThan(c.now.armor);
    expect(c.after.defense).toBeGreaterThan(c.now.defense);
    expect(c.after.power).toBeLessThan(c.now.power);
  });
});

describe('perks at work', () => {
  it('souls perks raise souls from kills', () => {
    const sim = newSim();
    eq(sim).weapon = made('iron_sword', 'standard', [{ perk: 'souls', value: 0.5 }]);
    const souls = sim.ecs.need(sim.player, Player).souls;
    killEnemy(sim, spawnNear(sim, 'hollow', 30, 0));
    expect(sim.ecs.need(sim.player, Player).souls - souls).toBe(
      Math.round(content.enemies.hollow!.souls * 1.5),
    );
  });

  it('roll perks make rolls cheaper', () => {
    const sim = newSim();
    const cost = playerStats(sim, sim.player).rollStamina;
    expect(cost).toBeCloseTo(content.player.roll.staminaCost * (1 - 0.08)); // the wraps' innate
    const stamina = sim.ecs.need(sim.player, Stamina);
    const before = stamina.value;
    press(sim, ['roll'], 0);
    expect(before - stamina.value).toBeCloseTo(cost);
  });

  it('healing perks strengthen flasks', () => {
    const sim = newSim();
    eq(sim).ring0 = made('ring_of_vigor', 'standard', [{ perk: 'healing', value: 0.5 }]);
    const health = sim.ecs.need(sim.player, Health);
    health.max = 500;
    health.hp = 100;
    press(sim, ['heal'], content.player.flask.duration);
    expect(health.hp).toBe(100 + Math.round(content.player.flask.heal * 1.5));
  });
});

describe('drops', () => {
  it('an elite always drops gear of Standard or better', () => {
    const sim = newSim();
    for (let i = 0; i < 5; i++) killEnemy(sim, spawnNear(sim, 'knight', 40, 0));
    const gear = [...sim.ecs.query(Pickup)].flatMap(([, p]) => (p.gear ? [p.gear] : []));
    expect(gear).toHaveLength(5);
    for (const g of gear) expect(g.tier).not.toBe('common');
  });

  it('comes good after a long run of lesser drops', () => {
    const sim = newSim();
    sim.state.lootPity = loot.pity.after;
    const tier = rollTier(sim, 'regular');
    expect(TIERS.indexOf(tier)).toBeGreaterThanOrEqual(TIERS.indexOf(loot.pity.tier));
    expect(sim.state.lootPity).toBe(0);
    sim.state.lootPity = 3;
    // A regular table mostly rolls below Noble, which counts toward the next pity.
    const rolls = Array.from({ length: 30 }, () => rollTier(sim, 'regular'));
    const lesser = rolls.findIndex((t) => TIERS.indexOf(t) < TIERS.indexOf(loot.pity.tier));
    expect(lesser).toBeGreaterThanOrEqual(0);
  });

  it('is picked up with its rolls', () => {
    const sim = newSim();
    const pb = sim.ecs.need(sim.player, Body);
    const sword = made('bone_cleaver', 'legendary', [{ perk: 'damage', value: 0.2 }], 5);
    dropPickup(sim, 'item', 1, pb.x, pb.y, sword.item, sword.gear ?? null);
    const events = run(sim, 40);
    expect(ofType(events, 'itemGained')).toEqual([
      { type: 'itemGained', item: 'bone_cleaver', count: 1, tier: 'legendary' },
    ]);
    expect(stacks(sim)).toEqual([sword]);
  });
});

describe('crafting gear is gone', () => {
  it('no recipe makes a weapon, armor or ring', () => {
    for (const r of Object.values(content.recipes))
      expect(gearSlotOf(content.item(r.output.item))).toBeNull();
  });
});

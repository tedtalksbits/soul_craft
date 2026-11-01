import { describe, expect, it } from 'vitest';
import {
  Attributes,
  Body,
  Equipment,
  Inventory,
  Player,
  Station,
  type ItemStack,
} from '../../src/sim/components';
import { inputFrame, type PlayerAction } from '../../src/sim/input';
import { armorValue } from '../../src/sim/modules/gear';
import { addStack, countItem, playerStats } from '../../src/sim/modules/items';
import { dropPickup } from '../../src/sim/modules/pickups';
import { levelCost, playerLevel } from '../../src/sim/modules/progression';
import { temperCost } from '../../src/sim/modules/smithy';
import type { Simulation } from '../../src/sim/simulation';
import type { TierId } from '../../src/content/schemas';
import { content, newSim, ofType, run } from '../helpers';

const act = (sim: Simulation, ...actions: PlayerAction[]) => run(sim, 1, inputFrame({ actions }));
const inv = (sim: Simulation) => sim.ecs.need(sim.player, Inventory);
const player = (sim: Simulation) => sim.ecs.need(sim.player, Player);
const smithy = content.loot.smithy;

function atForge(sim: Simulation): void {
  const found = [...sim.ecs.query(Station, Body)].find(([, s]) => s.station === 'forge');
  if (!found) throw new Error('no forge loaded');
  const pb = sim.ecs.need(sim.player, Body);
  pb.x = found[2].x;
  pb.y = found[2].y + 14;
}

function made(
  item: string,
  tier: TierId,
  perks: { perk: string; value: number }[] = [],
  extra: Partial<ItemStack> = {},
): ItemStack {
  return { item, count: 1, level: 0, gear: { tier, ilvl: 1, seed: 11, perks }, ...extra };
}

describe('salvage', () => {
  it('breaks gear into its slot’s materials by tier, at the forge', () => {
    const sim = newSim();
    atForge(sim);
    addStack(
      sim,
      sim.player,
      made('iron_sword', 'rare', [
        { perk: 'damage', value: 0.1 },
        { perk: 'souls', value: 0.1 },
      ]),
    );
    const events = act(sim, { type: 'salvage', index: 0 });
    expect(ofType(events, 'salvaged')).toHaveLength(1);
    const [a, b] = smithy.salvage.materials.weapon;
    expect(countItem(inv(sim), a)).toBe(smithy.salvage.yields.rare[0]);
    expect(countItem(inv(sim), b)).toBe(smithy.salvage.yields.rare[1]);
    expect(inv(sim).stacks.some((s) => s.item === 'iron_sword')).toBe(false);
    // Never souls.
    expect(player(sim).souls).toBe(0);
  });

  it('a Legendary gives up a Warden Mark', () => {
    const sim = newSim();
    atForge(sim);
    addStack(sim, sim.player, made('cinderbrand', 'legendary'));
    act(sim, { type: 'salvage', index: 0 });
    expect(countItem(inv(sim), smithy.salvage.mark)).toBe(1);
  });

  it('needs the forge or a bonfire, and leaves locked gear alone', () => {
    const sim = newSim();
    sim.ecs.need(sim.player, Body).x += 600;
    run(sim, 2);
    addStack(sim, sim.player, made('iron_helm', 'standard'));
    const away = act(sim, { type: 'salvage', index: 0 });
    expect(ofType(away, 'craftFailed')[0]?.reason).toMatch(/forge or a bonfire/);
    player(sim).state = 'sit';
    act(sim, { type: 'mark', index: 0, mark: 'lock' });
    expect(ofType(act(sim, { type: 'salvage', index: 0 }), 'craftFailed')[0]?.reason).toBe('it is locked');
    act(sim, { type: 'mark', index: 0, mark: null });
    expect(ofType(act(sim, { type: 'salvage', index: 0 }), 'salvaged')).toHaveLength(1);
  });

  it('salvaging junk skips locked, Noble and Legendary pieces', () => {
    const sim = newSim();
    atForge(sim);
    addStack(sim, sim.player, made('iron_helm', 'common', [], { junk: true }));
    addStack(sim, sim.player, made('iron_mail', 'standard', [], { junk: true, locked: true }));
    addStack(sim, sim.player, made('iron_greaves', 'noble', [], { junk: true }));
    addStack(sim, sim.player, made('ring_of_vigor', 'rare'));
    act(sim, { type: 'salvageJunk' });
    expect(
      inv(sim)
        .stacks.map((s) => s.item)
        .filter((i) => content.items[i]?.kind !== 'material'),
    ).toEqual(['iron_mail', 'iron_greaves', 'ring_of_vigor']);
  });

  it('auto-salvages the tiers the player picks, as they are picked up', () => {
    const sim = newSim();
    act(sim, { type: 'autoSalvage', tier: 'common', on: true });
    const pb = sim.ecs.need(sim.player, Body);
    dropPickup(sim, 'item', 1, pb.x, pb.y, 'iron_helm', { tier: 'common', ilvl: 1, seed: 1, perks: [] });
    dropPickup(sim, 'item', 1, pb.x, pb.y, 'iron_mail', { tier: 'rare', ilvl: 1, seed: 1, perks: [] });
    run(sim, 40);
    const gear = inv(sim).stacks.filter((s) => s.gear);
    expect(gear.map((s) => s.item)).toEqual(['iron_mail']);
    expect(countItem(inv(sim), smithy.salvage.materials.armor[0])).toBe(smithy.salvage.yields.common[0]);
    // Only the lowest tiers can be set.
    act(sim, { type: 'autoSalvage', tier: 'legendary', on: true });
    expect(sim.state.autoSalvage).toEqual(['common']);
  });
});

describe('upgrades and infusing', () => {
  it('armor upgrades at the forge add Armor', () => {
    const sim = newSim();
    atForge(sim);
    const eq = sim.ecs.need(sim.player, Equipment);
    const before = armorValue(content, eq.chest!);
    const step =
      content.items['padded_jacket']?.kind === 'armor'
        ? content.items['padded_jacket'].upgrades[0]!
        : undefined;
    player(sim).souls = 1000;
    for (const c of step!.items) dropPickupless(sim, c.item, c.count);
    act(sim, { type: 'upgradeGear', target: { slot: 'chest' } });
    expect(eq.chest!.level).toBe(1);
    expect(armorValue(content, eq.chest!)).toBe(before + step!.armor);
    expect(playerStats(sim, sim.player).armor).toBeGreaterThan(0);
  });

  it('infusing moves an old piece’s upgrades onto a new one for a share of their cost', () => {
    const sim = newSim();
    atForge(sim);
    const eq = sim.ecs.need(sim.player, Equipment);
    eq.weapon!.level = 2;
    addStack(sim, sim.player, made('iron_sword', 'noble'));
    player(sim).souls = 1000;
    for (const item of ['iron_scrap', 'bone_shard', 'stone']) dropPickupless(sim, item, 20);
    const events = act(sim, {
      type: 'infuse',
      from: { slot: 'weapon' },
      to: { pack: inv(sim).stacks.findIndex((s) => s.item === 'iron_sword') },
    });
    expect(ofType(events, 'infused')).toHaveLength(1);
    expect(eq.weapon!.level).toBe(0);
    const sword = inv(sim).stacks.find((s) => s.item === 'iron_sword')!;
    expect(sword.level).toBe(2);
    const steps =
      content.items['chipped_sword']?.kind === 'weapon' ? content.items['chipped_sword'].upgrades : [];
    const souls = Math.ceil((steps[0]!.souls + steps[1]!.souls) * smithy.infuse);
    expect(player(sim).souls).toBe(1000 - souls);
  });
});

describe('tempering', () => {
  const rare = () =>
    made('iron_sword', 'rare', [
      { perk: 'damage', value: 0.1 },
      { perk: 'souls', value: 0.1 },
    ]);

  /** At the forge with the smith back, `stack` in pack slot 0, and souls and bone shards to spare. */
  function ready(stack: ItemStack = rare()): Simulation {
    const sim = newSim();
    atForge(sim);
    sim.state.restored['smithy'] = true;
    player(sim).souls = 5000;
    addStack(sim, sim.player, stack);
    dropPickupless(sim, 'bone_shard', 40);
    return sim;
  }

  it('needs the smith back', () => {
    const sim = newSim();
    atForge(sim);
    addStack(sim, sim.player, rare());
    const events = act(sim, { type: 'temper', target: { pack: 0 }, perk: 0 });
    expect(ofType(events, 'craftFailed')[0]?.reason).toBe('the smith is not back yet');
  });

  it('offers two new perks, and the choice replaces the old one or keeps it', () => {
    const sim = ready();
    act(sim, { type: 'temper', target: { pack: 0 }, perk: 0 });
    const gear = inv(sim).stacks[0]!.gear!;
    expect(gear.offer?.rolls).toHaveLength(2);
    for (const roll of gear.offer!.rolls) expect(['damage', 'souls']).not.toContain(roll.perk);
    const pick = gear.offer!.rolls[1]!;
    act(sim, { type: 'settleTemper', target: { pack: 0 }, choice: 2 });
    expect(gear.perks[0]).toEqual(pick);
    expect(gear.offer).toBeUndefined();
  });

  it('only the perk tempered first can be tempered again, and each temper costs more', () => {
    const sim = ready();
    const stack = inv(sim).stacks[0]!;
    const first = temperCost(sim, stack).souls;
    act(sim, { type: 'temper', target: { pack: 0 }, perk: 0 });
    act(sim, { type: 'settleTemper', target: { pack: 0 }, choice: 0 });
    expect(temperCost(sim, stack).souls).toBe(Math.round(first * (1 + smithy.temper.growth)));
    const other = act(sim, { type: 'temper', target: { pack: 0 }, perk: 1 });
    expect(ofType(other, 'craftFailed')[0]?.reason).toMatch(/only the perk tempered before/);
  });

  it('rolls from the item’s own seed, so the same item tempers the same way', () => {
    const offers = () => {
      const sim = ready();
      act(sim, { type: 'temper', target: { pack: 0 }, perk: 0 });
      return inv(sim).stacks[0]!.gear!.offer;
    };
    expect(offers()?.rolls).toHaveLength(2);
    expect(offers()).toEqual(offers());
  });

  it('cleansing burns off the drawback and keeps the rest', () => {
    const sim = ready(
      made('iron_mail', 'rare', [
        { perk: 'armor', value: 4 },
        { perk: 'frail', value: 10 },
      ]),
    );
    dropPickupless(sim, 'glowspore', 5);
    inv(sim).stacks[0]!.gear!.blighted = true;
    const index = 0;
    act(sim, { type: 'cleanse', target: { pack: index } });
    const gear = inv(sim).stacks.find((s) => s.item === 'iron_mail')!.gear!;
    expect(gear.blighted).toBeUndefined();
    expect(gear.perks).toEqual([{ perk: 'armor', value: 4 }]);
  });
});

describe('respec', () => {
  it('gives back every point to spend again for free, for the souls of one level', () => {
    const sim = newSim();
    const attrs = sim.ecs.need(sim.player, Attributes);
    Object.assign(attrs, { vigor: 3, might: 2 });
    const level = playerLevel(attrs);
    const cost = levelCost(sim);
    player(sim).state = 'sit';
    player(sim).souls = cost;
    const events = act(sim, { type: 'respec' });
    expect(ofType(events, 'respecced')[0]?.points).toBe(5);
    expect(attrs).toMatchObject({ vigor: 0, might: 0, unspent: 5 });
    expect(playerLevel(attrs)).toBe(level);
    expect(player(sim).souls).toBe(0);
    act(sim, { type: 'levelUp', attribute: 'endurance' });
    expect(attrs).toMatchObject({ endurance: 1, unspent: 4 });
    expect(player(sim).souls).toBe(0);
  });

  it('only while resting', () => {
    const sim = newSim();
    sim.ecs.need(sim.player, Attributes).vigor = 2;
    player(sim).souls = 99999;
    act(sim, { type: 'respec' });
    expect(sim.ecs.need(sim.player, Attributes).vigor).toBe(2);
  });
});

/** Puts materials straight into the pack, in full stacks. */
function dropPickupless(sim: Simulation, item: string, count: number): void {
  const max = content.item(item).stack;
  for (let n = count; n > 0; n -= max) inv(sim).stacks.push({ item, count: Math.min(max, n), level: 0 });
}

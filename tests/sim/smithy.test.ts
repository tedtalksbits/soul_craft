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
import { inputFrame, type GearTarget, type PlayerAction } from '../../src/sim/input';
import { armorValue } from '../../src/sim/modules/gear';
import { addStack, countItem, playerStats } from '../../src/sim/modules/items';
import { dropPickup } from '../../src/sim/modules/pickups';
import { levelCost, playerLevel } from '../../src/sim/modules/progression';
import { junkYield, temperCost } from '../../src/sim/modules/smithy';
import { stashOf } from '../../src/sim/modules/storage';
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
  return { item, count: 1, level: 0, gear: { tier, power: 1, seed: 11, perks }, ...extra };
}

describe('salvage', () => {
  it('breaks gear into its slot’s materials by tier', () => {
    const sim = newSim();
    addStack(
      sim,
      sim.player,
      made('iron_sword', 'rare', [
        { perk: 'damage', value: 0.1 },
        { perk: 'souls', value: 0.1 },
      ]),
    );
    const events = act(sim, { type: 'salvage', target: { pack: 0 } });
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
    act(sim, { type: 'salvage', target: { pack: 0 } });
    expect(countItem(inv(sim), smithy.salvage.mark)).toBe(1);
  });

  it('works anywhere, but never on a locked or worn piece', () => {
    const sim = newSim();
    sim.ecs.need(sim.player, Body).x += 600;
    run(sim, 2);
    addStack(sim, sim.player, made('iron_helm', 'standard'));
    act(sim, { type: 'mark', target: { pack: 0 }, mark: 'lock' });
    const locked = act(sim, { type: 'salvage', target: { pack: 0 } });
    expect(ofType(locked, 'craftFailed')[0]?.reason).toBe('it is locked');
    act(sim, { type: 'mark', target: { pack: 0 }, mark: null });
    expect(ofType(act(sim, { type: 'salvage', target: { pack: 0 } }), 'salvaged')).toHaveLength(1);
    const worn = act(sim, { type: 'salvage', target: { slot: 'chest' } });
    expect(ofType(worn, 'craftFailed')[0]?.reason).toBe('take it off first');
  });

  it('dismantling all junk skips locked pieces and Legendaries, and Noble ones unless asked', () => {
    const gearLeft = (sim: Simulation) =>
      inv(sim)
        .stacks.map((s) => s.item)
        .filter((i) => content.items[i]?.kind !== 'material');
    const setUp = () => {
      const sim = newSim();
      addStack(sim, sim.player, made('iron_helm', 'common', [], { junk: true }));
      addStack(sim, sim.player, made('iron_mail', 'standard', [], { junk: true, locked: true }));
      addStack(sim, sim.player, made('iron_greaves', 'noble', [], { junk: true }));
      addStack(sim, sim.player, made('cinderbrand', 'legendary', [], { junk: true }));
      addStack(sim, sim.player, made('ring_of_vigor', 'rare'));
      return sim;
    };
    const plain = setUp();
    expect(junkYield(plain).pieces).toBe(1);
    act(plain, { type: 'salvageJunk' });
    expect(gearLeft(plain)).toEqual(['iron_mail', 'iron_greaves', 'cinderbrand', 'ring_of_vigor']);
    const noble = setUp();
    act(noble, { type: 'salvageJunk', includeNoble: true });
    expect(gearLeft(noble)).toEqual(['iron_mail', 'cinderbrand', 'ring_of_vigor']);
  });

  it('dismantles stashed junk too, where the stash opens', () => {
    const sim = newSim();
    stashOf(sim).push(made('iron_helm', 'common', [], { junk: true }));
    act(sim, { type: 'salvageJunk' });
    expect(stashOf(sim)).toHaveLength(1);
    player(sim).state = 'sit';
    sim.state.checkpoint = { id: `${content.world.origin.prefab}@origin#0,0`, x: 0, y: 0 };
    act(sim, { type: 'salvageJunk' });
    expect(stashOf(sim)).toEqual([]);
  });

  it('auto-junk marks Common and Standard pieces below your best for their slot as they come in', () => {
    const sim = newSim();
    act(sim, { type: 'autoJunk', on: true });
    const pb = sim.ecs.need(sim.player, Body);
    // The worn hood is Power 10.
    dropPickup(sim, 'item', 1, pb.x, pb.y, 'iron_helm', { tier: 'common', power: 5, seed: 1, perks: [] });
    dropPickup(sim, 'item', 1, pb.x, pb.y, 'iron_helm', { tier: 'common', power: 50, seed: 2, perks: [] });
    dropPickup(sim, 'item', 1, pb.x, pb.y, 'iron_helm', { tier: 'rare', power: 5, seed: 3, perks: [] });
    run(sim, 40);
    const helms = inv(sim).stacks.filter((s) => s.item === 'iron_helm');
    expect(helms.map((s) => [s.gear?.power, s.gear?.tier, s.junk === true])).toEqual([
      [5, 'common', true],
      [50, 'common', false],
      [5, 'rare', false],
    ]);
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

  it('infusing raises a favorite to a stronger piece’s Power, using that piece up, for a flat price', () => {
    const sim = newSim();
    const eq = sim.ecs.need(sim.player, Equipment);
    eq.weapon!.level = 2;
    addStack(
      sim,
      sim.player,
      made('iron_sword', 'rare', [], { gear: { tier: 'rare', power: 214, seed: 3, perks: [] } }),
    );
    player(sim).souls = 1000;
    dropPickupless(sim, 'bone_shard', 5);
    const away = act(sim, { type: 'infuse', from: { pack: 0 }, to: { slot: 'weapon' } });
    expect(ofType(away, 'craftFailed')[0]?.reason).toBe('infuse at a bonfire');
    player(sim).state = 'sit';
    const events = act(sim, {
      type: 'infuse',
      from: { pack: inv(sim).stacks.findIndex((s) => s.item === 'iron_sword') },
      to: { slot: 'weapon' },
    });
    expect(ofType(events, 'infused')).toEqual([
      { type: 'infused', from: 'iron_sword', to: 'chipped_sword', power: 214 },
    ]);
    // The favorite keeps everything else: its upgrades, its tier.
    expect(eq.weapon).toMatchObject({
      item: 'chipped_sword',
      level: 2,
      gear: { power: 214, tier: 'common' },
    });
    expect(inv(sim).stacks.some((s) => s.item === 'iron_sword')).toBe(false);
    expect(player(sim).souls).toBe(1000 - smithy.infuse.souls);
    expect(countItem(inv(sim), 'bone_shard')).toBe(5 - smithy.infuse.items[0]!.count);
  });

  it('won’t infuse from a weaker, locked or worn piece, or across slots', () => {
    const sim = newSim();
    player(sim).state = 'sit';
    player(sim).souls = 1000;
    dropPickupless(sim, 'bone_shard', 5);
    addStack(
      sim,
      sim.player,
      made('iron_sword', 'rare', [], { gear: { tier: 'rare', power: 5, seed: 3, perks: [] } }),
    );
    addStack(
      sim,
      sim.player,
      made('iron_helm', 'rare', [], { gear: { tier: 'rare', power: 300, seed: 4, perks: [] } }),
    );
    addStack(
      sim,
      sim.player,
      made('bone_cleaver', 'rare', [], {
        locked: true,
        gear: { tier: 'rare', power: 300, seed: 5, perks: [] },
      }),
    );
    const at = (item: string) => ({ pack: inv(sim).stacks.findIndex((s) => s.item === item) });
    const reason = (from: GearTarget, to: GearTarget) =>
      ofType(act(sim, { type: 'infuse', from, to }), 'craftFailed')[0]?.reason;
    expect(reason(at('iron_sword'), { slot: 'weapon' })).toBe('it has no more Power');
    expect(reason(at('iron_helm'), { slot: 'weapon' })).toBe('only from gear of the same slot');
    expect(reason(at('bone_cleaver'), { slot: 'weapon' })).toBe('it is locked');
    expect(reason({ slot: 'weapon' }, at('iron_sword'))).toBe('take it off first');
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

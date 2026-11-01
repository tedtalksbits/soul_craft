/**
 * Gear as loot (docs/gear-and-loot.md): tiers, item levels, perks and drops.
 *
 * A piece of gear is a base from items.json plus its `Gear` rolls. Base numbers (damage, Armor, innate
 * perks) are never stored: they follow from the base, the tier and the item level, so tuning content
 * re-tunes every copy. Rolled perks keep the value they rolled. Every roll after the tier comes from
 * the item's own seed, so the same seed always makes the same item.
 */
import { gearSlotOf, type Content } from '../../content/content';
import {
  PerkStatSchema,
  TIERS,
  type GearSlot,
  type PerkDef,
  type PerkStat,
  type TierId,
} from '../../content/schemas';
import { Rng } from '../../core/rng';
import type { Equipment, Gear, ItemStack, PerkRoll } from '../components';
import { TILE } from '../constants';
import type { Simulation } from '../simulation';
import { dropPickup } from './pickups';

/** What gear without rolls counts as: the starting kit, and anything from the `item` dev command. */
const COMMON: Readonly<Gear> = { tier: 'common', ilvl: 1, seed: 0, perks: [] };

export function gearOf(stack: ItemStack): Readonly<Gear> {
  return stack.gear ?? COMMON;
}

function levelScale(content: Content, ilvl: number): number {
  return 1 + content.loot.itemLevelGrowth * (ilvl - 1);
}

/** How much the tier and item level multiply a base's own numbers (damage, Armor, innate perks). */
export function statScale(content: Content, gear: Readonly<Gear>): number {
  return content.loot.tiers[gear.tier].stats * levelScale(content, gear.ilvl);
}

export interface WeaponNumbers {
  damage: number;
  staminaCost: number;
  reach: number;
  width: number;
  knockback: number;
}

/** A weapon's swing after tier, item level and forge upgrades; null for anything else. */
export function weaponNumbers(content: Content, stack: ItemStack): WeaponNumbers | null {
  const def = content.items[stack.item];
  if (def?.kind !== 'weapon') return null;
  const upgrades = def.upgrades.slice(0, stack.level).reduce((n, u) => n + u.damage, 0);
  const damage = Math.round(def.weapon.damage * statScale(content, gearOf(stack))) + upgrades;
  return { ...def.weapon, damage };
}

/** A helmet's, chest's or legs' own Armor (perks not included); 0 for anything else. */
export function armorValue(content: Content, stack: ItemStack): number {
  const def = content.items[stack.item];
  if (def?.kind !== 'armor') return 0;
  return Math.max(1, Math.round(def.armor.value * statScale(content, gearOf(stack))));
}

function rounded(def: PerkDef, value: number): number {
  return def.integer ? Math.max(1, Math.round(value)) : Math.round(value * 1000) / 1000;
}

export interface PerkLine {
  perk: string;
  stat: PerkStat;
  value: number;
  /** Fixed on every copy of the base, rather than rolled. */
  innate: boolean;
}

/** Every perk on a piece of gear, innate ones first, at their real strength. */
export function perkLines(content: Content, stack: ItemStack): PerkLine[] {
  const def = content.items[stack.item];
  if (def?.kind !== 'weapon' && def?.kind !== 'armor' && def?.kind !== 'ring') return [];
  const gear = gearOf(stack);
  const scale = statScale(content, gear);
  const line = (roll: PerkRoll, innate: boolean, value: number): PerkLine[] => {
    const perk = content.loot.perks[roll.perk];
    return perk ? [{ perk: roll.perk, stat: perk.stat, value: rounded(perk, value), innate }] : [];
  };
  return [
    ...def.innate.flatMap((roll) => line(roll, true, roll.value * scale)),
    ...gear.perks.flatMap((roll) => line(roll, false, roll.value)),
  ];
}

/** "+8% damage", "+2 Vigor": a perk's text with its value filled in. */
export function perkText(content: Content, line: { perk: string; value: number }): string {
  const def = content.loot.perks[line.perk];
  if (!def) return line.perk;
  const value = def.integer ? String(line.value) : `${Math.round(line.value * 100)}%`;
  return def.text.replace('{v}', value);
}

export type GearTotals = Record<PerkStat, number>;

/** Everything worn, added up per stat. `armor` includes each armor piece's own Armor. */
export function gearTotals(content: Content, eq: Equipment | undefined): GearTotals {
  // Every stat present, so callers can read any of them.
  const totals = Object.fromEntries(PerkStatSchema.options.map((stat) => [stat, 0])) as GearTotals;
  const add = (stat: PerkStat, n: number) => (totals[stat] += n);
  for (const stack of [eq?.weapon, eq?.ring0, eq?.ring1, eq?.helmet, eq?.chest, eq?.legs]) {
    if (!stack) continue;
    add('armor', armorValue(content, stack));
    for (const line of perkLines(content, stack)) add(line.stat, line.value);
  }
  return totals;
}

/**
 * Rolls a piece of gear of a given base. The perks come from the seed: a tier's worth of different
 * perks from the slot's pool, each within `perkSpread` of its target for the item level and tier.
 */
export function rollGear(
  content: Content,
  item: string,
  tier: TierId,
  ilvl: number,
  seed: number,
): ItemStack {
  return withRolls(content, new Rng(seed), item, tier, ilvl, seed);
}

function withRolls(
  content: Content,
  rng: Rng,
  item: string,
  tier: TierId,
  ilvl: number,
  seed: number,
): ItemStack {
  const slot = gearSlotOf(content.item(item));
  const { loot } = content;
  const pool = Object.entries(loot.perks).filter(([, p]) => slot !== null && p.slots.includes(slot));
  const perks: PerkRoll[] = [];
  for (let i = 0; i < loot.tiers[tier].perks && pool.length > 0; i++) {
    const [id, def] = pool.splice(Math.floor(rng.next() * pool.length), 1)[0]!;
    const target = def.value * levelScale(content, ilvl) * loot.tiers[tier].perkStrength;
    perks.push({
      perk: id,
      value: rounded(def, target * rng.range(1 - loot.perkSpread, 1 + loot.perkSpread)),
    });
  }
  return { item, count: 1, level: 0, gear: { tier, ilvl, seed, perks } };
}

/** Every slot something can drop for, each with the bases that can drop there and their weights. */
function dropBases(content: Content): [GearSlot, [string, number][]][] {
  const bySlot = new Map<GearSlot, [string, number][]>();
  for (const [id, def] of Object.entries(content.items)) {
    const slot = gearSlotOf(def);
    if (!slot || (def.kind !== 'weapon' && def.kind !== 'armor' && def.kind !== 'ring') || def.drop <= 0)
      continue;
    bySlot.set(slot, [...(bySlot.get(slot) ?? []), [id, def.drop]]);
  }
  return [...bySlot];
}

/**
 * A whole drop from its seed: the slot (each equally likely, so rings are not drowned out by armor),
 * then the base by its `drop` weight, then the perks.
 */
export function rollDrop(content: Content, tier: TierId, ilvl: number, seed: number): ItemStack {
  const rng = new Rng(seed);
  const [, bases] = rng.pick(dropBases(content));
  return withRolls(content, rng, rng.weighted(bases), tier, ilvl, seed);
}

/** Rolls a tier from a drop table, honoring pity: after a long run of lesser drops, a good one comes. */
export function rollTier(sim: Simulation, table: string): TierId {
  const { loot } = sim.content;
  const entries = loot.tables[table];
  if (!entries) throw new Error(`Unknown loot table "${table}"`);
  const floor = TIERS.indexOf(loot.pity.tier);
  const owed = sim.state.lootPity >= loot.pity.after;
  const better = entries.filter(([t]) => TIERS.indexOf(t) >= floor);
  const tier = sim.rng.weighted(owed && better.length > 0 ? better : entries);
  sim.state.lootPity = TIERS.indexOf(tier) >= floor ? 0 : sim.state.lootPity + 1;
  return tier;
}

/** The item level of gear dropped at a world position: the biome's. */
export function itemLevelAt(sim: Simulation, x: number, y: number): number {
  const biome = sim.world.gen.biomeAt(Math.floor(x / TILE), Math.floor(y / TILE));
  return sim.content.biomes[biome]?.itemLevel ?? 1;
}

/** Drops a freshly rolled piece of gear. Its seed is drawn from the sim, everything after from the seed. */
export function dropGear(sim: Simulation, table: string, x: number, y: number): void {
  const tier = rollTier(sim, table);
  const stack = rollDrop(sim.content, tier, itemLevelAt(sim, x, y), sim.rng.int(1, 0x7fffffff));
  dropPickup(sim, 'item', 1, x, y, stack.item, stack.gear ?? null);
  sim.events.emit({ type: 'gearDropped', item: stack.item, tier, x, y });
}

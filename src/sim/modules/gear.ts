/**
 * Gear as loot (docs/gear-and-loot.md): tiers, item levels, perks and drops.
 *
 * A piece of gear is a base from items.json plus its `Gear` rolls. Base numbers (damage, Armor, innate
 * perks) are never stored: they follow from the base, the tier and the item level, so tuning content
 * re-tunes every copy. Rolled perks keep the value they rolled. Every roll after the tier comes from
 * the item's own seed, so the same seed always makes the same item.
 *
 * A perk raises a stat or adds an effect of the kinds class modifiers use; `gearEffects` hands the
 * effects to the modifier hooks, which treat them exactly like a worn modifier's.
 */
import { gearSlotOf, type Content } from '../../content/content';
import {
  PerkStatSchema,
  TIERS,
  type GearSlot,
  type ItemDef,
  type ModifierEffect,
  type PerkDef,
  type PerkStat,
  type TierId,
} from '../../content/schemas';
import { Rng } from '../../core/rng';
import { Abilities, type Equipment, type Gear, type ItemStack, type PerkRoll } from '../components';
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

function isGear(def: ItemDef | undefined): def is Extract<ItemDef, { kind: 'weapon' | 'armor' | 'ring' }> {
  return def?.kind === 'weapon' || def?.kind === 'armor' || def?.kind === 'ring';
}

export interface PerkLine {
  perk: string;
  value: number;
  /** What it raises (taken away for a drawback), or the effect it adds at its rolled strength. */
  stat?: PerkStat;
  effect?: ModifierEffect;
  /** Fixed on every copy of the base, rather than rolled. */
  innate: boolean;
  greater: boolean;
  drawback: boolean;
  /** For a class perk, the class it works for. */
  cls?: string;
}

/**
 * An effect at a perk's strength: its numbers times `strength`. A cooldown factor shrinks its cut,
 * and a once-in-a-while effect comes round sooner.
 */
export function scaleEffect(fx: ModifierEffect, strength: number): ModifierEffect {
  switch (fx.type) {
    case 'kill':
      return {
        ...fx,
        heal: fx.heal * strength,
        energy: fx.energy * strength,
        ...(fx.cooldown ? { cooldown: { ...fx.cooldown, seconds: fx.cooldown.seconds * strength } } : {}),
      };
    case 'hurt':
      return { ...fx, energy: fx.energy * strength };
    case 'cooldown':
      return { ...fx, factor: Math.max(0.1, 1 - (1 - fx.factor) * strength) };
    case 'castShield':
    case 'restShield':
    case 'lowHealthShield':
      return { ...fx, amount: fx.amount * strength };
    case 'ambush':
      return { ...fx, bonus: fx.bonus * strength };
    case 'poise':
      return { ...fx, seconds: fx.seconds / strength };
    case 'stillEnergy':
      return { ...fx, perSecond: fx.perSecond * strength };
    case 'streakBurst':
      return { ...fx, damage: fx.damage * strength };
    case 'lastEmber':
    case 'dodgeRefund':
    case 'tipperMark':
    case 'slamPull':
    case 'vanishStrikes':
    case 'perfectRefund':
      return fx;
    case 'emberHeal':
      return { ...fx, amount: fx.amount * strength };
  }
}

/** Every perk on a piece of gear, innate ones first, at their real strength. */
export function perkLines(content: Content, stack: ItemStack): PerkLine[] {
  const def = content.items[stack.item];
  if (!isGear(def)) return [];
  const gear = gearOf(stack);
  const scale = statScale(content, gear);
  const line = (roll: PerkRoll, innate: boolean, value: number): PerkLine[] => {
    const perk = content.loot.perks[roll.perk];
    if (!perk) return [];
    const v = perk.fixed ? perk.value : rounded(perk, value);
    return [
      {
        perk: roll.perk,
        value: v,
        ...(perk.stat ? { stat: perk.stat } : {}),
        ...(perk.effect ? { effect: scaleEffect(perk.effect, v) } : {}),
        innate,
        greater: roll.greater === true,
        drawback: perk.drawback,
        ...(perk.class !== undefined ? { cls: perk.class } : {}),
      },
    ];
  };
  return [
    ...def.innate.flatMap((roll) => line(roll, true, roll.value * scale)),
    ...gear.perks.flatMap((roll) => line(roll, false, roll.value)),
  ];
}

/** An effect's headline number, for its perk's `{v}`. */
function headline(fx: ModifierEffect): string {
  const tidy = (n: number) => String(Math.round(n * 10) / 10);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  switch (fx.type) {
    case 'kill':
      return fx.cooldown ? tidy(fx.cooldown.seconds) : tidy(fx.heal > 0 ? fx.heal : fx.energy);
    case 'hurt':
      return tidy(fx.energy * 10);
    case 'cooldown':
      return pct(1 - fx.factor);
    case 'castShield':
    case 'restShield':
    case 'lowHealthShield':
      return String(Math.round(fx.amount));
    case 'ambush':
      return pct(fx.bonus);
    case 'poise':
      return String(Math.round(fx.seconds));
    case 'stillEnergy':
      return tidy(fx.perSecond);
    case 'streakBurst':
      return tidy(fx.damage);
    case 'lastEmber':
    case 'dodgeRefund':
    case 'tipperMark':
    case 'slamPull':
    case 'vanishStrikes':
    case 'perfectRefund':
      return '';
    case 'emberHeal':
      return String(Math.round(fx.amount));
  }
}

/** "+8% damage", "+2 Vigor", "Kills heal 4 HP": a perk's text with its value filled in. */
export function perkText(
  content: Content,
  line: { perk: string; value: number; effect?: ModifierEffect },
): string {
  const def = content.loot.perks[line.perk];
  if (!def) return line.perk;
  const value = line.effect
    ? headline(line.effect)
    : def.integer
      ? String(line.value)
      : `${Math.round(line.value * 100)}%`;
  return def.text.replace('{v}', value);
}

/** A Legendary base's power: its name, what it does and its effect. */
export function legendaryPower(content: Content, stack: ItemStack) {
  const def = content.items[stack.item];
  return isGear(def) ? def.power : undefined;
}

const worn = (eq: Equipment | undefined) =>
  [eq?.weapon, eq?.ring0, eq?.ring1, eq?.helmet, eq?.chest, eq?.legs].filter(
    (s): s is ItemStack => s !== null && s !== undefined,
  );

export type GearTotals = Record<PerkStat, number>;

/** Everything worn, added up per stat. `armor` includes each armor piece's own Armor; drawbacks take away. */
export function gearTotals(content: Content, eq: Equipment | undefined): GearTotals {
  // Every stat present, so callers can read any of them.
  const totals = Object.fromEntries(PerkStatSchema.options.map((stat) => [stat, 0])) as GearTotals;
  for (const stack of worn(eq)) {
    totals.armor += armorValue(content, stack);
    for (const line of perkLines(content, stack))
      if (line.stat) totals[line.stat] += line.drawback ? -line.value : line.value;
  }
  return totals;
}

/**
 * The effects worn gear adds for a class: effect perks (a class perk only for its own class) and every
 * Legendary power. The modifier hooks run them alongside worn modifiers.
 */
export function gearEffects(
  content: Content,
  eq: Equipment | undefined,
  cls: string | null,
): ModifierEffect[] {
  return worn(eq).flatMap((stack) => [
    ...perkLines(content, stack).flatMap((line) =>
      line.effect && (line.cls === undefined || line.cls === cls) ? [line.effect] : [],
    ),
    ...(legendaryPower(content, stack) ? [legendaryPower(content, stack)!.effect] : []),
  ]);
}

/**
 * Rolls a piece of gear of a given base. The perks come from the seed: a tier's worth of different
 * perks from the slot's pool, each within `perkSpread` of its target for the item level and tier. On
 * good enough tiers a perk can roll Greater. Class perks favor `cls`, the class being played.
 */
export function rollGear(
  content: Content,
  item: string,
  tier: TierId,
  ilvl: number,
  seed: number,
  cls: string | null = null,
): ItemStack {
  return withRolls(content, new Rng(seed), item, tier, ilvl, seed, cls, false);
}

function atLeast(tier: TierId, floor: TierId): boolean {
  return TIERS.indexOf(tier) >= TIERS.indexOf(floor);
}

/** A perk's rolled strength: its target for the item level and tier, within the spread. */
function rollValue(content: Content, rng: Rng, def: PerkDef, tier: TierId, ilvl: number): number {
  const { loot } = content;
  if (def.fixed) return def.value;
  const level = def.effect ? 1 : levelScale(content, ilvl);
  return (
    def.value * level * loot.tiers[tier].perkStrength * rng.range(1 - loot.perkSpread, 1 + loot.perkSpread)
  );
}

/**
 * Smart loot: class perks keep their share of the pool, but about `smartLoot` of that share goes to the
 * class being played. With no class (or none of its perks in the pool), every perk weighs the same.
 */
function perkWeights(content: Content, pool: [string, PerkDef][], cls: string | null): number[] {
  const classPerks = pool.filter(([, p]) => p.class !== undefined);
  const own = classPerks.filter(([, p]) => p.class === cls).length;
  const others = classPerks.length - own;
  if (own === 0 || others === 0) return pool.map(() => 1);
  const share = content.loot.smartLoot;
  return pool.map(([, p]) =>
    p.class === undefined
      ? 1
      : p.class === cls
        ? (classPerks.length * share) / own
        : (classPerks.length * (1 - share)) / others,
  );
}

function withRolls(
  content: Content,
  rng: Rng,
  item: string,
  tier: TierId,
  ilvl: number,
  seed: number,
  cls: string | null,
  blighted: boolean,
): ItemStack {
  const def = content.item(item);
  const slot = gearSlotOf(def);
  const { loot } = content;
  // Never a perk the base already carries: no doubled lines on one item.
  const innate = new Set(isGear(def) ? def.innate.map((r) => r.perk) : []);
  const pool = Object.entries(loot.perks).filter(
    ([id, p]) =>
      slot !== null &&
      !innate.has(id) &&
      p.slots.includes(slot) &&
      (p.weaponTypes === undefined || (def.kind === 'weapon' && p.weaponTypes.includes(def.weapon.type))) &&
      !p.drawback &&
      (p.minTier === undefined || atLeast(tier, p.minTier)),
  );
  const perks: PerkRoll[] = [];
  const canBeGreater = atLeast(tier, loot.greater.tier);
  for (let i = 0; i < loot.tiers[tier].perks && pool.length > 0; i++) {
    const weights = perkWeights(content, pool, cls);
    const index = rng.weighted(weights.map((w, j) => [j, w] as const));
    const [id, def] = pool.splice(index, 1)[0]!;
    const greater = canBeGreater && rng.chance(loot.greater.chance);
    const value = rollValue(content, rng, def, tier, ilvl) * (greater ? loot.greater.factor : 1);
    const boosted = blighted && !def.fixed ? value * loot.blight.factor : value;
    perks.push({
      perk: id,
      value: def.fixed ? def.value : rounded(def, boosted),
      ...(greater ? { greater: true } : {}),
    });
  }
  const gear: Gear = { tier, ilvl, seed, perks };
  if (blighted) {
    const drawbacks = Object.entries(loot.perks).filter(
      ([, p]) => p.drawback && slot !== null && p.slots.includes(slot),
    );
    if (drawbacks.length > 0) {
      const [id, def] = rng.pick(drawbacks);
      perks.push({ perk: id, value: rounded(def, rollValue(content, rng, def, tier, ilvl)) });
      gear.blighted = true;
    }
  }
  return { item, count: 1, level: 0, gear };
}

/**
 * Every slot something can drop for, with the bases that can drop there and their weights. Legendary
 * bases (those with a power) are kept apart: they drop only as Legendaries.
 */
function dropBases(content: Content, legendary: boolean): Map<GearSlot, [string, number][]> {
  const bySlot = new Map<GearSlot, [string, number][]>();
  for (const [id, def] of Object.entries(content.items)) {
    const slot = gearSlotOf(def);
    if (!slot || !isGear(def) || def.drop <= 0 || (def.power !== undefined) !== legendary) continue;
    bySlot.set(slot, [...(bySlot.get(slot) ?? []), [id, def.drop]]);
  }
  return bySlot;
}

/**
 * A whole drop from its seed: the slot (each equally likely, so rings are not drowned out by armor),
 * then the base by its `drop` weight (a Legendary takes its slot's Legendary base when it has one), then
 * whether it is Blighted, then the perks.
 */
export function rollDrop(
  content: Content,
  tier: TierId,
  ilvl: number,
  seed: number,
  cls: string | null = null,
): ItemStack {
  const rng = new Rng(seed);
  const [slot, bases] = rng.pick([...dropBases(content, false)]);
  const legendary = tier === 'legendary' ? dropBases(content, true).get(slot) : undefined;
  const item = rng.weighted(legendary ?? bases);
  const { blight } = content.loot;
  const blighted = atLeast(tier, blight.tier) && rng.chance(blight.chance);
  return withRolls(content, rng, item, tier, ilvl, seed, cls, blighted);
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
  const cls = sim.ecs.get(sim.player, Abilities)?.class ?? null;
  const stack = rollDrop(sim.content, tier, itemLevelAt(sim, x, y), sim.rng.int(1, 0x7fffffff), cls);
  const gear = stack.gear;
  dropPickup(sim, 'item', 1, x, y, stack.item, gear ?? null);
  sim.events.emit({
    type: 'gearDropped',
    item: stack.item,
    tier,
    greater: gear?.perks.some((p) => p.greater) ?? false,
    blighted: gear?.blighted === true,
    x,
    y,
  });
}

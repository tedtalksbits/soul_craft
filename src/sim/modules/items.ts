/**
 * Inventory, equipment, derived player stats and timed buffs.
 *
 * Everything the player carries is plain data on the player entity
 * (Inventory, Equipment, Buffs). Menu actions arrive as PlayerActions inside
 * the InputFrame, so equipping and drinking are as deterministic and
 * replayable as attacking. Stats are worked out from gear and attributes by one
 * pure function, so Power and the equipment screen's comparisons can try gear
 * on without touching the player.
 */
import { CommandError } from '../../core/commands';
import type { Entity } from '../../core/ecs';
import type { Content } from '../../content/content';
import { gearSlotOf } from '../../content/content';
import { ATTRIBUTES, TIERS, type AttributeId, type StatId } from '../../content/schemas';
import {
  Attributes,
  Buffs,
  Empowered,
  Equipment,
  Health,
  Inventory,
  Player,
  Stamina,
  type Buff,
  type EquipSlot,
  type ItemStack,
} from '../components';
import { TICK_RATE } from '../constants';
import type { PlayerAction } from '../input';
import type { SimCommand, SimModule } from '../module';
import type { Simulation } from '../simulation';
import { inventoryCapacity } from './restored-effects';
import { gearOf, gearTotals, rollDrop, rollGear, weaponNumbers } from './gear';
import { pursued } from './stealth';

/** What the player's swing and body amount to once gear, attributes and buffs are applied. */
export interface PlayerStats {
  damage: number;
  staminaCost: number;
  reach: number;
  width: number;
  knockback: number;
  /** Armor from gear: each point cuts hits along `player.armor`'s curve. */
  armor: number;
  /** Fraction of incoming damage absorbed by Armor and buffs together, up to `player.armor.cap`. */
  defense: number;
  maxHp: number;
  maxStamina: number;
  /** Stamina regained per tick. */
  staminaRegen: number;
  /** Chance a weapon hit crits, and what a crit multiplies. */
  critChance: number;
  critMultiplier: number;
  /** Stamina a roll costs. */
  rollStamina: number;
  /** Extra move speed, as a fraction. */
  moveSpeed: number;
  /** Multiplies healing from flasks and bandages. */
  healing: number;
  /** Multiplies souls from kills. */
  souls: number;
  /** Multiplies ability damage, and the super's charge rate. */
  abilityDamage: number;
  energyRate: number;
  /** Attribute points from leveling plus gear. */
  attributes: Record<AttributeId, number>;
}

/** Bare fists, for when no weapon is equipped. */
const UNARMED = { damage: 4, staminaCost: 8, reach: 10, width: 12, knockback: 1.5 } as const;

/** Display order of the equipment screen: weapon and rings on the left, armor on the right. */
export const EQUIP_SLOTS: readonly EquipSlot[] = ['weapon', 'ring0', 'ring1', 'helmet', 'chest', 'legs'];

const NO_EQUIPMENT: Equipment = {
  weapon: null,
  ring0: null,
  ring1: null,
  helmet: null,
  chest: null,
  legs: null,
  quick: null,
};

/** Gives a freshly spawned player the content-defined starting gear (all Common) and items. */
export function giveStartingKit(sim: Simulation, e: Entity): void {
  sim.ecs.add(e, Inventory, { stacks: [] });
  sim.ecs.add(e, Equipment, startingEquipment(sim.content));
  sim.ecs.add(e, Buffs, { active: [] });
  for (const { item, count } of sim.content.player.start.items) addItem(sim, e, item, count);
}

function startingEquipment(content: Content): Equipment {
  const eq: Equipment = { ...NO_EQUIPMENT };
  for (const item of content.player.start.gear) {
    const slot = slotFor(content, item, eq);
    if (slot) eq[slot] = { item, count: 1, level: 0 };
  }
  return eq;
}

export function countItem(inv: Inventory, item: string): number {
  return inv.stacks.reduce((n, s) => (s.item === item ? n + s.count : n), 0);
}

/** Puts one item stack (a piece of gear and its rolls) in its own pack slot. False if the pack is full. */
export function addStack(sim: Simulation, e: Entity, stack: ItemStack): boolean {
  const inv = sim.ecs.need(e, Inventory);
  if (inv.stacks.length >= inventoryCapacity(sim)) return false;
  inv.stacks.push(stack);
  return true;
}

/** Adds items, filling matching stacks first. Returns how many did not fit. */
export function addItem(sim: Simulation, e: Entity, item: string, count: number, level = 0): number {
  const inv = sim.ecs.need(e, Inventory);
  const max = sim.content.item(item).stack;
  let left = count;
  for (const s of inv.stacks) {
    if (left === 0) break;
    if (s.item !== item || s.level !== level || s.count >= max) continue;
    const take = Math.min(max - s.count, left);
    s.count += take;
    left -= take;
  }
  while (left > 0 && inv.stacks.length < inventoryCapacity(sim)) {
    const take = Math.min(max, left);
    inv.stacks.push({ item, count: take, level });
    left -= take;
  }
  return left;
}

/** How many of an item could still be added. */
export function roomFor(sim: Simulation, e: Entity, item: string, level = 0): number {
  const inv = sim.ecs.need(e, Inventory);
  const max = sim.content.item(item).stack;
  const inStacks = inv.stacks
    .filter((s) => s.item === item && s.level === level)
    .reduce((n, s) => n + (max - s.count), 0);
  return inStacks + (inventoryCapacity(sim) - inv.stacks.length) * max;
}

/** Removes `count` of an item (from the last stacks first). All or nothing. */
export function removeItem(inv: Inventory, item: string, count: number): boolean {
  if (countItem(inv, item) < count) return false;
  let left = count;
  for (let i = inv.stacks.length - 1; i >= 0 && left > 0; i--) {
    const s = inv.stacks[i]!;
    if (s.item !== item) continue;
    const take = Math.min(s.count, left);
    s.count -= take;
    left -= take;
    if (s.count === 0) inv.stacks.splice(i, 1);
  }
  return true;
}

function buffTotal(buffs: readonly Buff[], stat: StatId): number {
  return buffs.reduce((n, b) => (b.stat === stat ? n + b.amount : n), 0);
}

/** A soft-capped attribute's total gain: full per point up to the first breakpoint, less after each. */
export function attributeGain(
  content: Content,
  gains: readonly [number, number, number],
  points: number,
): number {
  const [first, second] = content.player.leveling.softCaps;
  const band = (from: number, to: number) => Math.max(0, Math.min(points, to) - from);
  return band(0, first) * gains[0] + band(first, second) * gains[1] + band(second, Infinity) * gains[2];
}

/** The fraction of a hit that Armor alone absorbs, before buffs and the cap. */
export function armorReduction(content: Content, armor: number): number {
  return 1 - content.player.armor.k / (content.player.armor.k + armor);
}

/**
 * Stats from gear, attributes and (optionally) the buffs and empowerment in effect. Pure: Power and
 * comparisons pass made-up equipment through it.
 */
export function computeStats(
  content: Content,
  eq: Equipment | undefined,
  attrs: Attributes | undefined,
  temp: { buffs?: readonly Buff[]; emp?: Empowered | undefined } = {},
): PlayerStats {
  const def = content.player;
  const gear = gearTotals(content, eq);
  const buffs = temp.buffs ?? [];
  const emp = temp.emp;
  const attributes = Object.fromEntries(
    ATTRIBUTES.map((id) => [id, (attrs?.[id] ?? 0) + gear[id]]),
  ) as Record<AttributeId, number>;
  const per = def.leveling.perLevel;
  const gain = (gains: readonly [number, number, number], id: AttributeId) =>
    attributeGain(content, gains, attributes[id]);
  const weapon = (eq?.weapon && weaponNumbers(content, eq.weapon)) ?? UNARMED;
  const taken =
    (1 - armorReduction(content, gear.armor)) * (1 - buffTotal(buffs, 'defense')) * (1 - (emp?.defense ?? 0));
  const buffHp = buffTotal(buffs, 'maxHp');
  return {
    damage:
      weapon.damage *
      (1 + gear.damage + buffTotal(buffs, 'damage') + (emp?.damage ?? 0) + gain(per.might.damage, 'might')),
    staminaCost: emp?.staminaFree ? 0 : weapon.staminaCost * Math.max(0, 1 - gear.attackStamina),
    reach: weapon.reach,
    width: weapon.width,
    knockback: weapon.knockback,
    armor: gear.armor,
    defense: Math.min(def.armor.cap, 1 - taken),
    maxHp: Math.round(def.maxHp + gear.maxHp + buffHp + gain(per.vigor.maxHp, 'vigor')),
    maxStamina: Math.round(def.maxStamina + gear.maxStamina + gain(per.endurance.maxStamina, 'endurance')),
    staminaRegen: def.staminaRegen * (1 + gear.staminaRegen + buffTotal(buffs, 'staminaRegen')),
    critChance: Math.min(1, def.attack.critChance + gear.critChance + (emp?.crit ?? 0)),
    critMultiplier: def.attack.critMultiplier + gear.critDamage,
    rollStamina: def.roll.staminaCost * Math.max(0, 1 - gear.rollStamina),
    moveSpeed: gear.moveSpeed,
    healing: 1 + gear.healing,
    souls: 1 + gear.souls,
    abilityDamage: 1 + gear.abilityDamage + gain(per.attunement.abilityDamage, 'attunement'),
    energyRate: 1 + gain(per.attunement.energy, 'attunement'),
    attributes,
  };
}

export function playerStats(sim: Simulation, e: Entity): PlayerStats {
  return computeStats(sim.content, sim.ecs.get(e, Equipment), sim.ecs.get(e, Attributes), {
    buffs: sim.ecs.get(e, Buffs)?.active ?? [],
    emp: sim.ecs.get(e, Empowered),
  });
}

/** Weapon damage per stamina, crits included: Power's offense. */
function offense(stats: PlayerStats): number {
  const crit = 1 + stats.critChance * (stats.critMultiplier - 1);
  return (stats.damage * crit) / Math.max(1, stats.staminaCost);
}

/** Effective health (max HP stretched by damage reduction): Power's defense. */
function toughness(stats: PlayerStats): number {
  return stats.maxHp / (1 - stats.defense);
}

const startPower = new WeakMap<Content, { offense: number; toughness: number }>();

/**
 * Power: 100 × √(offense × defense), each relative to a new character, so a new character is 100 and
 * balance beats stacking one side. Buffs don't count; it is a read on gear and levels, and nothing
 * is ever gated on it.
 */
export function power(content: Content, eq: Equipment | undefined, attrs: Attributes | undefined): number {
  let start = startPower.get(content);
  if (!start) {
    const base = computeStats(content, startingEquipment(content), undefined);
    start = { offense: offense(base), toughness: toughness(base) };
    startPower.set(content, start);
  }
  const now = computeStats(content, eq, attrs);
  return Math.round(100 * Math.sqrt((offense(now) / start.offense) * (toughness(now) / start.toughness)));
}

export function playerPower(sim: Simulation): number {
  return power(sim.content, sim.ecs.get(sim.player, Equipment), sim.ecs.get(sim.player, Attributes));
}

/** The numbers the equipment screen compares. */
export interface GearSummary {
  power: number;
  damage: number;
  armor: number;
  defense: number;
  maxHp: number;
  maxStamina: number;
}

function summary(content: Content, eq: Equipment, attrs: Attributes | undefined): GearSummary {
  const s = computeStats(content, eq, attrs);
  return {
    power: power(content, eq, attrs),
    damage: Math.round(s.damage),
    armor: s.armor,
    defense: s.defense,
    maxHp: s.maxHp,
    maxStamina: s.maxStamina,
  };
}

export interface Comparison {
  slot: EquipSlot;
  /** What it would replace, if anything. */
  replaces: ItemStack | null;
  now: GearSummary;
  after: GearSummary;
}

/**
 * Tries the pack item at `index` on a copy of the player's equipment: where it would go, what it
 * would replace, and the numbers before and after. Null for anything that is not gear.
 */
export function compareGear(sim: Simulation, index: number): Comparison | null {
  const stack = sim.ecs.need(sim.player, Inventory).stacks[index];
  const eq = sim.ecs.need(sim.player, Equipment);
  const slot = stack ? slotFor(sim.content, stack.item, eq) : null;
  if (!stack || !slot) return null;
  const attrs = sim.ecs.get(sim.player, Attributes);
  return {
    slot,
    replaces: eq[slot],
    now: summary(sim.content, eq, attrs),
    after: summary(sim.content, { ...eq, [slot]: stack }, attrs),
  };
}

/**
 * Applies changed max health and stamina (rings, buffs, leveling), keeping the current values
 * within them.
 */
export function syncVitals(sim: Simulation, e: Entity): void {
  const stats = playerStats(sim, e);
  const health = sim.ecs.need(e, Health);
  health.max = stats.maxHp;
  health.hp = Math.min(health.hp, health.max);
  const stamina = sim.ecs.get(e, Stamina);
  if (stamina) {
    stamina.max = stats.maxStamina;
    stamina.value = Math.min(stamina.value, stamina.max);
  }
}

/** The slot an item would go in: a ring takes a free ring slot, else replaces the first. */
function slotFor(content: Content, item: string, eq: Equipment): EquipSlot | null {
  const slot = gearSlotOf(content.item(item));
  if (slot !== 'ring') return slot;
  return eq.ring0 === null || eq.ring1 !== null ? 'ring0' : 'ring1';
}

/** Equips the pack stack at `index`, swapping what was in the slot back into its place in the pack. */
export function equip(sim: Simulation, index: number): boolean {
  const e = sim.player;
  const inv = sim.ecs.need(e, Inventory);
  const eq = sim.ecs.need(e, Equipment);
  const stack = inv.stacks[index];
  if (!stack) return false;
  const slot = slotFor(sim.content, stack.item, eq);
  if (!slot) return false;
  const previous = eq[slot];
  inv.stacks.splice(index, 1);
  eq[slot] = stack;
  if (previous) inv.stacks.splice(index, 0, previous);
  syncVitals(sim, e);
  sim.events.emit({ type: 'equipped', item: stack.item, slot });
  return true;
}

export function unequip(sim: Simulation, slot: EquipSlot): boolean {
  const e = sim.player;
  const eq = sim.ecs.need(e, Equipment);
  const stack = eq[slot];
  if (!stack) return false;
  if (!addStack(sim, e, stack)) {
    sim.events.emit({ type: 'inventoryFull', item: stack.item });
    return false;
  }
  eq[slot] = null;
  syncVitals(sim, e);
  sim.events.emit({ type: 'unequipped', item: stack.item, slot });
  return true;
}

/** Starts drinking/applying a consumable from the inventory. Only from the `free` state. */
export function beginUse(sim: Simulation, item: string): boolean {
  const e = sim.player;
  const p = sim.ecs.need(e, Player);
  const def = sim.content.items[item];
  if (p.state !== 'free' || def?.kind !== 'consumable') return false;
  if (!removeItem(sim.ecs.need(e, Inventory), item, 1)) return false;
  p.using = item;
  p.state = 'drink';
  p.t = 0;
  return true;
}

/** Applies a consumable's effect (called by the player controller at the drink's heal moment). */
export function finishUse(sim: Simulation, e: Entity, item: string): void {
  const def = sim.content.items[item];
  if (def?.kind !== 'consumable') return;
  const effect = def.effect;
  if (effect.type === 'heal') {
    const health = sim.ecs.need(e, Health);
    const healed = Math.min(health.max - health.hp, Math.round(effect.amount * playerStats(sim, e).healing));
    health.hp += healed;
    sim.events.emit({ type: 'healed', amount: healed });
    return;
  }
  const buffs = sim.ecs.need(e, Buffs);
  // Drinking the same kind again refreshes it rather than stacking.
  buffs.active = buffs.active.filter((b) => b.stat !== effect.stat);
  buffs.active.push({
    stat: effect.stat,
    amount: effect.amount,
    ticks: effect.seconds * TICK_RATE,
    source: item,
  });
  if (effect.stat === 'maxHp') syncVitals(sim, e);
  sim.events.emit({ type: 'buffStarted', stat: effect.stat, item, seconds: effect.seconds });
}

function setQuick(sim: Simulation, item: string | null): void {
  if (item !== null && sim.content.items[item]?.kind !== 'consumable') return;
  sim.ecs.need(sim.player, Equipment).quick = item;
}

function applyAction(sim: Simulation, action: PlayerAction): void {
  // The pack pauses the game, so swapping gear mid-fight would be free; it waits until nothing is after you.
  if ((action.type === 'equip' || action.type === 'unequip') && pursued(sim)) {
    sim.events.emit({ type: 'gearLocked' });
    return;
  }
  switch (action.type) {
    case 'equip':
      equip(sim, action.index);
      return;
    case 'unequip':
      unequip(sim, action.slot);
      return;
    case 'use':
      beginUse(sim, action.item);
      return;
    case 'setQuick':
      setQuick(sim, action.item);
      return;
    default:
      return; // crafting actions belong to the crafting module
  }
}

function processActions(sim: Simulation): void {
  if (sim.ecs.need(sim.player, Player).state === 'dead') return;
  for (const action of sim.input.actions ?? []) applyAction(sim, action);
}

function tickBuffs(sim: Simulation): void {
  for (const [e, buffs] of sim.ecs.query(Buffs)) {
    if (buffs.active.length === 0) continue;
    const ended = buffs.active.filter((b) => --b.ticks <= 0);
    if (ended.length === 0) continue;
    buffs.active = buffs.active.filter((b) => b.ticks > 0);
    for (const b of ended) sim.events.emit({ type: 'buffEnded', stat: b.stat });
    if (ended.some((b) => b.stat === 'maxHp')) syncVitals(sim, e);
  }
}

const itemIds = ({ sim }: { sim: Simulation }) => Object.keys(sim.content.items);
const gearIds = ({ sim }: { sim: Simulation }) =>
  Object.keys(sim.content.items).filter((id) => gearSlotOf(sim.content.item(id)) !== null);

const commands: SimCommand[] = [
  {
    name: 'item',
    description: 'Put items in the inventory (anything that does not fit is reported).',
    args: [
      { name: 'id', type: 'string', options: itemIds },
      { name: 'count', type: 'number', integer: true, optional: true },
    ],
    run: ({ sim }, a) => {
      const id = a.string('id');
      const count = a.optNumber('count') ?? 1;
      if (count < 1) throw new CommandError('count must be at least 1');
      const left = addItem(sim, sim.player, id, count);
      return left ? `added ${count - left} ${id}; ${left} did not fit` : `added ${count} ${id}`;
    },
  },
  {
    name: 'inv',
    description: 'List the inventory, equipment and derived stats.',
    run: ({ sim }) => {
      const e = sim.player;
      const inv = sim.ecs.need(e, Inventory);
      const eq = sim.ecs.need(e, Equipment);
      const st = playerStats(sim, e);
      const show = (s: ItemStack | null) =>
        s ? `${s.item}${s.level ? ` +${s.level}` : ''} (${gearOf(s).tier}, ilvl ${gearOf(s).ilvl})` : '-';
      return [
        ...EQUIP_SLOTS.map((slot) => `${slot.padEnd(7)} ${show(eq[slot])}`),
        `quick   ${eq.quick ?? '-'}`,
        `stats   power ${playerPower(sim)}  dmg ${st.damage.toFixed(1)}  armor ${st.armor} (${(st.defense * 100).toFixed(0)}%)  maxHp ${st.maxHp}  regen ${st.staminaRegen.toFixed(2)}`,
        `items   ${inv.stacks.length}/${inventoryCapacity(sim)} slots`,
        ...inv.stacks.map((s, i) => `  [${i}] ${s.item} x${s.count}${s.level ? ` +${s.level}` : ''}`),
      ].join('\n');
    },
  },
  {
    name: 'gear',
    description: 'Put a rolled piece of gear in the pack: a tier, and optionally the base and item level.',
    args: [
      { name: 'tier', type: 'string', options: () => [...TIERS] },
      { name: 'id', type: 'string', options: gearIds, optional: true },
      { name: 'ilvl', type: 'number', integer: true, optional: true },
    ],
    run: ({ sim }, a) => {
      const tier = TIERS.find((t) => t === a.string('tier'));
      if (!tier) throw new CommandError(`tier must be one of ${TIERS.join(', ')}`);
      const ilvl = a.optNumber('ilvl') ?? 1;
      const seed = sim.rng.int(1, 0x7fffffff);
      const id = a.optString('id');
      const stack = id
        ? rollGear(sim.content, id, tier, ilvl, seed)
        : rollDrop(sim.content, tier, ilvl, seed);
      if (!addStack(sim, sim.player, stack)) throw new CommandError('inventory is full');
      return `added ${tier} ${stack.item} (ilvl ${ilvl})`;
    },
  },
  {
    name: 'equip',
    description: 'Equip an item, adding it to the inventory first if needed.',
    args: [{ name: 'id', type: 'string', options: itemIds }],
    run: ({ sim }, a) => {
      const id = a.string('id');
      const inv = sim.ecs.need(sim.player, Inventory);
      if (!inv.stacks.some((s) => s.item === id) && addItem(sim, sim.player, id, 1) > 0)
        throw new CommandError('inventory is full');
      const index = inv.stacks.findIndex((s) => s.item === id);
      if (!equip(sim, index)) throw new CommandError(`${id} is not equipment`);
      return `equipped ${id}`;
    },
  },
];

export const itemsModule: SimModule = {
  id: 'items',
  systems: [
    { phase: 'control', run: processActions, menu: true },
    { phase: 'cleanup', run: tickBuffs },
  ],
  commands,
};

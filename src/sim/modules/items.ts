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
  Abilities,
  Attributes,
  Buffs,
  Coating,
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
import {
  pocketRoom,
  STASH_CLOSED,
  stashable,
  stashCapacity,
  stashOf,
  stashReachable,
  stashRoom,
} from './storage';
import { gearOf, gearTotals, rollDrop, rollGear, weaponNumbers } from './gear';
import { characterPower, gearPower, maxPower, playerPower } from './power';

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
  /** Extra i-frame ticks on a roll, and how much farther it goes (a fraction). */
  rollIframes: number;
  rollDistance: number;
  /** Extra flask charges from gear. */
  flaskCharges: number;
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
    // The starting kit: Common, at the lowest Power there is.
    if (slot)
      eq[slot] = {
        item,
        count: 1,
        level: 0,
        gear: { tier: 'common', power: content.loot.power.start, seed: 0, perks: [] },
      };
  }
  return eq;
}

export function countItem(inv: Inventory, item: string): number {
  return inv.stacks.reduce((n, s) => (s.item === item ? n + s.count : n), 0);
}

/**
 * Puts one item stack (a piece of gear and its rolls) in its pocket. With the pocket full, the player's goes
 * straight to the stash, from anywhere, so a full pocket never loses loot. False only if both are full.
 */
export function addStack(sim: Simulation, e: Entity, stack: ItemStack): boolean {
  const inv = sim.ecs.need(e, Inventory);
  if (e !== sim.player || pocketRoom(sim, stack.item) > 0) {
    inv.stacks.push(stack);
    return true;
  }
  if (!stashable(sim.content, stack.item) || stashRoom(sim) <= 0) return false;
  stashOf(sim).push(stack);
  sim.events.emit({ type: 'sentToStash', item: stack.item });
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
  let room = pocketRoom(sim, item);
  while (left > 0 && room-- > 0) {
    const take = Math.min(max, left);
    inv.stacks.push({ item, count: take, level });
    left -= take;
  }
  return left;
}

/** How many of an item could still be added: room in its stacks and its pocket (and the stash, for gear). */
export function roomFor(sim: Simulation, e: Entity, item: string, level = 0): number {
  const inv = sim.ecs.need(e, Inventory);
  const max = sim.content.item(item).stack;
  const inStacks = inv.stacks
    .filter((s) => s.item === item && s.level === level)
    .reduce((n, s) => n + (max - s.count), 0);
  const overflow = gearSlotOf(sim.content.item(item)) ? Math.max(0, stashRoom(sim)) : 0;
  const room = pocketRoom(sim, item);
  return room === Infinity ? Infinity : inStacks + (room + overflow) * max;
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
    energyRate: 1 + gain(per.attunement.energy, 'attunement') + gear.energyGain,
    rollIframes: gear.rollIframes,
    rollDistance: gear.rollDistance,
    flaskCharges: gear.flaskCharges,
    attributes,
  };
}

export function playerStats(sim: Simulation, e: Entity): PlayerStats {
  return computeStats(sim.content, sim.ecs.get(e, Equipment), sim.ecs.get(e, Attributes), {
    buffs: sim.ecs.get(e, Buffs)?.active ?? [],
    emp: sim.ecs.get(e, Empowered),
  });
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
    power: characterPower(eq),
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
  return stack ? compareStack(sim, stack) : null;
}

/**
 * Tries any piece (carried, stashed) on a copy of the player's equipment, in `wanted` when it fits there (which
 * ring it would replace). Null for anything that is not gear.
 */
export function compareStack(sim: Simulation, stack: ItemStack, wanted?: EquipSlot): Comparison | null {
  const eq = sim.ecs.need(sim.player, Equipment);
  const slot = targetSlot(sim.content, stack.item, eq, wanted);
  if (!slot) return null;
  const attrs = sim.ecs.get(sim.player, Attributes);
  return {
    slot,
    replaces: eq[slot],
    now: summary(sim.content, eq, attrs),
    after: summary(sim.content, { ...eq, [slot]: stack }, attrs),
  };
}

/** How many flask charges a refill gives: the player's own (the well raises it) plus gear's. */
export function flaskCapacity(sim: Simulation): number {
  return sim.ecs.need(sim.player, Player).maxFlasks + playerStats(sim, sim.player).flaskCharges;
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

/** Where a piece goes: `wanted` if it fits there (either ring slot for a ring), else its own slot. */
function targetSlot(content: Content, item: string, eq: Equipment, wanted?: EquipSlot): EquipSlot | null {
  const kind = gearSlotOf(content.item(item));
  if (wanted && (kind === wanted || (kind === 'ring' && (wanted === 'ring0' || wanted === 'ring1'))))
    return wanted;
  return slotFor(content, item, eq);
}

/**
 * Equips the pack stack at `index` (into `wanted`, if it fits there), swapping what was in the slot back into its
 * place in the pack.
 */
export function equip(sim: Simulation, index: number, wanted?: EquipSlot): boolean {
  const e = sim.player;
  const inv = sim.ecs.need(e, Inventory);
  const eq = sim.ecs.need(e, Equipment);
  const stack = inv.stacks[index];
  if (!stack) return false;
  const slot = targetSlot(sim.content, stack.item, eq, wanted);
  if (!slot) return false;
  const previous = eq[slot];
  inv.stacks.splice(index, 1);
  eq[slot] = stack;
  if (previous) inv.stacks.splice(index, 0, previous);
  syncVitals(sim, e);
  sim.events.emit({ type: 'equipped', item: stack.item, slot });
  return true;
}

/** Equips a piece straight from the stash, where it opens; what it replaces takes its place there. */
export function equipFromStash(sim: Simulation, index: number, wanted?: EquipSlot): boolean {
  const kept = stashOf(sim);
  const stack = kept[index];
  if (!stack) return false;
  if (!stashReachable(sim)) {
    sim.events.emit({ type: 'craftFailed', recipe: 'equip', reason: STASH_CLOSED });
    return false;
  }
  const eq = sim.ecs.need(sim.player, Equipment);
  const slot = targetSlot(sim.content, stack.item, eq, wanted);
  if (!slot) return false;
  const previous = eq[slot];
  if (previous) kept.splice(index, 1, previous);
  else kept.splice(index, 1);
  eq[slot] = stack;
  syncVitals(sim, sim.player);
  sim.events.emit({ type: 'equipped', item: stack.item, slot });
  return true;
}

/**
 * Puts on the highest-Power piece the player can reach for every slot: carried, or stashed where the stash opens
 * (the two best rings for the two ring slots). A worn piece stays on unless something has more Power. Returns how
 * many pieces it changed.
 */
export function equipBest(sim: Simulation): number {
  const eq = sim.ecs.need(sim.player, Equipment);
  const inv = sim.ecs.need(sim.player, Inventory);
  const reach = stashReachable(sim);
  type Spot = { stack: ItemStack; from: 'worn' | 'pack' | 'stash' };
  const spots: Spot[] = [
    ...EQUIP_SLOTS.flatMap((s): Spot[] => (eq[s] ? [{ stack: eq[s], from: 'worn' }] : [])),
    ...inv.stacks.map((stack): Spot => ({ stack, from: 'pack' })),
    ...(reach ? stashOf(sim).map((stack): Spot => ({ stack, from: 'stash' })) : []),
  ];
  const best = (kind: string, n: number) =>
    spots
      .filter((s) => s.stack.gear && gearSlotOf(sim.content.item(s.stack.item)) === kind)
      // Ties go to what is worn, so nothing changes for nothing.
      .sort(
        (a, b) =>
          gearPower(b.stack) - gearPower(a.stack) || Number(b.from === 'worn') - Number(a.from === 'worn'),
      )
      .slice(0, n);
  const wanted: [EquipSlot, Spot | undefined][] = [
    ['weapon', best('weapon', 1)[0]],
    ['helmet', best('helmet', 1)[0]],
    ['chest', best('chest', 1)[0]],
    ['legs', best('legs', 1)[0]],
  ];
  const rings = best('ring', 2);
  // Keep each worn ring in its slot when it stays, so only the newcomer moves in.
  const kept = (['ring0', 'ring1'] as const).filter((s) => rings.some((r) => r.stack === eq[s]));
  const free = (['ring0', 'ring1'] as const).filter((s) => !kept.includes(s));
  for (const r of rings.filter((r) => r.from !== 'worn')) wanted.push([free.shift()!, r]);
  let changed = 0;
  for (const [slot, spot] of wanted) {
    if (!spot || spot.from === 'worn' || eq[slot] === spot.stack) continue;
    const ok =
      spot.from === 'pack'
        ? equip(sim, inv.stacks.indexOf(spot.stack), slot)
        : equipFromStash(sim, stashOf(sim).indexOf(spot.stack), slot);
    if (ok) changed++;
  }
  return changed;
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
  if (effect.type === 'coat') {
    // A new coating wipes the old one off.
    sim.ecs.add(e, Coating, { coating: effect.coating, item, ticks: Math.round(effect.seconds * TICK_RATE) });
    sim.events.emit({ type: 'coated', item, seconds: effect.seconds });
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
  // Gear can change mid-fight (the owner's call, 2026-11-02): swapping to the right tool is part of the game.
  switch (action.type) {
    case 'equip':
      equip(sim, action.index, action.slot);
      return;
    case 'equipStash':
      equipFromStash(sim, action.index, action.slot);
      return;
    case 'equipBest':
      equipBest(sim);
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
  const coating = sim.ecs.get(sim.player, Coating);
  if (coating && --coating.ticks <= 0) {
    sim.ecs.remove(sim.player, Coating);
    sim.events.emit({ type: 'coatingEnded' });
  }
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
        s ? `${s.item}${s.level ? ` +${s.level}` : ''} (${gearOf(s).tier}, Power ${gearOf(s).power})` : '-';
      return [
        ...EQUIP_SLOTS.map((slot) => `${slot.padEnd(7)} ${show(eq[slot])}`),
        `quick   ${eq.quick ?? '-'}`,
        `stats   power ${playerPower(sim)}  dmg ${st.damage.toFixed(1)}  armor ${st.armor} (${(st.defense * 100).toFixed(0)}%)  maxHp ${st.maxHp}  regen ${st.staminaRegen.toFixed(2)}`,
        `items   ${inv.stacks.length} carried, ${stashOf(sim).length}/${stashCapacity(sim)} in the stash`,
        ...inv.stacks.map((s, i) => `  [${i}] ${s.item} x${s.count}${s.level ? ` +${s.level}` : ''}`),
      ].join('\n');
    },
  },
  {
    name: 'gear',
    description: 'Put a rolled piece of gear in the pack: a tier, and optionally the base and Power.',
    args: [
      { name: 'tier', type: 'string', options: () => [...TIERS] },
      { name: 'id', type: 'string', options: gearIds, optional: true },
      { name: 'power', type: 'number', integer: true, optional: true },
    ],
    run: ({ sim }, a) => {
      const tier = TIERS.find((t) => t === a.string('tier'));
      if (!tier) throw new CommandError(`tier must be one of ${TIERS.join(', ')}`);
      const power = a.optNumber('power') ?? maxPower(sim);
      const seed = sim.rng.int(1, 0x7fffffff);
      const id = a.optString('id');
      const cls = sim.ecs.get(sim.player, Abilities)?.class ?? null;
      const stack = id
        ? rollGear(sim.content, id, tier, power, seed, cls)
        : rollDrop(sim.content, tier, power, seed, cls);
      if (!addStack(sim, sim.player, stack)) throw new CommandError('inventory is full');
      return `added ${tier} ${stack.item} (Power ${power})`;
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

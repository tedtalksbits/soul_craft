/**
 * Inventory, equipment, derived player stats and timed buffs.
 *
 * Everything the player carries is plain data on the player entity
 * (Inventory, Equipment, Buffs). Menu actions arrive as PlayerActions inside
 * the InputFrame, so equipping and drinking are as deterministic and
 * replayable as attacking.
 */
import { CommandError } from '../../core/commands';
import type { Entity } from '../../core/ecs';
import type { ItemDef, StatId } from '../../content/schemas';
import {
  Attributes,
  Buffs,
  Empowered,
  Equipment,
  Health,
  Inventory,
  Player,
  Stamina,
  type EquipSlot,
  type ItemStack,
} from '../components';
import { TICK_RATE } from '../constants';
import type { PlayerAction } from '../input';
import type { SimCommand, SimModule } from '../module';
import type { Simulation } from '../simulation';

/** What the player's swing and body amount to once gear and buffs are applied. */
export interface PlayerStats {
  damage: number;
  staminaCost: number;
  reach: number;
  width: number;
  knockback: number;
  /** Fraction of incoming damage absorbed, 0..0.9. */
  defense: number;
  maxHp: number;
  maxStamina: number;
  /** Stamina regained per tick. */
  staminaRegen: number;
  /** Chance a sword hit crits. */
  critChance: number;
}

/** Bare fists, for when no weapon is equipped. */
const UNARMED = { damage: 4, staminaCost: 8, reach: 10, width: 12, knockback: 1.5 } as const;
const MAX_DEFENSE = 0.9;

export const EQUIP_SLOTS: readonly EquipSlot[] = ['weapon', 'armor', 'ring0', 'ring1'];

/** Gives a freshly spawned player the content-defined starting weapon and items. */
export function giveStartingKit(sim: Simulation, e: Entity): void {
  const start = sim.content.player.start;
  sim.ecs.add(e, Inventory, { stacks: [] });
  sim.ecs.add(e, Equipment, {
    weapon: { item: start.weapon, count: 1, level: 0 },
    armor: null,
    ring0: null,
    ring1: null,
    quick: null,
  });
  sim.ecs.add(e, Buffs, { active: [] });
  for (const { item, count } of start.items) addItem(sim, e, item, count);
}

export function countItem(inv: Inventory, item: string): number {
  return inv.stacks.reduce((n, s) => (s.item === item ? n + s.count : n), 0);
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
  while (left > 0 && inv.stacks.length < sim.content.player.inventorySlots) {
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
  return inStacks + (sim.content.player.inventorySlots - inv.stacks.length) * max;
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

function bonus(sim: Simulation, e: Entity, stat: StatId): number {
  const eq = sim.ecs.get(e, Equipment);
  let total = 0;
  for (const slot of [eq?.ring0, eq?.ring1]) {
    const def = slot ? sim.content.items[slot.item] : undefined;
    if (def?.kind === 'ring' && def.ring.stat === stat) total += def.ring.amount;
  }
  for (const b of sim.ecs.get(e, Buffs)?.active ?? []) if (b.stat === stat) total += b.amount;
  return total;
}

export function playerStats(sim: Simulation, e: Entity): PlayerStats {
  const def = sim.content.player;
  const eq = sim.ecs.get(e, Equipment);
  const weaponDef = eq?.weapon ? sim.content.items[eq.weapon.item] : undefined;
  const weapon =
    weaponDef?.kind === 'weapon'
      ? {
          ...weaponDef.weapon,
          damage:
            weaponDef.weapon.damage +
            weaponDef.upgrades.slice(0, eq?.weapon?.level ?? 0).reduce((n, u) => n + u.damage, 0),
        }
      : UNARMED;
  const armorDef = eq?.armor ? sim.content.items[eq.armor.item] : undefined;
  const armor = armorDef?.kind === 'armor' ? armorDef.armor.defense : 0;
  const emp = sim.ecs.get(e, Empowered);
  // Points spent leveling at bonfires.
  const attrs = sim.ecs.get(e, Attributes);
  const per = def.leveling.perLevel;
  const might = (attrs?.might ?? 0) * per.might.damage;
  return {
    damage: weapon.damage * (1 + bonus(sim, e, 'damage') + (emp?.damage ?? 0) + might),
    staminaCost: emp?.staminaFree ? 0 : weapon.staminaCost,
    reach: weapon.reach,
    width: weapon.width,
    knockback: weapon.knockback,
    defense: Math.min(MAX_DEFENSE, armor + bonus(sim, e, 'defense') + (emp?.defense ?? 0)),
    maxHp: def.maxHp + bonus(sim, e, 'maxHp') + (attrs?.vigor ?? 0) * per.vigor.maxHp,
    maxStamina: def.maxStamina + (attrs?.endurance ?? 0) * per.endurance.maxStamina,
    staminaRegen: def.staminaRegen * (1 + bonus(sim, e, 'staminaRegen')),
    critChance: Math.min(1, def.attack.critChance + (emp?.crit ?? 0)),
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

function slotFor(def: ItemDef, eq: Equipment): EquipSlot | null {
  switch (def.kind) {
    case 'weapon':
      return 'weapon';
    case 'armor':
      return 'armor';
    case 'ring':
      return eq.ring0 === null || eq.ring1 !== null ? 'ring0' : 'ring1';
    default:
      return null;
  }
}

/** Equips the inventory stack at `index`, swapping what was in the slot back into the inventory. */
export function equip(sim: Simulation, index: number): boolean {
  const e = sim.player;
  const inv = sim.ecs.need(e, Inventory);
  const eq = sim.ecs.need(e, Equipment);
  const stack = inv.stacks[index];
  if (!stack) return false;
  const slot = slotFor(sim.content.item(stack.item), eq);
  if (!slot) return false;
  const previous = eq[slot];
  inv.stacks.splice(index, 1);
  eq[slot] = { item: stack.item, count: 1, level: stack.level };
  if (previous) inv.stacks.splice(index, 0, previous);
  if (slot === 'ring0' || slot === 'ring1') syncVitals(sim, e);
  sim.events.emit({ type: 'equipped', item: stack.item, slot });
  return true;
}

export function unequip(sim: Simulation, slot: EquipSlot): boolean {
  const e = sim.player;
  const eq = sim.ecs.need(e, Equipment);
  const stack = eq[slot];
  if (!stack) return false;
  if (addItem(sim, e, stack.item, 1, stack.level) > 0) {
    sim.events.emit({ type: 'inventoryFull', item: stack.item });
    return false;
  }
  eq[slot] = null;
  if (slot === 'ring0' || slot === 'ring1') syncVitals(sim, e);
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
    const healed = Math.min(health.max - health.hp, effect.amount);
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
      const show = (s: ItemStack | null) => (s ? `${s.item}${s.level ? ` +${s.level}` : ''}` : '-');
      return [
        ...EQUIP_SLOTS.map((slot) => `${slot.padEnd(7)} ${show(eq[slot])}`),
        `quick   ${eq.quick ?? '-'}`,
        `stats   dmg ${st.damage.toFixed(1)}  def ${(st.defense * 100).toFixed(0)}%  maxHp ${st.maxHp}  regen ${st.staminaRegen.toFixed(2)}`,
        `items   ${inv.stacks.length}/${sim.content.player.inventorySlots} slots`,
        ...inv.stacks.map((s, i) => `  [${i}] ${s.item} x${s.count}${s.level ? ` +${s.level}` : ''}`),
      ].join('\n');
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
    { phase: 'control', run: processActions },
    { phase: 'cleanup', run: tickBuffs },
  ],
  commands,
};

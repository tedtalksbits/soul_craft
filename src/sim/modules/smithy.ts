/**
 * Smithy work (docs/gear-and-loot.md, section 7): what loot turns into once it stops being worn. Salvage
 * breaks gear into materials (never souls, so there is no item-to-souls loop), upgrades and infusing keep
 * an investment, and the smith (once the smithy is rebuilt) tempers a perk or cleanses a Blighted item.
 * Nothing here can fail by chance, and every price is shown before it is paid.
 *
 * Where: salvage at the forge or a bonfire; upgrades and infusing at the forge; tempering and cleansing at
 * the forge with the smith back. Choosing between a temper's offers needs nothing.
 */
import { CommandError } from '../../core/commands';
import { gearSlotOf } from '../../content/content';
import { TIERS, type ItemCount, type TierId } from '../../content/schemas';
import { Rng } from '../../core/rng';
import { Abilities, Equipment, Inventory, Player, type ItemStack } from '../components';
import type { GearTarget, PlayerAction } from '../input';
import type { SimCommand, SimModule } from '../module';
import type { Simulation } from '../simulation';
import { stationNearby, type Check } from './crafting';
import { gearOf, perkPool, rollOne } from './gear';
import { addItem, countItem, removeItem, roomFor, syncVitals } from './items';
import { projectName } from './restoration';
import { restoredEffects } from './restored-effects';

const fail = (reason: string): Check => ({ ok: false, reason });

/** The stack a target names, if there is one. */
export function targetStack(sim: Simulation, target: GearTarget): ItemStack | null {
  if ('slot' in target) return sim.ecs.need(sim.player, Equipment)[target.slot];
  return sim.ecs.need(sim.player, Inventory).stacks[target.pack] ?? null;
}

const atForge = (sim: Simulation) => stationNearby(sim, 'forge');
const resting = (sim: Simulation) => sim.ecs.need(sim.player, Player).state === 'sit';
/** The smith is back (the smithy rebuilt) and the player stands at the forge. */
export const smithHere = (sim: Simulation) =>
  atForge(sim) && restoredEffects(sim).some((fx) => fx.type === 'smithWork');

/** Whether the player can pay souls and items, or what is missing. */
function affords(sim: Simulation, souls: number, items: readonly ItemCount[]): Check {
  if (sim.ecs.need(sim.player, Player).souls < souls) return fail(`needs ${souls} souls`);
  const inv = sim.ecs.need(sim.player, Inventory);
  for (const c of items)
    if (countItem(inv, c.item) < c.count) return fail(`needs ${c.count} ${sim.content.item(c.item).name}`);
  return { ok: true };
}

function pay(sim: Simulation, souls: number, items: readonly ItemCount[]): void {
  sim.ecs.need(sim.player, Player).souls -= souls;
  const inv = sim.ecs.need(sim.player, Inventory);
  for (const c of items) removeItem(inv, c.item, c.count);
}

/** After changing worn gear: max health and stamina follow. */
function refit(sim: Simulation, target: GearTarget): void {
  if ('slot' in target) syncVitals(sim, sim.player);
}

// ------------------------------------------------------------------ salvage

/** What a piece of gear breaks into: its slot's materials by tier, and a Warden Mark from a Legendary. */
export function salvageYield(sim: Simulation, stack: ItemStack): ItemCount[] {
  const slot = gearSlotOf(sim.content.item(stack.item));
  if (!slot) return [];
  const { salvage } = sim.content.loot.smithy;
  const tier = gearOf(stack).tier;
  const kind = slot === 'weapon' ? 'weapon' : slot === 'ring' ? 'ring' : 'armor';
  const out = salvage.materials[kind]
    .map((item, i) => ({ item, count: salvage.yields[tier][i] ?? 0 }))
    .filter((c) => c.count > 0);
  if (tier === 'legendary') out.push({ item: salvage.mark, count: 1 });
  return out;
}

export function canSalvage(sim: Simulation, index: number): Check {
  const stack = sim.ecs.need(sim.player, Inventory).stacks[index];
  if (!stack || !gearSlotOf(sim.content.item(stack.item))) return fail('only gear can be salvaged');
  if (stack.locked) return fail('it is locked');
  if (!atForge(sim) && !resting(sim)) return fail('salvage at the forge or a bonfire');
  return { ok: true };
}

/** Breaks the pack stack at `index` into materials. Refused if they wouldn't fit in the pack. */
export function salvage(sim: Simulation, index: number): boolean {
  const check = canSalvage(sim, index);
  const inv = sim.ecs.need(sim.player, Inventory);
  const stack = inv.stacks[index];
  if (!check.ok || !stack) {
    sim.events.emit({
      type: 'craftFailed',
      recipe: 'salvage',
      reason: check.ok ? 'nothing there' : check.reason,
    });
    return false;
  }
  return breakDown(sim, stack, () => inv.stacks.splice(index, 1));
}

/** Turns a stack into its materials, once `take` has removed it; puts it back if they wouldn't fit. */
function breakDown(sim: Simulation, stack: ItemStack, take: () => void): boolean {
  const inv = sim.ecs.need(sim.player, Inventory);
  const before = inv.stacks.slice();
  take();
  const materials = salvageYield(sim, stack);
  if (materials.some((m) => roomFor(sim, sim.player, m.item) < m.count)) {
    inv.stacks = before;
    sim.events.emit({ type: 'craftFailed', recipe: 'salvage', reason: 'inventory is full' });
    return false;
  }
  for (const m of materials) addItem(sim, sim.player, m.item, m.count);
  sim.events.emit({ type: 'salvaged', item: stack.item, tier: gearOf(stack).tier, materials });
  return true;
}

/**
 * Salvages everything marked junk. It never touches a locked piece, and never a Noble or Legendary one:
 * those go one at a time, on purpose (a bulk salvage that ate legendaries is how players lose gear).
 */
export function salvageJunk(sim: Simulation): number {
  if (!atForge(sim) && !resting(sim)) {
    sim.events.emit({ type: 'craftFailed', recipe: 'salvage', reason: 'salvage at the forge or a bonfire' });
    return 0;
  }
  const inv = sim.ecs.need(sim.player, Inventory);
  const noble = TIERS.indexOf('noble');
  let done = 0;
  for (let i = inv.stacks.length - 1; i >= 0; i--) {
    const stack = inv.stacks[i]!;
    if (!stack.junk || stack.locked || TIERS.indexOf(gearOf(stack).tier) >= noble) continue;
    if (breakDown(sim, stack, () => inv.stacks.splice(i, 1))) done++;
  }
  return done;
}

/** Gear of a tier the player auto-salvages becomes materials the moment it is picked up. True if it did. */
export function autoSalvage(sim: Simulation, stack: ItemStack): boolean {
  if (!stack.gear || !(sim.state.autoSalvage ?? []).includes(stack.gear.tier)) return false;
  return breakDown(sim, stack, () => undefined);
}

/** Only the two lowest tiers can be salvaged on pickup. */
export const AUTO_SALVAGE_TIERS: readonly TierId[] = ['common', 'standard'];

function setAutoSalvage(sim: Simulation, tier: TierId, on: boolean): void {
  if (!AUTO_SALVAGE_TIERS.includes(tier)) return;
  const now = new Set(sim.state.autoSalvage ?? []);
  if (on) now.add(tier);
  else now.delete(tier);
  sim.state.autoSalvage = TIERS.filter((t) => now.has(t));
}

function mark(sim: Simulation, index: number, as: 'lock' | 'junk' | null): void {
  const stack = sim.ecs.need(sim.player, Inventory).stacks[index];
  if (!stack || !gearSlotOf(sim.content.item(stack.item))) return;
  delete stack.locked;
  delete stack.junk;
  if (as === 'lock') stack.locked = true;
  if (as === 'junk') stack.junk = true;
}

// ------------------------------------------------------------------ upgrades and infusing

export interface GearUpgrade {
  item: string;
  level: number;
  /** What the step adds: weapon damage or Armor. */
  stat: 'damage' | 'armor';
  gain: number;
  souls: number;
  items: ItemCount[];
  requires?: string | undefined;
}

/** The forge steps a piece of gear has, if any (weapons and armor). */
function stepsOf(sim: Simulation, item: string): Omit<GearUpgrade, 'item' | 'level'>[] {
  const def = sim.content.items[item];
  if (def?.kind === 'weapon')
    return def.upgrades.map((u) => ({
      stat: 'damage' as const,
      gain: u.damage,
      souls: u.souls,
      items: u.items,
      requires: u.requires,
    }));
  if (def?.kind === 'armor')
    return def.upgrades.map((u) => ({
      stat: 'armor' as const,
      gain: u.armor,
      souls: u.souls,
      items: u.items,
      requires: u.requires,
    }));
  return [];
}

/** A piece of gear's next forge step, or null when it has none left. */
export function nextGearUpgrade(sim: Simulation, target: GearTarget): GearUpgrade | null {
  const stack = targetStack(sim, target);
  if (!stack) return null;
  const step = stepsOf(sim, stack.item)[stack.level];
  return step ? { item: stack.item, level: stack.level + 1, ...step } : null;
}

export function canUpgradeGear(
  sim: Simulation,
  target: GearTarget,
  opts: { ignoreStation?: boolean } = {},
): Check {
  const next = nextGearUpgrade(sim, target);
  if (!next) return fail('cannot be upgraded further');
  if (!opts.ignoreStation && !atForge(sim)) return fail('needs a forge');
  // The last steps need a master's hand: they wait on a rebuilt project (the smithy).
  if (next.requires && !sim.state.restored[next.requires])
    return fail(`needs ${projectName(sim, next.requires)} rebuilt`);
  return affords(sim, next.souls, next.items);
}

export function upgradeGear(
  sim: Simulation,
  target: GearTarget,
  opts: { ignoreStation?: boolean } = {},
): boolean {
  const check = canUpgradeGear(sim, target, opts);
  const next = nextGearUpgrade(sim, target);
  const stack = targetStack(sim, target);
  if (!check.ok || !next || !stack) {
    sim.events.emit({
      type: 'craftFailed',
      recipe: 'upgrade',
      reason: check.ok ? 'cannot upgrade' : check.reason,
    });
    return false;
  }
  pay(sim, next.souls, next.items);
  stack.level = next.level;
  refit(sim, target);
  sim.events.emit({ type: 'upgraded', item: stack.item, level: stack.level });
  return true;
}

/** What moving `from`'s upgrades onto `to` costs: a share of the materials and souls they took. */
export function infuseCost(sim: Simulation, from: ItemStack): { souls: number; items: ItemCount[] } {
  const share = sim.content.loot.smithy.infuse;
  const spent = stepsOf(sim, from.item).slice(0, from.level);
  const items = new Map<string, number>();
  for (const step of spent) for (const c of step.items) items.set(c.item, (items.get(c.item) ?? 0) + c.count);
  return {
    souls: Math.ceil(spent.reduce((n, s) => n + s.souls, 0) * share),
    items: [...items].map(([item, count]) => ({ item, count: Math.ceil(count * share) })),
  };
}

export function canInfuse(sim: Simulation, from: GearTarget, to: GearTarget): Check {
  const a = targetStack(sim, from);
  const b = targetStack(sim, to);
  if (!a || !b || a === b) return fail('choose two pieces of gear');
  const slotA = gearSlotOf(sim.content.item(a.item));
  if (!slotA || slotA !== gearSlotOf(sim.content.item(b.item)))
    return fail('only into gear of the same slot');
  if (stepsOf(sim, b.item).length === 0) return fail('it cannot be upgraded');
  if (a.level <= b.level) return fail('it is upgraded no further');
  if (!atForge(sim)) return fail('needs a forge');
  const cost = infuseCost(sim, a);
  return affords(sim, cost.souls, cost.items);
}

/** Moves `from`'s upgrade level onto `to` (as far as `to` goes), so a better drop never resets an investment. */
export function infuse(sim: Simulation, from: GearTarget, to: GearTarget): boolean {
  const check = canInfuse(sim, from, to);
  const a = targetStack(sim, from);
  const b = targetStack(sim, to);
  if (!check.ok || !a || !b) {
    sim.events.emit({
      type: 'craftFailed',
      recipe: 'infuse',
      reason: check.ok ? 'cannot infuse' : check.reason,
    });
    return false;
  }
  const cost = infuseCost(sim, a);
  pay(sim, cost.souls, cost.items);
  b.level = Math.min(a.level, stepsOf(sim, b.item).length);
  a.level = 0;
  refit(sim, from);
  refit(sim, to);
  sim.events.emit({ type: 'infused', from: a.item, to: b.item, level: b.level });
  return true;
}

// ------------------------------------------------------------------ tempering and cleansing

/** What tempering a piece of gear costs now: more for better tiers, and more each time, to a cap. */
export function temperCost(sim: Simulation, stack: ItemStack): { souls: number; items: ItemCount[] } {
  const t = sim.content.loot.smithy.temper;
  const gear = gearOf(stack);
  const tier = gear.tier === 'common' ? 0 : t.tiers[gear.tier];
  const factor = tier * Math.min(t.cap, 1 + t.growth * (gear.tempers ?? 0));
  return {
    souls: Math.round(t.souls * factor),
    items: t.items.map((c) => ({ item: c.item, count: Math.ceil(c.count * factor) })),
  };
}

export function canTemper(sim: Simulation, target: GearTarget, perk: number): Check {
  const stack = targetStack(sim, target);
  const gear = stack?.gear;
  if (!stack || !gear || gear.perks.length === 0) return fail('it has no perks to temper');
  const roll = gear.perks[perk];
  if (!roll) return fail('no such perk');
  if (sim.content.loot.perks[roll.perk]?.drawback) return fail('a drawback is cleansed, not tempered');
  if (gear.offer) return fail('choose from the last temper first');
  if (gear.tempered !== undefined && gear.tempered !== perk)
    return fail('only the perk tempered before can be');
  if (!smithHere(sim))
    return fail(atForge(sim) ? 'the smith is not back yet' : 'needs the smith at the forge');
  const cost = temperCost(sim, stack);
  return affords(sim, cost.souls, cost.items);
}

/**
 * Rerolls one perk into two new offers, from the item's own seed (advanced, so reloading never fishes for a
 * better roll). The player then keeps the old perk or takes one of the new ones.
 */
export function temper(sim: Simulation, target: GearTarget, perk: number): boolean {
  const check = canTemper(sim, target, perk);
  const stack = targetStack(sim, target);
  const gear = stack?.gear;
  if (!check.ok || !stack || !gear) {
    sim.events.emit({
      type: 'craftFailed',
      recipe: 'temper',
      reason: check.ok ? 'cannot temper' : check.reason,
    });
    return false;
  }
  const cost = temperCost(sim, stack);
  pay(sim, cost.souls, cost.items);
  gear.seed = new Rng(gear.seed).nextUint() >>> 0 || 1;
  const rng = new Rng(gear.seed);
  const pool = perkPool(
    sim.content,
    stack.item,
    gear.tier,
    gear.perks.map((p) => p.perk),
  );
  const cls = sim.ecs.get(sim.player, Abilities)?.class ?? null;
  const rolls = [0, 1].flatMap(() =>
    pool.length > 0 ? [rollOne(sim.content, rng, pool, gear.tier, cls, gear.blighted === true)] : [],
  );
  gear.offer = { perk, rolls };
  gear.tempers = (gear.tempers ?? 0) + 1;
  gear.tempered = perk;
  sim.events.emit({ type: 'tempered', item: stack.item });
  return true;
}

/** Settles a temper: 0 keeps the old perk; 1 or 2 takes that offer. */
export function settleTemper(sim: Simulation, target: GearTarget, choice: number): boolean {
  const stack = targetStack(sim, target);
  const gear = stack?.gear;
  const offer = gear?.offer;
  if (!gear || !offer) return false;
  const pick = choice > 0 ? offer.rolls[choice - 1] : undefined;
  if (pick) gear.perks[offer.perk] = pick;
  delete gear.offer;
  refit(sim, target);
  return true;
}

export function canCleanse(sim: Simulation, target: GearTarget): Check {
  const stack = targetStack(sim, target);
  if (!stack?.gear?.blighted) return fail('it is not Blighted');
  if (!smithHere(sim))
    return fail(atForge(sim) ? 'the smith is not back yet' : 'needs the smith at the forge');
  const c = sim.content.loot.smithy.cleanse;
  return affords(sim, c.souls, c.items);
}

/** Burns the blight off: the drawback goes, and the perks it strengthened stay strong. */
export function cleanse(sim: Simulation, target: GearTarget): boolean {
  const check = canCleanse(sim, target);
  const stack = targetStack(sim, target);
  const gear = stack?.gear;
  if (!check.ok || !stack || !gear) {
    sim.events.emit({
      type: 'craftFailed',
      recipe: 'cleanse',
      reason: check.ok ? 'cannot cleanse' : check.reason,
    });
    return false;
  }
  const c = sim.content.loot.smithy.cleanse;
  pay(sim, c.souls, c.items);
  const perks = sim.content.loot.perks;
  const kept = gear.perks.filter((p) => !perks[p.perk]?.drawback);
  // A tempered perk's index moves if the drawback sat before it.
  if (gear.tempered !== undefined) {
    const at = gear.perks[gear.tempered];
    const moved = at ? kept.indexOf(at) : -1;
    if (moved >= 0) gear.tempered = moved;
    else delete gear.tempered;
  }
  gear.perks = kept;
  delete gear.blighted;
  refit(sim, target);
  sim.events.emit({ type: 'cleansed', item: stack.item });
  return true;
}

// ------------------------------------------------------------------ actions

function applyAction(sim: Simulation, action: PlayerAction): void {
  switch (action.type) {
    case 'salvage':
      salvage(sim, action.index);
      return;
    case 'salvageJunk':
      salvageJunk(sim);
      return;
    case 'mark':
      mark(sim, action.index, action.mark);
      return;
    case 'autoSalvage':
      setAutoSalvage(sim, action.tier, action.on);
      return;
    case 'upgradeGear':
      upgradeGear(sim, action.target);
      return;
    case 'infuse':
      infuse(sim, action.from, action.to);
      return;
    case 'temper':
      temper(sim, action.target, action.perk);
      return;
    case 'settleTemper':
      settleTemper(sim, action.target, action.choice);
      return;
    case 'cleanse':
      cleanse(sim, action.target);
      return;
    default:
      return;
  }
}

function processActions(sim: Simulation): void {
  if (sim.ecs.need(sim.player, Player).state === 'dead') return;
  for (const action of sim.input.actions ?? []) applyAction(sim, action);
}

const commands: SimCommand[] = [
  {
    name: 'smith',
    description: 'Bring the smith back (as if the smithy were rebuilt), for tempering and cleansing.',
    run: ({ sim }) => {
      if (!sim.content.restoration['smithy']) throw new CommandError('this content has no smithy project');
      sim.state.restored['smithy'] = true;
      return 'the smith is back';
    },
  },
];

export const smithyModule: SimModule = {
  id: 'smithy',
  systems: [{ phase: 'control', run: processActions, menu: true }],
  commands,
};

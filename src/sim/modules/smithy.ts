/**
 * Smithy work (docs/gear-and-loot.md, section 7): what loot turns into once it stops being worn. Salvage
 * breaks gear into materials (never souls, so there is no item-to-souls loop), upgrades and infusing keep
 * an investment, and the smith (once the smithy is rebuilt) tempers a perk or cleanses a Blighted item.
 * Nothing here can fail by chance, and every price is shown before it is paid.
 *
 * Where: salvage anywhere (docs/power-and-stash.md, section 4); infusing at any bonfire; upgrades at the forge;
 * tempering and cleansing at the forge with the smith back. Choosing between a temper's offers needs nothing.
 * Stashed pieces can be worked on only where the stash opens.
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
import { addItem, countItem, removeItem, syncVitals } from './items';
import { bestOwnedPower, gearPower } from './power';
import { STASH_CLOSED, stashOf, stashReachable } from './storage';
import { projectName } from './restoration';
import { restoredEffects } from './restored-effects';

const fail = (reason: string): Check => ({ ok: false, reason });

/** The stack a target names, if there is one (a stashed one only where the stash opens). */
export function targetStack(sim: Simulation, target: GearTarget): ItemStack | null {
  if ('slot' in target) return sim.ecs.need(sim.player, Equipment)[target.slot];
  if ('stash' in target) return stashReachable(sim) ? (stashOf(sim)[target.stash] ?? null) : null;
  return sim.ecs.need(sim.player, Inventory).stacks[target.pack] ?? null;
}

/** Takes a carried or stashed stack out of where it is kept. */
function takeOut(sim: Simulation, target: GearTarget): void {
  if ('pack' in target) sim.ecs.need(sim.player, Inventory).stacks.splice(target.pack, 1);
  else if ('stash' in target) stashOf(sim).splice(target.stash, 1);
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
  const echoes = salvage.echo.yields[tier];
  if (echoes > 0) out.push({ item: salvage.echo.item, count: echoes });
  return out;
}

export function canSalvage(sim: Simulation, target: GearTarget): Check {
  if ('slot' in target) return fail('take it off first');
  if ('stash' in target && !stashReachable(sim)) return fail(STASH_CLOSED);
  const stack = targetStack(sim, target);
  if (!stack || !gearSlotOf(sim.content.item(stack.item))) return fail('only gear can be salvaged');
  if (stack.locked) return fail('it is locked');
  return { ok: true };
}

/** Breaks a carried (or stashed) piece into materials, anywhere. */
export function salvage(sim: Simulation, target: GearTarget): boolean {
  const check = canSalvage(sim, target);
  const stack = targetStack(sim, target);
  if (!check.ok || !stack) {
    sim.events.emit({
      type: 'craftFailed',
      recipe: 'salvage',
      reason: check.ok ? 'nothing there' : check.reason,
    });
    return false;
  }
  takeOut(sim, target);
  breakDown(sim, stack);
  return true;
}

/** Adds a stack's materials (which always fit: materials have no limit) and says what came of it. */
function breakDown(sim: Simulation, stack: ItemStack): void {
  const materials = salvageYield(sim, stack);
  for (const m of materials) addItem(sim, sim.player, m.item, m.count);
  sim.events.emit({ type: 'salvaged', item: stack.item, tier: gearOf(stack).tier, materials });
}

/**
 * The junk a bulk salvage would break, carried and (where it opens) stashed. It never touches a locked piece or a
 * Legendary, and a Noble only with `includeNoble` for that one run: a bulk salvage that ate good gear is how
 * players lose it (Diablo IV, Season 4).
 */
export function junkToSalvage(sim: Simulation, includeNoble = false): GearTarget[] {
  const top = TIERS.indexOf(includeNoble ? 'legendary' : 'noble');
  const takes = (stack: ItemStack) =>
    stack.junk === true && !stack.locked && TIERS.indexOf(gearOf(stack).tier) < top;
  const pack = sim.ecs
    .need(sim.player, Inventory)
    .stacks.flatMap((stack, i): GearTarget[] => (takes(stack) ? [{ pack: i }] : []));
  const kept = stashReachable(sim)
    ? stashOf(sim).flatMap((stack, i): GearTarget[] => (takes(stack) ? [{ stash: i }] : []))
    : [];
  return [...pack, ...kept];
}

/** What a bulk salvage would give, for the preview. */
export function junkYield(sim: Simulation, includeNoble = false): { pieces: number; materials: ItemCount[] } {
  const total = new Map<string, number>();
  const targets = junkToSalvage(sim, includeNoble);
  for (const t of targets) {
    const stack = targetStack(sim, t);
    if (stack)
      for (const m of salvageYield(sim, stack)) total.set(m.item, (total.get(m.item) ?? 0) + m.count);
  }
  return { pieces: targets.length, materials: [...total].map(([item, count]) => ({ item, count })) };
}

/** Salvages all the junk `junkToSalvage` names, anywhere. */
export function salvageJunk(sim: Simulation, includeNoble = false): number {
  const targets = junkToSalvage(sim, includeNoble);
  const stacks = targets.flatMap((t) => targetStack(sim, t) ?? []);
  // By identity, so taking one out doesn't shift the next one's index.
  const inv = sim.ecs.need(sim.player, Inventory);
  inv.stacks = inv.stacks.filter((s) => !stacks.includes(s));
  if (sim.state.stash) sim.state.stash = sim.state.stash.filter((s) => !stacks.includes(s));
  for (const stack of stacks) breakDown(sim, stack);
  return stacks.length;
}

/**
 * Auto-junk: a Common or Standard piece arriving below the best piece already owned for its slot is marked junk,
 * so the pile sorts itself and "Dismantle all junk" clears it. Called as gear is picked up.
 */
export function autoJunk(sim: Simulation, stack: ItemStack): void {
  if (!sim.state.autoJunk || !stack.gear) return;
  if (stack.gear.tier !== 'common' && stack.gear.tier !== 'standard') return;
  const slot = gearSlotOf(sim.content.item(stack.item));
  if (slot && stack.gear.power < bestOwnedPower(sim, slot)) stack.junk = true;
}

function mark(sim: Simulation, target: GearTarget, as: 'lock' | 'junk' | null): void {
  const stack = targetStack(sim, target);
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

/**
 * What infusing a piece of this tier costs: souls and Echoes (from dismantling), the same at any Power (Destiny
 * spent nine years cutting its cost down; we start there), more for better tiers.
 */
export function infuseCost(sim: Simulation, tier: TierId): { souls: number; items: ItemCount[] } {
  const c = sim.content.loot.smithy.infuse;
  return { souls: c.souls, items: [{ item: c.item, count: c.costs[tier] }] };
}

/**
 * Whether `from` can be fed into `to`: two pieces for the same slot, `from` of higher Power, carried or stashed
 * (never worn, never locked), at a bonfire, and paid for.
 */
export function canInfuse(sim: Simulation, from: GearTarget, to: GearTarget): Check {
  const fed = targetStack(sim, from);
  const kept = targetStack(sim, to);
  if (!fed || !kept || fed === kept) return fail('choose two pieces of gear');
  const slot = gearSlotOf(sim.content.item(kept.item));
  if (!slot || slot !== gearSlotOf(sim.content.item(fed.item)))
    return fail('only from gear of the same slot');
  // Same rarity only: a Common can't take a Legendary's Power, so a tier has to be found, not bought.
  if (gearOf(fed).tier !== gearOf(kept).tier) return fail('only from gear of the same rarity');
  if ('slot' in from) return fail('take it off first');
  if (fed.locked) return fail('it is locked');
  if (gearPower(fed) <= gearPower(kept)) return fail('it has no more Power');
  if (!resting(sim)) return fail('infuse at a bonfire');
  const cost = infuseCost(sim, gearOf(kept).tier);
  return affords(sim, cost.souls, cost.items);
}

/** Raises `to` to `from`'s Power, keeping everything else about it; `from` is used up. */
export function infuse(sim: Simulation, from: GearTarget, to: GearTarget): boolean {
  const check = canInfuse(sim, from, to);
  const fed = targetStack(sim, from);
  const kept = targetStack(sim, to);
  if (!check.ok || !fed || !kept?.gear) {
    sim.events.emit({
      type: 'craftFailed',
      recipe: 'infuse',
      reason: check.ok ? 'cannot infuse' : check.reason,
    });
    return false;
  }
  const cost = infuseCost(sim, kept.gear.tier);
  pay(sim, cost.souls, cost.items);
  kept.gear.power = gearPower(fed);
  // By identity: taking the fed piece out may shift the kept one's index.
  const inv = sim.ecs.need(sim.player, Inventory);
  inv.stacks = inv.stacks.filter((s) => s !== fed);
  if (sim.state.stash) sim.state.stash = sim.state.stash.filter((s) => s !== fed);
  refit(sim, to);
  sim.events.emit({ type: 'infused', from: fed.item, to: kept.item, power: kept.gear.power });
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
      salvage(sim, action.target);
      return;
    case 'salvageJunk':
      salvageJunk(sim, action.includeNoble === true);
      return;
    case 'mark':
      mark(sim, action.target, action.mark);
      return;
    case 'autoJunk':
      sim.state.autoJunk = action.on;
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

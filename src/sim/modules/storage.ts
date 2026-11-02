/**
 * Where things are kept (docs/power-and-stash.md, section 5). Everything carried is in the `Inventory`, but each
 * kind of thing has its own limit: **pockets** hold `player.storage.pocket` spare pieces per gear slot (the two
 * ring slots share one pocket), the **bag** holds `storage.bag` stacks of consumables, and **materials** (and key
 * items, relics and tools) are counts with no limit. The **stash** keeps gear and spare consumables at a bonfire:
 * the village's at first, every bonfire once the Storehouse is rebuilt. Capacity questions live here so the item
 * code can ask without the stash's actions (`stash.ts`).
 */
import { gearSlotOf, type Content } from '../../content/content';
import type { GearSlot } from '../../content/schemas';
import { Inventory, Player, type ItemStack } from '../components';
import type { Simulation } from '../simulation';
import { restoredEffects } from './restored-effects';

export type Pocket = GearSlot | 'bag' | 'materials';

/** Which limit an item counts against. */
export function pocketOf(content: Content, item: string): Pocket {
  const def = content.item(item);
  const slot = gearSlotOf(def);
  if (slot) return slot;
  return def.kind === 'consumable' ? 'bag' : 'materials';
}

/** How many stacks a pocket holds (materials have no limit). */
export function pocketLimit(content: Content, pocket: Pocket): number {
  const { storage } = content.player;
  if (pocket === 'materials') return Infinity;
  return pocket === 'bag' ? storage.bag : storage.pocket;
}

/** How many stacks are in a pocket now. */
export function pocketUsed(content: Content, inv: Inventory, pocket: Pocket): number {
  return inv.stacks.filter((s) => pocketOf(content, s.item) === pocket).length;
}

/** How many more stacks of this item's pocket the player can carry. */
export function pocketRoom(sim: Simulation, item: string): number {
  const inv = sim.ecs.need(sim.player, Inventory);
  const pocket = pocketOf(sim.content, item);
  return pocketLimit(sim.content, pocket) - pocketUsed(sim.content, inv, pocket);
}

// ------------------------------------------------------------------ the stash

export function stashOf(sim: Simulation): ItemStack[] {
  return (sim.state.stash ??= []);
}

/** How many pieces the stash holds: the base, plus what the Storehouse's ranks add. */
export function stashCapacity(sim: Simulation): number {
  let slots = sim.content.player.storage.stash;
  for (const fx of restoredEffects(sim)) if (fx.type === 'stashSlots') slots += fx.amount;
  return slots;
}

export function stashRoom(sim: Simulation): number {
  return stashCapacity(sim) - stashOf(sim).length;
}

/** What can go in the stash: gear and consumables (materials are already unlimited). */
export function stashable(content: Content, item: string): boolean {
  return pocketOf(content, item) !== 'materials';
}

/**
 * Whether the player can reach the stash: resting at the village bonfire, or at any bonfire once the Storehouse
 * stands. Overflow from full pockets reaches it from anywhere (`addStack`).
 */
export function stashReachable(sim: Simulation): boolean {
  if (sim.ecs.need(sim.player, Player).state !== 'sit') return false;
  if (restoredEffects(sim).some((fx) => fx.type === 'stashEverywhere')) return true;
  const at = sim.state.checkpoint?.id;
  return at !== undefined && at.startsWith(`${sim.content.world.origin.prefab}@origin#`);
}

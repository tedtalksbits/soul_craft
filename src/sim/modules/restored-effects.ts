/**
 * What rebuilt village projects give, read by the systems they change (pack size,
 * enemy spawning, forge upgrades). Kept apart from the restoration module so those
 * systems can ask without importing the rebuild logic, which itself uses them.
 */
import type { RestorationEffect } from '../../content/schemas';
import type { Simulation } from '../simulation';

/** A project's rank: 0 in ruins, 1 rebuilt, then one more for each rank raised. */
export function projectRank(sim: Simulation, id: string): number {
  return sim.state.restored[id] ? 1 + (sim.state.projectRanks?.[id] ?? 0) : 0;
}

/** Everything a project gives at its rank: its own effects, then each rank's. */
export function projectEffects(sim: Simulation, id: string): RestorationEffect[] {
  const def = sim.content.restoration[id];
  const rank = projectRank(sim, id);
  if (!def || rank === 0) return [];
  return [...def.effects, ...def.ranks.slice(0, rank - 1).flatMap((r) => r.effects)];
}

/** Every effect of every rebuilt project. Projects the content no longer defines give nothing. */
export function restoredEffects(sim: Simulation): RestorationEffect[] {
  return Object.keys(sim.state.restored).flatMap((id) => projectEffects(sim, id));
}

/** How many stacks the player can carry: the base pack plus a rebuilt storehouse. */
export function inventoryCapacity(sim: Simulation): number {
  let slots = sim.content.player.inventorySlots;
  for (const fx of restoredEffects(sim)) if (fx.type === 'inventorySlots') slots += fx.amount;
  return slots;
}

/** How far (tiles) from the village center no enemy rises, once the palisade stands. 0 before. */
export function villageWardTiles(sim: Simulation): number {
  let tiles = 0;
  for (const fx of restoredEffects(sim)) if (fx.type === 'safeRadius') tiles = Math.max(tiles, fx.tiles);
  return tiles;
}

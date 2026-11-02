/**
 * The Ember Gambler (docs/gear-and-loot.md, section 7): a villager a rebuilt project brings back, who sells an
 * unidentified piece for a slot the player chooses. It soaks up late souls and lets the player aim at a slot
 * (Diablo III's Kadala). Odds and price live in `loot.json → gambler`; the piece rolls like a drop, just above
 * the player's Max Power, and pity does not count it.
 */
import type { GearSlot } from '../../content/schemas';
import { Abilities, Inventory, Player } from '../components';
import type { SimModule } from '../module';
import type { Simulation } from '../simulation';
import type { Check } from './crafting';
import { rollForSlot } from './gear';
import { addStack } from './items';
import { dropPower, maxPower } from './power';
import { siteNearby } from './restoration';
import { inventoryCapacity, projectEffects } from './restored-effects';

const fail = (reason: string): Check => ({ ok: false, reason });

/** Whether a project's site has the Gambler's shop at its rank. */
export function hasGambler(sim: Simulation, project: string): boolean {
  return projectEffects(sim, project).some((fx) => fx.type === 'gambler');
}

/** The Gambler's shop the player stands at, if any. */
function shopHere(sim: Simulation): string | null {
  return (
    Object.keys(sim.content.restoration).find((id) => hasGambler(sim, id) && siteNearby(sim, id)) ?? null
  );
}

/** The price: the base, plus as much again for every 100 of Max Power, so it keeps pace with the player. */
export function gamblePrice(sim: Simulation): number {
  return sim.content.loot.gambler.souls * (1 + Math.floor(maxPower(sim) / 100));
}

export function canGamble(sim: Simulation): Check {
  if (!shopHere(sim)) return fail('only at the Gambler’s shop');
  const price = gamblePrice(sim);
  if (sim.ecs.need(sim.player, Player).souls < price) return fail(`needs ${price} souls`);
  if (sim.ecs.need(sim.player, Inventory).stacks.length >= inventoryCapacity(sim))
    return fail('inventory is full');
  return { ok: true };
}

/** Pays the price and rolls a piece for the slot: tier from the odds, then everything else from its seed. */
export function gamble(sim: Simulation, slot: GearSlot): boolean {
  const check = canGamble(sim);
  if (!check.ok) {
    sim.events.emit({ type: 'craftFailed', recipe: 'gamble', reason: check.reason });
    return false;
  }
  const tier = sim.rng.weighted(sim.content.loot.gambler.odds);
  const cls = sim.ecs.get(sim.player, Abilities)?.class ?? null;
  // A gambled piece lands just above Max Power, with no ring to cap it (it is bought at home).
  const { start, max } = sim.content.loot.power;
  const power = dropPower(sim, 'gambler', start, max);
  const stack = rollForSlot(sim.content, slot, tier, power, sim.rng.int(1, 0x7fffffff), cls);
  if (!stack) return false;
  sim.ecs.need(sim.player, Player).souls -= gamblePrice(sim);
  addStack(sim, sim.player, stack);
  sim.events.emit({ type: 'gambled', item: stack.item, tier });
  return true;
}

function processActions(sim: Simulation): void {
  if (sim.ecs.need(sim.player, Player).state === 'dead') return;
  for (const action of sim.input.actions ?? []) if (action.type === 'gamble') gamble(sim, action.slot);
}

export const gamblerModule: SimModule = {
  id: 'gambler',
  systems: [{ phase: 'control', run: processActions, menu: true }],
};

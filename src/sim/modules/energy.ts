/**
 * Super energy. Kept apart from the abilities module so combat can award it
 * without the two importing each other.
 */
import { Abilities, Attributes } from '../components';
import type { Simulation } from '../simulation';

export const FULL_ENERGY = 100;

/**
 * Adds super energy to the player, announcing the moment the bar fills. Nothing charges before
 * the super is awakened, and Attunement (leveling) makes it charge faster.
 */
export function gainEnergy(sim: Simulation, amount: number): void {
  const a = sim.ecs.get(sim.player, Abilities);
  if (!a || !a.unlocked.super || amount <= 0 || a.energy >= FULL_ENERGY) return;
  const attunement = sim.ecs.get(sim.player, Attributes)?.attunement ?? 0;
  const rate = 1 + attunement * sim.content.player.leveling.perLevel.attunement.energy;
  a.energy = Math.min(FULL_ENERGY, a.energy + amount * rate);
  if (a.energy >= FULL_ENERGY) sim.events.emit({ type: 'abilityReady', slot: 'super' });
}

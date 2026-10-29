/**
 * Super energy. Kept apart from the abilities module so combat can award it
 * without the two importing each other.
 */
import { Abilities } from '../components';
import type { Simulation } from '../simulation';

export const FULL_ENERGY = 100;

/** Adds super energy to the player, announcing the moment the bar fills. */
export function gainEnergy(sim: Simulation, amount: number): void {
  const a = sim.ecs.get(sim.player, Abilities);
  if (!a || amount <= 0 || a.energy >= FULL_ENERGY) return;
  a.energy = Math.min(FULL_ENERGY, a.energy + amount);
  if (a.energy >= FULL_ENERGY) sim.events.emit({ type: 'abilityReady', slot: 'super' });
}

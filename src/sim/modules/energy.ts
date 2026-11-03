/**
 * Super energy. Kept apart from the abilities module so combat can award it
 * without the two importing each other.
 */
import { Abilities, Wielding } from '../components';
import { playerStats } from './items';
import type { Simulation } from '../simulation';

export const FULL_ENERGY = 100;

/**
 * Adds super energy to the player, announcing the moment the bar fills. Nothing charges before
 * the super is awakened, and Attunement (leveling) makes it charge faster.
 */
export function gainEnergy(sim: Simulation, amount: number): void {
  const a = sim.ecs.get(sim.player, Abilities);
  if (!a || !a.unlocked.super || amount <= 0 || a.energy >= FULL_ENERGY) return;
  // Nothing done during a super charges the next one.
  if (sim.ecs.has(sim.player, Wielding)) return;
  a.energy = Math.min(FULL_ENERGY, a.energy + amount * playerStats(sim, sim.player).energyRate);
  if (a.energy >= FULL_ENERGY) sim.events.emit({ type: 'abilityReady', slot: 'super' });
}

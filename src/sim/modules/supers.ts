/**
 * Roaming supers (docs/supers.md): while a `wield` effect lasts, the player fights with a super weapon from
 * `weapons.json → supers` instead of whatever they hold (a bow-wielding Stalker gets the shade blades). This module
 * answers what is wielded and how it bends the rules; starting, ticking and ending it live with the other ability
 * effects in abilities.ts.
 */
import type { AbilityEffect } from '../../content/schemas';
import { Empowered, Wielding } from '../components';
import { TICK_RATE } from '../constants';
import type { Simulation } from '../simulation';

export type WieldEffect = Extract<AbilityEffect, { type: 'wield' }>;

/** The super under way, if any. */
export function wielding(sim: Simulation): Wielding | undefined {
  return sim.ecs.get(sim.player, Wielding);
}

/** The `wield` effect of the super under way, for its rules. */
export function wieldEffect(sim: Simulation): WieldEffect | undefined {
  const w = wielding(sim);
  if (!w) return undefined;
  const fx = sim.content.abilities[w.ability]?.effects.find((f) => f.type === 'wield');
  return fx?.type === 'wield' ? fx : undefined;
}

/** The super weapon in the player's hands, if one is wielded. */
export function superWeapon(sim: Simulation) {
  const w = wielding(sim);
  return w ? sim.content.weapons.supers[w.weapon] : undefined;
}

/** A kill during a roaming super keeps it going a little longer, up to its cap. */
export function extendOnKill(sim: Simulation): void {
  const w = wielding(sim);
  const fx = wieldEffect(sim);
  if (!w || !fx || fx.perKill <= 0) return;
  const add = Math.min(fx.perKill, fx.maxBonus - w.bonus);
  if (add <= 0) return;
  w.bonus += add;
  const ticks = Math.round(add * TICK_RATE);
  w.ticks += ticks;
  const emp = sim.ecs.get(sim.player, Empowered);
  if (emp?.ability === w.ability) emp.ticks += ticks;
}

/** What a blow from the super weapon does to a boss: `bossDamage` of it, so a super can't simply delete one. */
export function bossFactor(sim: Simulation): number {
  return wieldEffect(sim)?.bossDamage ?? 1;
}

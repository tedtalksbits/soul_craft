/**
 * Which ability slots the player has awakened. Kept apart from the abilities module so
 * combat (relic drops) and pickups (taking a relic) can use it without import cycles.
 * The AoE is always known; the class ability and then the super are unlocked by relics.
 */
import type { Content } from '../../content/content';
import { Abilities } from '../components';
import type { Simulation } from '../simulation';

export type LockableSlot = 'class' | 'super';

/** Whether a slot can be used: the AoE always, the others once awakened. */
export function slotUnlocked(a: Abilities, slot: 'aoe' | LockableSlot): boolean {
  return slot === 'aoe' || a.unlocked[slot];
}

/**
 * Whether a relic for `slot` may drop now: the slot is still locked, and it is next in line
 * (the super only after the class ability), so relics come in order.
 */
export function relicWanted(sim: Simulation, slot: LockableSlot): boolean {
  const a = sim.ecs.get(sim.player, Abilities);
  if (!a || a.unlocked[slot]) return false;
  return slot === 'class' || a.unlocked.class;
}

/** Awakens a slot. Returns false if it was already awake. */
export function unlockSlot(sim: Simulation, slot: LockableSlot): boolean {
  const a = sim.ecs.get(sim.player, Abilities);
  if (!a || a.unlocked[slot]) return false;
  a.unlocked[slot] = true;
  const ability = sim.content.playerClass(a.class).abilities[slot];
  sim.events.emit({ type: 'abilityUnlocked', slot, ability });
  return true;
}

/** What a locked slot needs, for menus: the relic that awakens it and where it is found. */
export function unlockHint(content: Content, slot: LockableSlot): string {
  const relic = Object.values(content.items).find((d) => d.kind === 'relic' && d.unlocks === slot);
  return relic?.kind === 'relic' ? `Awakened by the ${relic.name}. ${relic.source}` : 'Not yet awakened.';
}

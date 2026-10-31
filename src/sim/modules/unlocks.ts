/**
 * Which ability slots the player has awakened. Kept apart from the abilities module so
 * combat (relic drops) and objectives (handing a relic to Maren) can use it without import cycles.
 * The AoE is always known; the class ability and the super are unlocked by relics.
 */
import type { Content } from '../../content/content';
import { Abilities, Inventory, Pickup } from '../components';
import type { Simulation } from '../simulation';
import { countItem } from './items';

export type LockableSlot = 'class' | 'super';

/** Whether a slot can be used: the AoE always, the others once awakened. */
export function slotUnlocked(a: Abilities, slot: 'aoe' | LockableSlot): boolean {
  return slot === 'aoe' || a.unlocked[slot];
}

/**
 * Whether a relic may drop now: only while its slot is still locked and no copy is carried or
 * lying on the ground. Each relic has its own source (a guardian knight, a boss), and a boss falls
 * once, so there is no fixed order.
 */
export function relicWanted(sim: Simulation, relic: string, slot: LockableSlot): boolean {
  const a = sim.ecs.get(sim.player, Abilities);
  if (a === undefined || a.unlocked[slot]) return false;
  const inv = sim.ecs.get(sim.player, Inventory);
  if (inv && countItem(inv, relic) > 0) return false;
  for (const [, p] of sim.ecs.query(Pickup)) if (p.item === relic) return false;
  return true;
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

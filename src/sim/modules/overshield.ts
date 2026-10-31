/**
 * Overshield: extra health from abilities (a Hearth's warmth, a Rally) that soaks blows before the
 * player's own health and fades after a while. Kept apart from abilities so combat can absorb with
 * it without an import cycle.
 */
import type { Entity } from '../../core/ecs';
import { Overshield } from '../components';
import { TICK_RATE } from '../constants';
import type { SimModule } from '../module';
import type { Simulation } from '../simulation';

/**
 * Adds `amount` to the player's overshield, up to `max`, and makes it last `seconds` from now.
 * A one-off grant passes its own amount as `max`, so it tops up rather than stacks.
 */
export function grantOvershield(sim: Simulation, amount: number, max: number, seconds: number): void {
  const e = sim.player;
  const ticks = Math.round(seconds * TICK_RATE);
  const os = sim.ecs.get(e, Overshield);
  const hp = Math.max(os?.hp ?? 0, Math.min(max, (os?.hp ?? 0) + amount));
  if (os) {
    if (hp === os.hp && ticks <= os.ticks) return;
    os.hp = hp;
    os.ticks = Math.max(os.ticks, ticks);
  } else sim.ecs.add(e, Overshield, { hp, ticks });
  sim.events.emit({ type: 'overshieldGained', hp });
}

/** Soaks what it can of a blow. Returns what is left for health. */
export function absorb(sim: Simulation, e: Entity, amount: number): number {
  const os = sim.ecs.get(e, Overshield);
  if (!os || amount <= 0) return amount;
  const absorbed = Math.min(os.hp, amount);
  os.hp -= absorbed;
  sim.events.emit({ type: 'overshieldHit', absorbed, hp: os.hp });
  if (os.hp <= 0) sim.ecs.remove(e, Overshield);
  return amount - absorbed;
}

function fade(sim: Simulation): void {
  for (const [e, os] of sim.ecs.query(Overshield)) {
    if (--os.ticks > 0) continue;
    sim.ecs.remove(e, Overshield);
    sim.events.emit({ type: 'overshieldFaded' });
  }
}

export const overshieldModule: SimModule = { id: 'overshield', systems: [{ phase: 'cleanup', run: fade }] };

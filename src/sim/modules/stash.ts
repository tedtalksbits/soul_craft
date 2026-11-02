/**
 * Moving things between the pockets and the stash (modules/storage.ts has the rules on room and reach). Both ways
 * only where the stash opens: resting at the village bonfire, or at any bonfire once the Storehouse stands.
 */
import { Inventory, Player } from '../components';
import type { SimModule } from '../module';
import type { Simulation } from '../simulation';
import type { Check } from './crafting';
import { pocketRoom, STASH_CLOSED, stashable, stashOf, stashReachable, stashRoom } from './storage';

const fail = (reason: string): Check => ({ ok: false, reason });

export function canStash(sim: Simulation, index: number): Check {
  const stack = sim.ecs.need(sim.player, Inventory).stacks[index];
  if (!stack) return fail('nothing there');
  if (!stashable(sim.content, stack.item)) return fail('materials are never short of room');
  if (!stashReachable(sim)) return fail(STASH_CLOSED);
  if (stashRoom(sim) <= 0) return fail('the stash is full');
  return { ok: true };
}

export function canUnstash(sim: Simulation, index: number): Check {
  const stack = stashOf(sim)[index];
  if (!stack) return fail('nothing there');
  if (!stashReachable(sim)) return fail(STASH_CLOSED);
  if (pocketRoom(sim, stack.item) <= 0) return fail('that pocket is full');
  return { ok: true };
}

/** Puts a carried stack (by pack index) in the stash. */
export function stash(sim: Simulation, index: number): boolean {
  const check = canStash(sim, index);
  const inv = sim.ecs.need(sim.player, Inventory);
  const stack = inv.stacks[index];
  if (!check.ok || !stack) {
    sim.events.emit({
      type: 'craftFailed',
      recipe: 'stash',
      reason: check.ok ? 'nothing there' : check.reason,
    });
    return false;
  }
  inv.stacks.splice(index, 1);
  stashOf(sim).push(stack);
  sim.events.emit({ type: 'stashed', item: stack.item });
  return true;
}

/** Takes a stack (by stash index) back into its pocket. */
export function unstash(sim: Simulation, index: number): boolean {
  const check = canUnstash(sim, index);
  const stack = stashOf(sim)[index];
  if (!check.ok || !stack) {
    sim.events.emit({
      type: 'craftFailed',
      recipe: 'unstash',
      reason: check.ok ? 'nothing there' : check.reason,
    });
    return false;
  }
  stashOf(sim).splice(index, 1);
  sim.ecs.need(sim.player, Inventory).stacks.push(stack);
  sim.events.emit({ type: 'unstashed', item: stack.item });
  return true;
}

function processActions(sim: Simulation): void {
  if (sim.ecs.need(sim.player, Player).state === 'dead') return;
  for (const action of sim.input.actions ?? []) {
    if (action.type === 'stash') stash(sim, action.index);
    else if (action.type === 'unstash') unstash(sim, action.index);
  }
}

export const stashModule: SimModule = {
  id: 'stash',
  systems: [{ phase: 'control', run: processActions, menu: true }],
};
